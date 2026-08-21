import { useState, type FormEvent } from "react";
import { api } from "./api";

export function LoginOverlay({ onSuccess, reason }: { onSuccess: () => void; reason?: string }) {
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [error, setError] = useState(reason ?? ""), [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api.login(email, password); setPassword(""); onSuccess(); }
    catch (value) { setError(value instanceof Error ? value.message : "Anmeldung fehlgeschlagen"); }
    finally { setBusy(false); }
  }
  return <div className="overlay" role="dialog" aria-modal="true" aria-label="Anmeldung">
    <form className="login-card" onSubmit={submit}>
      <div className="brand-mark">D</div><h1>Dictate</h1>
      <p>Mit RadsUp-Dev anmelden</p>
      <label>E-Mail<input autoFocus type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <label>Passwort<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
      {error && <div className="error" role="alert">{error}</div>}
      <button className="primary" disabled={busy}>{busy ? "Anmeldung läuft …" : "Anmelden"}</button>
      <small>E-Mail und Passwort werden nur an RadsUp-Dev weitergereicht und nicht gespeichert.</small>
    </form>
  </div>;
}
