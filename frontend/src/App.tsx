import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { LoginOverlay } from "./LoginOverlay";
import { PipControls } from "./PipControls";
import { Dashboard } from "./Dashboard";
import { clampFontSize, orderDictates } from "./dictates";
import { useRecorder } from "./useRecorder";
import type { Dictate, Profile, Segment, Settings, Usage } from "./types";
import { appendTranscript, nextProcessable } from "./queue";

const DEFAULT_SETTINGS: Settings = { profile: "de-general", dictionary: "", radiologyPack: true };
const EMPTY_USAGE: Usage = { month: "", audioSeconds: 0, lunaInputTokens: 0, lunaCachedTokens: 0, lunaOutputTokens: 0, audioCost: 0, lunaCost: 0 };
const FONT_SIZE_KEY = "dictate_editor_font_size";
const MIN_FONT_SIZE = 13, MAX_FONT_SIZE = 25, DEFAULT_FONT_SIZE = 17;
const clientId = (() => { const found = sessionStorage.getItem("dictate_client_id"); const value = found ?? crypto.randomUUID().replaceAll("-", ""); sessionStorage.setItem("dictate_client_id", value); return value; })();

function titleFor(text: string) { return text.trim().split("\n")[0]?.slice(0, 70) || "Neues Diktat"; }
function money(value: number) { return `$${value.toFixed(value < 0.01 ? 4 : 2)}`; }

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null), [loginReason, setLoginReason] = useState("");
  const [view, setView] = useState<"dictate" | "dashboard">("dictate");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS), [settingsOpen, setSettingsOpen] = useState(false);
  const [history, setHistory] = useState<Dictate[]>([]), [historyOpen, setHistoryOpen] = useState(false);
  const [currentId, setCurrentId] = useState<string>(crypto.randomUUID()), [createdAt, setCreatedAt] = useState(new Date().toISOString());
  const [text, setText] = useState(""), [queue, setQueue] = useState<Segment[]>([]), [usage, setUsage] = useState(EMPTY_USAGE);
  const [notice, setNotice] = useState("Bereit · Leertaste halten oder klicken"), [quota, setQuota] = useState(false);
  const [fontSize, setFontSize] = useState(() => {
    const stored = Number(localStorage.getItem(FONT_SIZE_KEY));
    return Number.isFinite(stored) && stored >= MIN_FONT_SIZE && stored <= MAX_FONT_SIZE ? stored : DEFAULT_FONT_SIZE;
  });
  const [review, setReview] = useState<{ original: string; preview?: string; busy?: boolean } | null>(null);
  const sequence = useRef(0), processing = useRef(false), initialized = useRef(false), textRef = useRef(text);
  textRef.current = text;

  useEffect(() => { localStorage.setItem(FONT_SIZE_KEY, String(fontSize)); }, [fontSize]);

  const requireLogin = useCallback((reason = "Bitte erneut anmelden.") => { setLoginReason(reason); setAuthenticated(false); }, []);
  const loadAccount = useCallback(async () => {
    try {
      await api.me();
      const [remoteSettings, dictates, remoteUsage] = await Promise.all([api.settings(), api.dictates(), api.usage()]);
      setSettings(remoteSettings); setHistory(dictates.items); setUsage(remoteUsage); setAuthenticated(true); setLoginReason("");
      initialized.current = true;
    } catch (error) { if (error instanceof ApiError && error.status === 401) requireLogin(); else { requireLogin(error instanceof Error ? error.message : "Backend nicht erreichbar"); } }
  }, [requireLogin]);
  useEffect(() => { void loadAccount(); }, [loadAccount]);

  const addSegment = useCallback((blob: Blob, durationMs: number) => {
    const next: Segment = { id: crypto.randomUUID(), sequence: sequence.current++, dictateId: currentId, blob, durationMs, mime: blob.type, profile: settings.profile, status: "queued" };
    setQueue((items) => [...items, next]); setNotice("Abschnitt in Warteschlange");
  }, [currentId, settings.profile]);
  const recorderError = useCallback((message: string) => setNotice(`Mikrofon: ${message}`), []);
  const { recording, level, toggle, start, stop } = useRecorder(addSegment, recorderError, !authenticated || quota);

  useEffect(() => {
    if (!authenticated || processing.current) return;
    const next = nextProcessable(queue);
    if (!next || next.status === "failed" || next.status === "processing") return;
    processing.current = true;
    setQueue((items) => items.map((item) => item.id === next.id ? { ...item, status: "processing" } : item));
    setNotice(`Abschnitt ${next.sequence + 1} wird transkribiert …`);
    void api.transcribe({ blob: next.blob, clientId, sequence: next.sequence, durationMs: next.durationMs, profile: next.profile, previous: textRef.current.slice(-300) })
      .then((result) => {
        const complete = appendTranscript(textRef.current, result.text); textRef.current = complete; setText(complete);
        setUsage(result.usage); setQueue((items) => items.filter((item) => item.id !== next.id));
        setNotice("Transkribiert");
        queueMicrotask(() => navigator.clipboard?.writeText(complete).then(() => setNotice("Transkribiert und kopiert")).catch(() => setNotice("Transkribiert · nicht automatisch kopiert")));
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) {
          setQueue((items) => items.map((item) => item.id === next.id ? { ...item, status: "queued" } : item));
          stop(); requireLogin("Sitzung abgelaufen. Text und Audio bleiben erhalten.");
        } else {
          const isQuota = error instanceof ApiError && error.code === "QUOTA_EXHAUSTED";
          if (isQuota) { setQuota(true); stop(); }
          setQueue((items) => items.map((item) => item.id === next.id ? { ...item, status: "failed", error: error instanceof Error ? error.message : "Fehlgeschlagen" } : item));
          setNotice(error instanceof Error ? error.message : "Transkription fehlgeschlagen");
        }
      })
      .finally(() => { processing.current = false; setQueue((items) => [...items]); });
  }, [authenticated, queue, requireLogin, stop]);

  useEffect(() => {
    const hasUnsavedAudio = recording || queue.some((item) => item.status !== "done");
    const warn = (event: BeforeUnloadEvent) => { if (hasUnsavedAudio) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [queue, recording]);

  useEffect(() => {
    if (!authenticated || !initialized.current || !text.trim()) return;
    const timer = window.setTimeout(() => {
      const now = new Date().toISOString(), item = { id: currentId, title: titleFor(text), text, createdAt, updatedAt: now };
      void api.saveDictate(item).then(() => setHistory((items) => [item, ...items.filter((old) => old.id !== item.id)])).catch((error) => {
        if (error instanceof ApiError && error.status === 401) requireLogin("Sitzung abgelaufen. Der lokale Text bleibt erhalten.");
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [authenticated, createdAt, currentId, requireLogin, text]);

  const pending = useMemo(() => queue.filter((item) => item.status !== "done"), [queue]);
  const orderedDictates = useMemo(() => {
    const existing = history.find((item) => item.id === currentId);
    const current: Dictate = { id: currentId, title: titleFor(text), text, createdAt, updatedAt: existing?.updatedAt ?? createdAt };
    return orderDictates(history, current);
  }, [createdAt, currentId, history, text]);
  const currentIndex = Math.max(0, orderedDictates.findIndex((item) => item.id === currentId));
  const position = currentIndex + 1, totalDictates = orderedDictates.length, isLatest = currentIndex === orderedDictates.length - 1;
  const navigationDisabled = recording || pending.length > 0;

  function changeFont(delta: number) { setFontSize((size) => clampFontSize(size + delta, MIN_FONT_SIZE, MAX_FONT_SIZE)); }
  async function saveSettings() {
    try { const saved = await api.saveSettings(settings); setSettings(saved); setSettingsOpen(false); setNotice("Einstellungen gespeichert"); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Speichern fehlgeschlagen"); }
  }
  function changeProfile(profile: Profile) {
    const next = { ...settings, profile }; setSettings(next);
    if (authenticated) void api.saveSettings(next).catch((error) => {
      if (error instanceof ApiError && error.status === 401) requireLogin("Sitzung abgelaufen. Die Profilwahl bleibt lokal erhalten.");
      setNotice(error instanceof Error ? error.message : "Profil konnte nicht gespeichert werden");
    });
  }
  async function saveCurrent() {
    if (!authenticated || !text.trim()) return true;
    const now = new Date().toISOString(), item = { id: currentId, title: titleFor(text), text, createdAt, updatedAt: now };
    try { await api.saveDictate(item); setHistory((items) => [item, ...items.filter((old) => old.id !== item.id)]); return true; }
    catch (error) { if (error instanceof ApiError && error.status === 401) requireLogin("Sitzung abgelaufen. Der lokale Text bleibt erhalten."); setNotice(error instanceof Error ? error.message : "Diktat konnte nicht gespeichert werden"); return false; }
  }
  async function newDictate() { if (recording) { stop(); setNotice("Aufnahme beendet · zuerst Warteschlange verarbeiten"); return; } if (pending.length || !(await saveCurrent())) return; setCurrentId(crypto.randomUUID()); setCreatedAt(new Date().toISOString()); setText(""); textRef.current = ""; setHistoryOpen(false); setReview(null); setNotice("Neues Diktat"); }
  async function openDictate(item: Dictate) { if (recording) { stop(); setNotice("Aufnahme beendet · zuerst Warteschlange verarbeiten"); return; } if (pending.length || !(await saveCurrent())) return; setCurrentId(item.id); setCreatedAt(item.createdAt); setText(item.text); textRef.current = item.text; setHistoryOpen(false); setNotice("Diktat geöffnet"); }
  async function navigateDictates(direction: -1 | 1) {
    const target = orderedDictates[currentIndex + direction];
    if (!target || navigationDisabled) return;
    await openDictate(target);
  }
  async function changeView(next: "dictate" | "dashboard") {
    if (next === view || recording) return;
    if (next === "dashboard" && !(await saveCurrent())) return;
    setHistoryOpen(false); setSettingsOpen(false); setView(next);
  }
  async function copy() { try { await navigator.clipboard.writeText(text); setNotice("In die Zwischenablage kopiert"); } catch { setNotice("Kopieren nicht erlaubt · Text bleibt vollständig erhalten"); } }
  function retry(id: string) { setQuota(false); setQueue((items) => items.map((item) => item.id === id ? { ...item, status: "queued", error: undefined } : item)); }
  function download(segment: Segment) { const url = URL.createObjectURL(segment.blob), link = document.createElement("a"); link.href = url; link.download = `dictate-segment-${segment.sequence + 1}.${segment.mime.includes("mp4") ? "m4a" : "webm"}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  async function beginReview(mode: "spelling" | "fillers") {
    if (!text || text.length > 40_000) { setNotice(text ? "Maximal 40.000 Zeichen können überarbeitet werden" : "Kein Text zum Überarbeiten"); return; }
    setReview({ original: text, busy: true });
    try { const result = await api.review(text, settings.profile, mode); setUsage(result.usage); setReview({ original: text, preview: result.text }); }
    catch (error) { if (error instanceof ApiError && error.status === 401) requireLogin("Sitzung abgelaufen. Der lokale Text bleibt erhalten."); setReview(null); setNotice(error instanceof Error ? error.message : "Überarbeitung fehlgeschlagen"); }
  }
  async function logout() { stop(); await saveCurrent(); await api.logout().catch(() => undefined); requireLogin("Abgemeldet. Lokaler Text und Audio bleiben erhalten."); }

  if (authenticated === null) return <div className="splash"><div className="brand-mark">D</div><span>Dictate wird geladen …</span></div>;
  return <div className="app-shell">
    <header><div className="brand"><div className="brand-mark">D</div><div><strong>Dictate</strong><span>secure voice workspace</span></div></div>
      <nav className="app-nav" aria-label="Hauptnavigation"><button className={view === "dictate" ? "active" : ""} onClick={() => void changeView("dictate")}>Diktat</button><button className={view === "dashboard" ? "active" : ""} disabled={recording} onClick={() => void changeView("dashboard")}>Dashboard</button></nav>
      <div className="header-actions"><span className="cost">Audio {money(usage.audioCost)} · Luna {money(usage.lunaCost)}</span>{view === "dictate" && <><button className="icon" onClick={() => { setHistoryOpen(!historyOpen); setSettingsOpen(false); }} title="Verlauf" aria-label="Verlauf öffnen">◷</button><button className="icon" onClick={() => { setSettingsOpen(!settingsOpen); setHistoryOpen(false); }} title="Einstellungen" aria-label="Einstellungen öffnen">⚙</button></>}<button className="logout" onClick={() => void logout()}><span>↪</span> Abmelden</button></div>
    </header>
    <main className={view === "dashboard" ? "dashboard-main" : ""}>
      {view === "dashboard" ? <Dashboard refreshKey={usage.audioSeconds + usage.lunaInputTokens + usage.lunaOutputTokens + history.length} /> : <>
      <section className="workspace">
        <div className="toolbar">
          <select value={settings.profile} onChange={(event) => changeProfile(event.target.value as Profile)} disabled={recording} aria-label="Diktatprofil">
            <option value="de-general">DE · Alltag</option><option value="en-general">EN · Everyday</option><option value="de-radiology">DE · Radiologie</option>
          </select>
          <div className={`status ${recording ? "live" : ""}`}><i />{recording ? "Aufnahme läuft" : notice}</div>
          <PipControls recording={recording} level={level} queueCount={pending.length} text={text} fontSize={fontSize} position={position} total={totalDictates} isLatest={isLatest} navigationDisabled={navigationDisabled}
            onTextChange={(value) => { textRef.current = value; setText(value); }} onToggle={() => void toggle()} onStart={() => void start()} onStop={stop} onCopy={() => void copy()} onClear={() => void newDictate()}
            onSmaller={() => changeFont(-2)} onLarger={() => changeFont(2)} onPrevious={() => void navigateDictates(-1)} onNext={() => void navigateDictates(1)} />
        </div>
        <textarea className="editor" style={{ fontSize }} value={text} onChange={(event) => { textRef.current = event.target.value; setText(event.target.value); }} placeholder="Ihr Diktat erscheint hier …" aria-label="Diktattext" />
        <div className="bottom-bar">
          <div className="action-group review-tools"><button className="ghost" onClick={() => void beginReview("spelling")}>✨ Rechtschreibung</button><button className="ghost" onClick={() => void beginReview("fillers")}>✨ Füllwörter</button></div>
          <div className="action-group dictate-nav"><button className="square" onClick={() => changeFont(-2)} disabled={fontSize <= MIN_FONT_SIZE} aria-label="Text kleiner" title="Text kleiner">A−</button><button className="square" onClick={() => changeFont(2)} disabled={fontSize >= MAX_FONT_SIZE} aria-label="Text größer" title="Text größer">A+</button><span className="nav-divider" /><button className="square" disabled={navigationDisabled || position <= 1} onClick={() => void navigateDictates(-1)} aria-label="Vorheriges Diktat">←</button><span className="dictate-position">{position} / {totalDictates}{isLatest && <em>Aktuell</em>}</span><button className="square" disabled={navigationDisabled || position >= totalDictates} onClick={() => void navigateDictates(1)} aria-label="Nächstes Diktat">→</button></div>
          <div className="action-group document-tools"><button className="ghost clear-button" disabled={navigationDisabled} onClick={() => void newDictate()}>⌫ <span>Leeren</span></button><button className="primary copy-button" disabled={!text} onClick={() => void copy()}>▣ <span>Kopieren</span></button></div>
        </div>
      </section>
      <aside className={`side-panel ${historyOpen || settingsOpen ? "open" : ""}`}>
        {historyOpen && <><div className="panel-title"><h2>Verlauf</h2><span>30 Tage</span></div><button className="new" disabled={recording || !!pending.length} onClick={() => void newDictate()}>＋ Neues Diktat</button><div className="history-list">{history.map((item) => <button key={item.id} disabled={recording || !!pending.length} className={item.id === currentId ? "selected" : ""} onClick={() => void openDictate(item)}><strong>{item.title}</strong><span>{new Date(item.updatedAt).toLocaleString("de-DE")}</span></button>)}{!history.length && <p className="empty">Noch keine gespeicherten Diktate.</p>}</div></>}
        {settingsOpen && <><div className="panel-title"><h2>Einstellungen</h2></div><label>Profil<select value={settings.profile} onChange={(event) => setSettings({ ...settings, profile: event.target.value as Profile })}><option value="de-general">DE · Alltag</option><option value="en-general">EN · Alltag</option><option value="de-radiology">DE · Radiologie</option></select></label><label>Persönliches Wörterbuch<textarea value={settings.dictionary} onChange={(event) => setSettings({ ...settings, dictionary: event.target.value })} placeholder={"Begriff\ngehört => Schreibweise"} /></label><small>Ein Eintrag pro Zeile. &lt;, &gt; und Zeilenumbrüche innerhalb eines Eintrags sind nicht erlaubt.</small><label className="check"><input type="checkbox" checked={settings.radiologyPack} disabled={settings.profile !== "de-radiology"} onChange={(event) => setSettings({ ...settings, radiologyPack: event.target.checked })} /> Radiologie-Grundpaket aktivieren</label><button className="primary" onClick={() => void saveSettings()}>Speichern</button></>}
      </aside>
      </>}
    </main>
    {view === "dictate" && <div className="record-dock"><div className="meter"><i style={{ transform: `scaleY(${Math.max(.1, Math.min(1, level * 20))})` }} /><i style={{ transform: `scaleY(${Math.max(.1, Math.min(1, level * 14))})` }} /><i style={{ transform: `scaleY(${Math.max(.1, Math.min(1, level * 24))})` }} /></div><button className={`record ${recording ? "on" : ""}`} disabled={quota || !authenticated} onClick={() => void toggle()}>{recording ? "■" : "●"}</button><span>{quota ? "Projektlimit erreicht" : recording ? "Loslassen / klicken zum Stoppen" : "Leertaste halten"}</span></div>}
    {pending.length > 0 && <div className="queue-card"><strong>Audio-Warteschlange · {pending.length}</strong>{pending.map((item) => <div key={item.id}><span>Abschnitt {item.sequence + 1} · {Math.round(item.durationMs / 1000)} s · {item.status}</span>{item.error && <em>{item.error}</em>}<span className="queue-actions">{item.status === "failed" && <button onClick={() => retry(item.id)}>Erneut senden</button>}<button onClick={() => download(item)}>Audio laden</button></span></div>)}</div>}
    {review && <div className="overlay"><div className="review-card"><h2>Überarbeitung</h2><div className="compare"><label>Original<textarea readOnly value={review.original} /></label><label>Vorschau<textarea readOnly value={review.preview ?? "Überarbeitung läuft …"} /></label></div><div className="review-actions"><button className="ghost" onClick={() => setReview(null)}>Verwerfen</button><button className="primary" disabled={!review.preview} onClick={() => { if (review.preview) setText(review.preview); setReview(null); }}>Übernehmen</button></div></div></div>}
    {!authenticated && <LoginOverlay reason={loginReason} onSuccess={() => void loadAccount()} />}
  </div>;
}
