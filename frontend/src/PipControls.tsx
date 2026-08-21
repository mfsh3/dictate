import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type CSSProperties } from "react";

declare global {
  interface Window { documentPictureInPicture?: { requestWindow(options: { width: number; height: number }): Promise<Window> } }
}

const pipCss = `
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#f5f3f8;background:#0b0e13;--purple:#9d82ff;--line:#2b303a;--muted:#9299a8}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 50% -20%,#27203d 0,transparent 52%),#0b0e13;color:#f5f3f8}
button,textarea{font:inherit}.pip{height:100vh;display:flex;flex-direction:column;padding:14px;gap:10px}.pip-head,.pip-actions,.pip-nav{display:flex;align-items:center;gap:7px}.pip-head strong{font-size:13px}.pip-head span{margin-left:auto;color:var(--muted);font-size:10px}.pip textarea{min-height:0;flex:1;resize:none;border:1px solid var(--line);border-radius:13px;background:#10141b;color:#f3f2f5;padding:16px;font-size:var(--editor-size);line-height:1.65;outline:none}.pip textarea:focus{border-color:#745fe0;box-shadow:0 0 0 3px #8068ef1f}.pip-actions{justify-content:space-between}.pip-actions>div{display:flex;gap:6px}.pip button{border:1px solid var(--line);border-radius:9px;background:#171c24;color:#c9ced8;padding:7px 10px;cursor:pointer}.pip button:hover{background:#212734;color:white}.pip button:disabled{opacity:.35;cursor:default}.pip .copy{background:#7860e8;border-color:#7860e8;color:white}.pip .rec{width:42px;height:42px;padding:0;border:0;border-radius:50%;background:linear-gradient(145deg,#7256e8,#a68eff);color:white;font-size:17px;box-shadow:0 0 24px #8065e850}.pip .rec.on{background:#ef5b72;box-shadow:0 0 26px #ef5b7270}.pip-nav{justify-content:center}.pip-nav span{min-width:92px;text-align:center;font-size:10px;color:#b5bac4}.meter{width:42px;height:3px;background:#242a34;border-radius:4px;overflow:hidden}.meter i{display:block;width:100%;height:100%;background:var(--purple);transform-origin:left}.status{color:var(--muted);font-size:10px}
`;

interface PipProps {
  recording: boolean; level: number; queueCount: number; text: string; fontSize: number;
  position: number; total: number; isLatest: boolean; navigationDisabled: boolean;
  onTextChange: (value: string) => void; onToggle: () => void; onStart: () => void; onStop: () => void;
  onCopy: () => void; onClear: () => void; onSmaller: () => void; onLarger: () => void;
  onPrevious: () => void; onNext: () => void;
}

export function isPipControl(target: EventTarget | null) {
  return typeof (target as Element | null)?.matches === "function" && (target as Element).matches("textarea,input,select,button,[contenteditable=true]");
}

export function PipControls(props: PipProps) {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const startRef = useRef(props.onStart), stopRef = useRef(props.onStop); startRef.current = props.onStart; stopRef.current = props.onStop;
  useEffect(() => () => pipWindow?.close(), [pipWindow]);
  async function open() {
    if (!window.documentPictureInPicture) return;
    const child = await window.documentPictureInPicture.requestWindow({ width: 560, height: 430 });
    const style = child.document.createElement("style"); style.textContent = pipCss; child.document.head.append(style);
    const root = child.document.createElement("div"); child.document.body.append(root);
    child.addEventListener("keydown", (event) => {
      if (isPipControl(event.target)) return;
      if (event.code === "Space" && !event.repeat) { event.preventDefault(); startRef.current(); }
      else if (event.code === "Escape") { event.preventDefault(); stopRef.current(); }
    });
    child.addEventListener("keyup", (event) => { if (!isPipControl(event.target) && event.code === "Space") { event.preventDefault(); stopRef.current(); } });
    child.addEventListener("pagehide", () => setPipWindow(null), { once: true }); setPipWindow(child);
  }
  return <>
    <button className="ghost pip-button" onClick={() => void open()} disabled={!window.documentPictureInPicture || !!pipWindow}>PiP</button>
    {pipWindow && createPortal(<div className="pip" style={{ "--editor-size": `${props.fontSize}px` } as CSSProperties}>
      <div className="pip-head"><strong>Dictate</strong><div className="meter"><i style={{ transform: `scaleX(${Math.min(1, props.level * 18)})` }} /></div><span>{props.recording ? "Aufnahme läuft" : props.queueCount ? `${props.queueCount} in Queue` : "Bereit"}</span></div>
      <textarea value={props.text} onChange={(event) => props.onTextChange(event.target.value)} placeholder="Ihr Diktat erscheint hier …" aria-label="Diktattext im PiP" />
      <div className="pip-nav"><button disabled={props.navigationDisabled || props.position <= 1} onClick={props.onPrevious} aria-label="Vorheriges Diktat">←</button><span>{props.position} / {props.total}{props.isLatest ? " · Aktuell" : ""}</span><button disabled={props.navigationDisabled || props.position >= props.total} onClick={props.onNext} aria-label="Nächstes Diktat">→</button></div>
      <div className="pip-actions"><div><button onClick={props.onSmaller} aria-label="Text kleiner">A−</button><button onClick={props.onLarger} aria-label="Text größer">A+</button><button disabled={props.navigationDisabled} onClick={props.onClear}>Leeren</button></div><div><button className="copy" disabled={!props.text} onClick={props.onCopy}>Kopieren</button><button className={`rec ${props.recording ? "on" : ""}`} onClick={props.onToggle} aria-label={props.recording ? "Aufnahme stoppen" : "Aufnahme starten"}>{props.recording ? "■" : "●"}</button></div></div>
    </div>, pipWindow.document.body)}
  </>;
}
