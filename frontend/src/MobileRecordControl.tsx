import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export const MOBILE_LOCK_DISTANCE = 72;
export type MobileRecordGesture = "idle" | "holding" | "locked";

export function lockProgress(originY: number, currentY: number) {
  return Math.max(0, Math.min(1, (originY - currentY) / MOBILE_LOCK_DISTANCE));
}

interface MobileRecordControlProps {
  recording: boolean;
  disabled: boolean;
  level: number;
  queueCount: number;
  needsOnboarding: boolean;
  onPrepare: () => Promise<boolean>;
  onPrepared: () => void;
  onStart: () => void | Promise<void>;
  onStop: () => void;
}

export function MobileRecordControl({ recording, disabled, level, queueCount, needsOnboarding, onPrepare, onPrepared, onStart, onStop }: MobileRecordControlProps) {
  const [gesture, setGesture] = useState<MobileRecordGesture>("idle"), [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0), [preparing, setPreparing] = useState(false);
  const gestureRef = useRef<MobileRecordGesture>("idle"), originY = useRef(0), pointerId = useRef<number | null>(null), wasRecording = useRef(false), timerStartedAt = useRef(0);

  function updateGesture(next: MobileRecordGesture) { gestureRef.current = next; setGesture(next); }
  function resetGesture() { updateGesture("idle"); setProgress(0); pointerId.current = null; }

  useEffect(() => {
    if (recording && !wasRecording.current) { timerStartedAt.current = Date.now(); setElapsed(0); }
    if (!recording && wasRecording.current) resetGesture();
    wasRecording.current = recording;
    if (!recording) return;
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - timerStartedAt.current) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  function pointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (disabled) return;
    if (recording) { onStop(); resetGesture(); return; }
    pointerId.current = event.pointerId; originY.current = event.clientY; setProgress(0); updateGesture("holding");
    event.currentTarget.setPointerCapture?.(event.pointerId); void onStart();
  }

  function pointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (pointerId.current !== event.pointerId || gestureRef.current !== "holding") return;
    const next = lockProgress(originY.current, event.clientY); setProgress(next);
    if (next >= 1) updateGesture("locked");
  }

  function finishPointer(event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) {
    if (pointerId.current !== event.pointerId) return;
    if (gestureRef.current === "holding" || (cancelled && gestureRef.current !== "locked")) { onStop(); resetGesture(); }
    else { pointerId.current = null; setProgress(1); }
  }

  async function prepareMicrophone() {
    setPreparing(true); const ready = await onPrepare(); setPreparing(false);
    if (ready) onPrepared();
  }

  const minutes = Math.floor(elapsed / 60), seconds = String(elapsed % 60).padStart(2, "0");
  return <>
    <div className={`mobile-record-dock ${recording ? "on" : ""} ${gesture}`} aria-live="polite">
      <div className="mobile-record-status"><span>{recording ? gesture === "locked" ? "Aufnahme verriegelt" : "Aufnahme läuft" : queueCount ? `${queueCount} Abschnitt in Queue` : "Zum Aufnehmen gedrückt halten"}</span>{recording && <strong>{minutes}:{seconds}</strong>}</div>
      <div className={`mobile-lock-guide ${gesture !== "idle" ? "visible" : ""}`}><span>⌃</span><i style={{ transform: `scaleY(${Math.max(.08, progress)})` }} /><b>{gesture === "locked" ? "Verriegelt" : "Zum Verriegeln hochschieben"}</b></div>
      <button className={`mobile-record ${recording ? "on" : ""}`} disabled={disabled} aria-label={recording ? gesture === "locked" ? "Verriegelte Aufnahme stoppen" : "Aufnahme läuft" : "Für Aufnahme gedrückt halten"}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={(event) => finishPointer(event)} onPointerCancel={(event) => finishPointer(event, true)} onContextMenu={(event) => event.preventDefault()} onClick={(event) => { event.preventDefault(); if (event.detail === 0) { if (recording) onStop(); else void onStart(); } }}>
        <span>{recording ? gesture === "locked" ? "■" : "●" : "●"}</span><i style={{ transform: `scale(${1 + Math.min(.16, level * 4)})` }} />
      </button>
    </div>
    {needsOnboarding && <div className="mobile-mic-overlay"><div className="mobile-mic-card"><div className="mic-symbol">●</div><span className="eyebrow">Einmalige Vorbereitung</span><h2>Mikrofon aktivieren</h2><p>Dictate fragt den Zugriff einmal für diese Website an. Danach hältst du den Aufnahmebutton gedrückt; nach oben schieben verriegelt die Aufnahme.</p><button className="primary" disabled={preparing} onClick={() => void prepareMicrophone()}>{preparing ? "Mikrofon wird geprüft …" : "Mikrofon aktivieren"}</button><small>Die Freigabe wird von iOS verwaltet und kann jederzeit in den Safari-Website-Einstellungen widerrufen werden.</small></div></div>}
  </>;
}
