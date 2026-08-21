import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window { documentPictureInPicture?: { requestWindow(options: { width: number; height: number }): Promise<Window> } }
}

const pipCss = `
*{box-sizing:border-box}body{margin:0;background:#0e0e0f;color:white;font:14px Inter,system-ui,sans-serif}
.pip{height:100vh;display:grid;place-items:center;grid-template-columns:1fr auto 1fr;padding:18px;background:radial-gradient(circle at 50% 10%,#281d48,#0e0e0f 60%)}
.pip .label{color:#aaa;font-size:12px;justify-self:end;margin-right:20px}.pip .rec{width:74px;height:74px;border:0;border-radius:50%;background:linear-gradient(135deg,#7e51ff,#b6a0ff);color:white;font-size:28px;box-shadow:0 0 30px #7e51ff66;cursor:pointer}.pip .rec.on{background:#ff5570;box-shadow:0 0 35px #ff557088}.pip .meta{font-size:11px;color:#8c8a8e;margin-left:20px}.pip .bar{height:4px;background:#b6a0ff;border-radius:9px;margin-top:6px;transform-origin:left}
`;

export function PipControls({ recording, level, queueCount, onToggle, onStart, onStop }: { recording: boolean; level: number; queueCount: number; onToggle: () => void; onStart: () => void; onStop: () => void }) {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const startRef = useRef(onStart), stopRef = useRef(onStop); startRef.current = onStart; stopRef.current = onStop;
  useEffect(() => () => pipWindow?.close(), [pipWindow]);
  async function open() {
    if (!window.documentPictureInPicture) return;
    const child = await window.documentPictureInPicture.requestWindow({ width: 430, height: 160 });
    const style = child.document.createElement("style"); style.textContent = pipCss; child.document.head.append(style);
    const root = child.document.createElement("div"); child.document.body.append(root);
    child.addEventListener("keydown", (event) => { if (event.code === "Space" && !event.repeat) { event.preventDefault(); startRef.current(); } else if (event.code === "Escape") { event.preventDefault(); stopRef.current(); } });
    child.addEventListener("keyup", (event) => { if (event.code === "Space") { event.preventDefault(); stopRef.current(); } });
    child.addEventListener("pagehide", () => setPipWindow(null), { once: true }); setPipWindow(child);
  }
  return <>
    <button className="ghost pip-button" onClick={open} disabled={!window.documentPictureInPicture || !!pipWindow}>PiP</button>
    {pipWindow && createPortal(<div className="pip">
      <div className="label">{recording ? "Aufnahme läuft" : "Leertaste = Aufnahme"}</div>
      <button className={`rec ${recording ? "on" : ""}`} onClick={onToggle}>{recording ? "■" : "●"}</button>
      <div className="meta">Queue {queueCount}<div className="bar" style={{ transform: `scaleX(${Math.min(1, level * 18)})` }} /></div>
    </div>, pipWindow.document.body)}
  </>;
}
