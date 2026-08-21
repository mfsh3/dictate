import { createHash, randomBytes } from "node:crypto";
import https from "node:https";
import type { NextFunction, Request, Response } from "express";
import type { Config } from "./config.js";
import type { AuthedRequest, SessionUser } from "./types.js";
import { assertPinnedCa } from "./security.js";

const SESSION_MS = 8 * 3600_000;

interface Session { user: SessionUser; expiresAt: number }

export class AuthService {
  private readonly sessions = new Map<string, Session>();
  private readonly ipAttempts = new Map<string, number[]>();
  private globalAttempts: number[] = [];
  private lastRateSweep = 0;

  constructor(private readonly config: Config) {}

  private rateLimit(ip: string) {
    const cutoff = Date.now() - 60_000;
    if (Date.now() - this.lastRateSweep > 60_000) {
      for (const [key, values] of this.ipAttempts) {
        const active = values.filter((time) => time > cutoff);
        if (active.length) this.ipAttempts.set(key, active); else this.ipAttempts.delete(key);
      }
      this.lastRateSweep = Date.now();
    }
    const perIp = (this.ipAttempts.get(ip) ?? []).filter((time) => time > cutoff);
    this.globalAttempts = this.globalAttempts.filter((time) => time > cutoff);
    if (perIp.length >= 2) throw Object.assign(new Error("Zu viele Loginversuche von diesem Client. Bitte eine Minute warten."), { status: 429 });
    if (this.globalAttempts.length >= 4) throw Object.assign(new Error("Login ist kurzzeitig ausgelastet. Bitte eine Minute warten."), { status: 429 });
    perIp.push(Date.now()); this.globalAttempts.push(Date.now()); this.ipAttempts.set(ip, perIp);
  }

  beginLoginAttempt(clientIp: string) { this.rateLimit(clientIp); }

  async login(email: string, password: string): Promise<SessionUser> {
    if (this.config.authMode === "mock") {
      if (email.toLowerCase() !== this.config.mockEmail || password !== this.config.mockPassword) {
        throw Object.assign(new Error("E-Mail oder Passwort ist ungültig."), { status: 401 });
      }
      return { id: createHash("sha256").update(email.toLowerCase()).digest("hex"), email: email.toLowerCase(), role: "ADMIN" };
    }
    const result = await this.radsupLogin(email, password);
    if (result?.user?.role !== "ADMIN") throw Object.assign(new Error("Dictate ist nur für Administratoren freigegeben."), { status: 403 });
    const userEmail = typeof result.user.email === "string" ? result.user.email.toLowerCase() : email.toLowerCase();
    const externalId = typeof result.user.id === "string" ? result.user.id : userEmail;
    return { id: createHash("sha256").update(`radsup:${externalId}`).digest("hex"), email: userEmail, role: "ADMIN" };
  }

  private radsupLogin(email: string, password: string): Promise<any> {
    const url = new URL(this.config.radsupUrl);
    const body = JSON.stringify({ email, password });
    const ca = assertPinnedCa(this.config.radsupCaPath);
    return new Promise((resolve, reject) => {
      const request = https.request({
        protocol: url.protocol, hostname: url.hostname, port: url.port || 443, path: `${url.pathname}${url.search}`,
        method: "POST", ca, servername: url.hostname, rejectUnauthorized: true,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), "user-agent": "Dictate-MVP/1" },
        timeout: 10_000
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          let parsed: any = {};
          try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {}
          if ((response.statusCode ?? 500) >= 400) return reject(Object.assign(new Error("E-Mail oder Passwort ist ungültig."), { status: 401 }));
          resolve(parsed);
        });
      });
      request.on("timeout", () => request.destroy(new Error("RadsUp-Dev antwortet nicht.")));
      request.on("error", (error) => {
        const tls = /certificate|self.signed|issuer|expired|hostname/i.test(error.message);
        reject(Object.assign(new Error(tls ? "Die sichere Verbindung zu RadsUp-Dev konnte nicht verifiziert werden." : "RadsUp-Dev ist derzeit nicht erreichbar."), { status: 503 }));
      });
      request.end(body);
    });
  }

  createSession(user: SessionUser, response: Response) {
    const id = randomBytes(32).toString("base64url");
    this.sessions.set(id, { user, expiresAt: Date.now() + SESSION_MS });
    response.cookie("dictate_sid", id, { httpOnly: true, secure: true, sameSite: "strict", maxAge: SESSION_MS, path: "/" });
  }

  destroySession(id: string | undefined, response: Response) {
    if (id) this.sessions.delete(id);
    response.clearCookie("dictate_sid", { httpOnly: true, secure: true, sameSite: "strict", path: "/" });
  }

  middleware = (request: Request, response: Response, next: NextFunction) => {
    const authed = request as AuthedRequest;
    const id = request.cookies?.dictate_sid as string | undefined;
    const session = id ? this.sessions.get(id) : undefined;
    if (!session || session.expiresAt <= Date.now()) {
      if (id) this.sessions.delete(id);
      return response.status(401).json({ error: { code: "SESSION_REQUIRED", message: "Bitte erneut anmelden." } });
    }
    authed.user = session.user; authed.sessionId = id; next();
  };
}
