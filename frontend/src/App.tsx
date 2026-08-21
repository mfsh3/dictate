import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { LoginOverlay } from "./LoginOverlay";
import { PipControls } from "./PipControls";
import { useRecorder } from "./useRecorder";
import type { Dictate, Profile, Segment, Settings, Usage } from "./types";
import { appendTranscript, nextProcessable } from "./queue";

const DEFAULT_SETTINGS: Settings = { profile: "de-general", dictionary: "", radiologyPack: true };
const EMPTY_USAGE: Usage = { month: "", audioSeconds: 0, lunaInputTokens: 0, lunaCachedTokens: 0, lunaOutputTokens: 0, audioCost: 0, lunaCost: 0 };
const clientId = (() => { const found = sessionStorage.getItem("dictate_client_id"); const value = found ?? crypto.randomUUID().replaceAll("-", ""); sessionStorage.setItem("dictate_client_id", value); return value; })();

function titleFor(text: string) { return text.trim().split("\n")[0]?.slice(0, 70) || "Neues Diktat"; }
function money(value: number) { return `$${value.toFixed(value < 0.01 ? 4 : 2)}`; }

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null), [loginReason, setLoginReason] = useState("");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS), [settingsOpen, setSettingsOpen] = useState(false);
  const [history, setHistory] = useState<Dictate[]>([]), [historyOpen, setHistoryOpen] = useState(false);
  const [currentId, setCurrentId] = useState<string>(crypto.randomUUID()), [createdAt, setCreatedAt] = useState(new Date().toISOString());
  const [text, setText] = useState(""), [queue, setQueue] = useState<Segment[]>([]), [usage, setUsage] = useState(EMPTY_USAGE);
  const [notice, setNotice] = useState("Bereit · Leertaste halten oder klicken"), [quota, setQuota] = useState(false);
  const [review, setReview] = useState<{ original: string; preview?: string; busy?: boolean } | null>(null);
  const sequence = useRef(0), processing = useRef(false), initialized = useRef(false), textRef = useRef(text);
  textRef.current = text;

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
      <div className="header-actions"><span className="cost">Audio {money(usage.audioCost)} · Luna {money(usage.lunaCost)}</span><button className="icon" onClick={() => setHistoryOpen(!historyOpen)} title="Verlauf">◷</button><button className="icon" onClick={() => setSettingsOpen(!settingsOpen)} title="Einstellungen">⚙</button><button className="avatar" onClick={() => void logout()} title="Abmelden">A</button></div>
    </header>
    <main>
      <section className="workspace">
        <div className="toolbar">
          <select value={settings.profile} onChange={(event) => changeProfile(event.target.value as Profile)} disabled={recording} aria-label="Diktatprofil">
            <option value="de-general">DE · Alltag</option><option value="en-general">EN · Everyday</option><option value="de-radiology">DE · Radiologie</option>
          </select>
          <div className={`status ${recording ? "live" : ""}`}><i />{recording ? "Aufnahme läuft" : notice}</div>
          <PipControls recording={recording} level={level} queueCount={pending.length} onToggle={() => void toggle()} onStart={() => void start()} onStop={stop} />
        </div>
        <textarea className="editor" value={text} onChange={(event) => setText(event.target.value)} placeholder="Ihr Diktat erscheint hier …" aria-label="Diktattext" />
        <div className="bottom-bar">
          <button className="ghost" onClick={() => void beginReview("spelling")}>✨ Rechtschreibung</button>
          <button className="ghost" onClick={() => void beginReview("fillers")}>✨ Füllwörter</button>
          <span className="spacer" />
          <button className="ghost" disabled={recording || !!pending.length} onClick={() => void newDictate()}>Leeren</button><button className="primary compact" onClick={() => void copy()}>Kopieren</button>
        </div>
      </section>
      <aside className={`side-panel ${historyOpen || settingsOpen ? "open" : ""}`}>
        {historyOpen && <><div className="panel-title"><h2>Verlauf</h2><span>30 Tage</span></div><button className="new" disabled={recording || !!pending.length} onClick={() => void newDictate()}>＋ Neues Diktat</button><div className="history-list">{history.map((item) => <button key={item.id} disabled={recording || !!pending.length} className={item.id === currentId ? "selected" : ""} onClick={() => void openDictate(item)}><strong>{item.title}</strong><span>{new Date(item.updatedAt).toLocaleString("de-DE")}</span></button>)}{!history.length && <p className="empty">Noch keine gespeicherten Diktate.</p>}</div></>}
        {settingsOpen && <><div className="panel-title"><h2>Einstellungen</h2></div><label>Profil<select value={settings.profile} onChange={(event) => setSettings({ ...settings, profile: event.target.value as Profile })}><option value="de-general">DE · Alltag</option><option value="en-general">EN · Alltag</option><option value="de-radiology">DE · Radiologie</option></select></label><label>Persönliches Wörterbuch<textarea value={settings.dictionary} onChange={(event) => setSettings({ ...settings, dictionary: event.target.value })} placeholder={"Begriff\ngehört => Schreibweise"} /></label><small>Ein Eintrag pro Zeile. &lt;, &gt; und Zeilenumbrüche innerhalb eines Eintrags sind nicht erlaubt.</small><label className="check"><input type="checkbox" checked={settings.radiologyPack} disabled={settings.profile !== "de-radiology"} onChange={(event) => setSettings({ ...settings, radiologyPack: event.target.checked })} /> Radiologie-Grundpaket aktivieren</label><button className="primary" onClick={() => void saveSettings()}>Speichern</button></>}
      </aside>
    </main>
    <div className="record-dock"><div className="meter"><i style={{ transform: `scaleY(${Math.max(.1, Math.min(1, level * 20))})` }} /><i style={{ transform: `scaleY(${Math.max(.1, Math.min(1, level * 14))})` }} /><i style={{ transform: `scaleY(${Math.max(.1, Math.min(1, level * 24))})` }} /></div><button className={`record ${recording ? "on" : ""}`} disabled={quota || !authenticated} onClick={() => void toggle()}>{recording ? "■" : "●"}</button><span>{quota ? "Projektlimit erreicht" : recording ? "Loslassen / klicken zum Stoppen" : "Leertaste halten"}</span></div>
    {pending.length > 0 && <div className="queue-card"><strong>Audio-Warteschlange · {pending.length}</strong>{pending.map((item) => <div key={item.id}><span>Abschnitt {item.sequence + 1} · {Math.round(item.durationMs / 1000)} s · {item.status}</span>{item.error && <em>{item.error}</em>}<span className="queue-actions">{item.status === "failed" && <button onClick={() => retry(item.id)}>Erneut senden</button>}<button onClick={() => download(item)}>Audio laden</button></span></div>)}</div>}
    {review && <div className="overlay"><div className="review-card"><h2>Überarbeitung</h2><div className="compare"><label>Original<textarea readOnly value={review.original} /></label><label>Vorschau<textarea readOnly value={review.preview ?? "Überarbeitung läuft …"} /></label></div><div className="review-actions"><button className="ghost" onClick={() => setReview(null)}>Verwerfen</button><button className="primary" disabled={!review.preview} onClick={() => { if (review.preview) setText(review.preview); setReview(null); }}>Übernehmen</button></div></div></div>}
    {!authenticated && <LoginOverlay reason={loginReason} onSuccess={() => void loadAccount()} />}
  </div>;
}
