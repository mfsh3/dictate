import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { Vault } from "../src/crypto.js";
import { Store } from "../src/db.js";
import { OpenAIService } from "../src/openai.js";
import { parseDictionary } from "../src/prompts.js";
import { prepareState } from "../src/security.js";

const dirs: string[] = [];
afterEach(() => { vi.useRealTimers(); while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function fixture(fetcher: typeof fetch = vi.fn(async (url: string | URL | Request) => {
  if (String(url).includes("audio/transcriptions")) return new Response(JSON.stringify({ text: "Testtranskript." }), { status: 200, headers: { "content-type": "application/json" } });
  return new Response(JSON.stringify({ output_text: "Korrigierter Text.", usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch) {
  const stateDir = mkdtempSync(path.join(tmpdir(), "dictate-test-")); dirs.push(stateDir); chmodSync(stateDir, 0o700);
  const config = loadConfig({ NODE_ENV: "test", STATE_DIR: stateDir, AUTH_MODE: "mock", MOCK_ADMIN_EMAIL: "admin@example.test", MOCK_ADMIN_PASSWORD: "secret" });
  const key = prepareState(stateDir, config.dbPath, config.keyPath), store = new Store(config.dbPath, new Vault(key));
  const auth = new AuthService(config), openai = new OpenAIService("test-key", fetcher);
  return { stateDir, config, store, auth, app: createApp({ config, store, auth, openai }), fetcher };
}

async function login(app: ReturnType<typeof createApp>) {
  const result = await request(app).post("/api/auth/login").send({ email: "admin@example.test", password: "secret" }).expect(200);
  const cookies = result.headers["set-cookie"] as unknown as string[];
  expect(cookies[0]).toContain("dictate_sid="); expect(cookies[0]).toContain("HttpOnly"); expect(cookies[0]).toContain("Secure"); expect(cookies[0]).toContain("SameSite=Strict");
  return cookies[0]!.split(";")[0]!;
}

describe("security and persistence", () => {
  it("encrypts authenticated content and rejects tampering", async () => {
    const { app, store } = fixture(); const cookie = await login(app);
    await request(app).put("/api/settings").set("Cookie", cookie).send({ profile: "de-general", dictionary: "geheim => Geheimwort", radiologyPack: true }).expect(200);
    const raw = store.db.prepare("SELECT settings_enc FROM users LIMIT 1").get() as { settings_enc: Buffer };
    expect(raw.settings_enc.toString("utf8")).not.toContain("Geheimwort");
    const vault = new Vault(Buffer.alloc(32, 7)), encrypted = vault.encrypt("sensibel"); encrypted[encrypted.length - 1]! ^= 1;
    expect(() => vault.decrypt(encrypted)).toThrow(); store.close();
  });

  it("refuses insecure state permissions", () => {
    const stateDir = mkdtempSync(path.join(tmpdir(), "dictate-perms-")); dirs.push(stateDir); chmodSync(stateDir, 0o755);
    expect(() => prepareState(stateDir, path.join(stateDir, "dictate.db"), path.join(stateDir, "data.key"))).toThrow(/unsichere Rechte/);
  });

  it("validates and deduplicates dictionary entries", () => {
    expect(parseDictionary("MRT\nmrt\ngehört => geschrieben")).toHaveLength(2);
    expect(() => parseDictionary("böse < Eingabe")).toThrow(/Ungültiger/);
  });

  it("physically removes dictates older than 30 days", () => {
    const item = fixture(); item.store.ensureUser("user");
    const old = new Date(Date.now() - 31 * 86400_000).toISOString();
    item.store.upsertDictate("user", { id: crypto.randomUUID(), title: "Alt", text: "Alt", createdAt: old, updatedAt: old });
    expect(item.store.listDictates("user")).toHaveLength(1); item.store.cleanup(); expect(item.store.listDictates("user")).toHaveLength(0); item.store.close();
  });

  it("removes daily aggregates after the 400 day statistics window", () => {
    const item = fixture(); item.store.ensureUser("user");
    const old = new Date(Date.now() - 401 * 86400_000).toISOString().slice(0, 10), today = new Date().toISOString().slice(0, 10);
    item.store.db.prepare("INSERT INTO usage_daily(user_id,day,audio_seconds) VALUES(?,?,?)").run("user", old, 60);
    item.store.db.prepare("INSERT INTO usage_daily(user_id,day,audio_seconds) VALUES(?,?,?)").run("user", today, 60);
    item.store.cleanup();
    expect((item.store.db.prepare("SELECT count(*) AS count FROM usage_daily").get() as { count: number }).count).toBe(1); item.store.close();
  });
});

describe("sessions and API", () => {
  it("requires a session and loses in-memory sessions after restart", async () => {
    const item = fixture(); await request(item.app).get("/api/me").expect(401); const cookie = await login(item.app);
    await request(item.app).get("/api/me").set("Cookie", cookie).expect(200);
    const restarted = createApp({ config: item.config, store: item.store, auth: new AuthService(item.config), openai: new OpenAIService("test") });
    await request(restarted).get("/api/me").set("Cookie", cookie).expect(401); item.store.close();
  });

  it("transcribes in memory and charges an idempotency key only once", async () => {
    const item = fixture(); const cookie = await login(item.app);
    const send = () => request(item.app).post("/api/transcribe").set("Cookie", cookie).field("clientId", "client_123456").field("sequence", "1").field("durationMs", "1000").field("profile", "de-radiology").field("previous", "Kontext").attach("audio", Buffer.from("fake-audio"), { filename: "test.webm", contentType: "audio/webm" });
    const first = await send().expect(200), second = await send().expect(200);
    expect(first.body.duplicate).toBe(false); expect(second.body.duplicate).toBe(true); expect(second.body.text).toBe("Testtranskript.");
    expect(item.fetcher).toHaveBeenCalledTimes(1);
    const form = (vi.mocked(item.fetcher).mock.calls[0]![1]!.body as FormData);
    expect(form.getAll("languages[]")).toEqual(["de"]); expect(form.getAll("keywords[]")).toContain("BI-RADS"); expect(form.has("language")).toBe(false); expect(form.get("prompt")).toContain("Kontext");
    expect(item.store.usage(first.body.userId ?? (item.store.db.prepare("SELECT id FROM users LIMIT 1").get() as { id: string }).id).audioSeconds).toBe(1); item.store.close();
  });

  it("enforces the 4 MB audio ceiling", async () => {
    const item = fixture(); const cookie = await login(item.app);
    await request(item.app).post("/api/transcribe").set("Cookie", cookie).field("clientId", "client_123456").field("sequence", "2").field("durationMs", "1000").field("profile", "de-general").attach("audio", Buffer.alloc(4 * 1024 * 1024 + 1), { filename: "large.webm", contentType: "audio/webm" }).expect(413);
    item.store.close();
  });

  it("sends the reviewed text contract and records actual token usage", async () => {
    const item = fixture(); const cookie = await login(item.app);
    const result = await request(item.app).post("/api/review").set("Cookie", cookie).send({ text: "Tset.", profile: "de-general", mode: "spelling" }).expect(200);
    expect(result.body.text).toBe("Korrigierter Text."); expect(result.body.usage.lunaInputTokens).toBe(10); expect(result.body.usage.lunaOutputTokens).toBe(5);
    const body = JSON.parse(String(vi.mocked(item.fetcher).mock.calls[0]![1]!.body));
    expect(body).toMatchObject({ model: "gpt-5.6-luna", reasoning: { effort: "none" }, store: false, max_output_tokens: 8192 }); item.store.close();
  });

  it("counts every login submission and caps a client at two attempts", async () => {
    const item = fixture();
    await request(item.app).post("/api/auth/login").send({ email: "invalid", password: "x" }).expect(400);
    await request(item.app).post("/api/auth/login").send({ email: "admin@example.test", password: "wrong" }).expect(401);
    await request(item.app).post("/api/auth/login").send({ email: "admin@example.test", password: "secret" }).expect(429); item.store.close();
  });

  it("does not confuse an upstream OpenAI 401 with an expired Dictate session", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401, headers: { "content-type": "application/json" } })) as typeof fetch;
    const item = fixture(fetcher), cookie = await login(item.app);
    const result = await request(item.app).post("/api/transcribe").set("Cookie", cookie).field("clientId", "client_123456").field("sequence", "8").field("durationMs", "1000").field("profile", "de-general").attach("audio", Buffer.from("audio"), { filename: "test.webm", contentType: "audio/webm" }).expect(502);
    expect(result.body.error.code).toBe("OPENAI_ERROR"); item.store.close();
  });

  it("returns daily dashboard totals and counts a dictate only once", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-08-21T12:00:00.000Z"));
    const item = fixture(), cookie = await login(item.app);
    const userId = (item.store.db.prepare("SELECT id FROM users LIMIT 1").get() as { id: string }).id;
    const dictate = { id: crypto.randomUUID(), title: "Befund", text: "Ein Diktat.", createdAt: "2026-08-20T08:00:00.000Z", updatedAt: "2026-08-20T08:00:00.000Z" };
    await request(item.app).put(`/api/dictates/${dictate.id}`).set("Cookie", cookie).send(dictate).expect(200);
    await request(item.app).put(`/api/dictates/${dictate.id}`).set("Cookie", cookie).send({ ...dictate, text: "Bearbeitet.", updatedAt: "2026-08-21T09:00:00.000Z" }).expect(200);
    item.store.addAudioUsage(userId, 120); item.store.addLunaUsage(userId, 1_000_000, 0, 1_000_000);
    const result = await request(item.app).get("/api/dashboard?days=7").set("Cookie", cookie).expect(200);
    expect(result.body.bucket).toBe("day"); expect(result.body.points).toHaveLength(7);
    expect(result.body.summary).toMatchObject({ dictates: 1, audioSeconds: 120 });
    expect(result.body.summary.audioCost).toBeCloseTo(0.009); expect(result.body.summary.lunaCost).toBeCloseTo(1.4);
    expect(result.body.costTrackingSince).toBe("2026-08-21T12:00:00.000Z"); item.store.close();
  });

  it("validates dashboard ranges and groups a year by month", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-08-21T12:00:00.000Z"));
    const item = fixture(), cookie = await login(item.app);
    await request(item.app).get("/api/dashboard?days=14").set("Cookie", cookie).expect(400);
    const result = await request(item.app).get("/api/dashboard?days=365").set("Cookie", cookie).expect(200);
    expect(result.body.bucket).toBe("month"); expect(result.body.points[0].period).toMatch(/^2025-/); item.store.close();
  });
});
