import Database from "better-sqlite3";
import { chmodSync } from "node:fs";
import type { Profile } from "./types.js";
import { Vault } from "./crypto.js";

export interface Settings {
  profile: Profile;
  dictionary: string;
  radiologyPack: boolean;
}

export interface DictateRecord {
  id: string;
  title: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_SETTINGS: Settings = { profile: "de-general", dictionary: "", radiologyPack: true };

export class Store {
  readonly db: Database.Database;

  constructor(dbPath: string, private readonly vault: Vault) {
    this.db = new Database(dbPath);
    chmodSync(dbPath, 0o600);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        settings_enc BLOB,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS dictates (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title_enc BLOB NOT NULL,
        text_enc BLOB NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS dictates_user_updated ON dictates(user_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS idempotency (
        user_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('processing','done')),
        response_enc BLOB,
        expires_at TEXT NOT NULL,
        PRIMARY KEY(user_id, client_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS usage (
        user_id TEXT NOT NULL,
        month TEXT NOT NULL,
        audio_seconds REAL NOT NULL DEFAULT 0,
        luna_input_tokens INTEGER NOT NULL DEFAULT 0,
        luna_cached_tokens INTEGER NOT NULL DEFAULT 0,
        luna_output_tokens INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(user_id, month)
      );
    `);
  }

  close() { this.db.close(); }

  ensureUser(id: string) {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO users(id,created_at,updated_at) VALUES(?,?,?)
      ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at`).run(id, now, now);
  }

  getSettings(userId: string): Settings {
    const row = this.db.prepare("SELECT settings_enc FROM users WHERE id=?").get(userId) as { settings_enc: Buffer | null } | undefined;
    if (!row?.settings_enc) return DEFAULT_SETTINGS;
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(this.vault.decrypt(row.settings_enc)) }; }
    catch { throw new Error("Gespeicherte Einstellungen konnten nicht entschlüsselt werden"); }
  }

  setSettings(userId: string, settings: Settings) {
    this.db.prepare("UPDATE users SET settings_enc=?, updated_at=? WHERE id=?")
      .run(this.vault.encrypt(JSON.stringify(settings)), new Date().toISOString(), userId);
  }

  listDictates(userId: string): DictateRecord[] {
    const rows = this.db.prepare("SELECT * FROM dictates WHERE user_id=? ORDER BY updated_at DESC LIMIT 100").all(userId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id), title: this.vault.decrypt(row.title_enc as Buffer), text: this.vault.decrypt(row.text_enc as Buffer),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at)
    }));
  }

  upsertDictate(userId: string, item: DictateRecord) {
    this.db.prepare(`INSERT INTO dictates(id,user_id,title_enc,text_enc,created_at,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title_enc=excluded.title_enc,text_enc=excluded.text_enc,updated_at=excluded.updated_at
      WHERE user_id=excluded.user_id AND dictates.updated_at <= excluded.updated_at`).run(
        item.id, userId, this.vault.encrypt(item.title), this.vault.encrypt(item.text), item.createdAt, item.updatedAt
      );
  }

  deleteDictate(userId: string, id: string) {
    return this.db.prepare("DELETE FROM dictates WHERE user_id=? AND id=?").run(userId, id).changes > 0;
  }

  cleanup() {
    const dictatesCutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
    const idemCutoff = new Date().toISOString();
    this.db.prepare("DELETE FROM dictates WHERE updated_at < ?").run(dictatesCutoff);
    this.db.prepare("DELETE FROM idempotency WHERE expires_at < ?").run(idemCutoff);
  }

  reserve(userId: string, clientId: string, sequence: number) {
    const found = this.db.prepare("SELECT status,response_enc FROM idempotency WHERE user_id=? AND client_id=? AND sequence=?")
      .get(userId, clientId, sequence) as { status: "processing" | "done"; response_enc: Buffer | null } | undefined;
    if (found) return { status: found.status, response: found.response_enc ? this.vault.decrypt(found.response_enc) : null };
    this.db.prepare("INSERT INTO idempotency(user_id,client_id,sequence,status,expires_at) VALUES(?,?,?,'processing',?)")
      .run(userId, clientId, sequence, new Date(Date.now() + 24 * 3600_000).toISOString());
    return { status: "new" as const, response: null };
  }

  complete(userId: string, clientId: string, sequence: number, response: string) {
    this.db.prepare("UPDATE idempotency SET status='done',response_enc=? WHERE user_id=? AND client_id=? AND sequence=?")
      .run(this.vault.encrypt(response), userId, clientId, sequence);
  }

  release(userId: string, clientId: string, sequence: number) {
    this.db.prepare("DELETE FROM idempotency WHERE user_id=? AND client_id=? AND sequence=? AND status='processing'")
      .run(userId, clientId, sequence);
  }

  addAudioUsage(userId: string, seconds: number) {
    const month = new Date().toISOString().slice(0, 7);
    this.db.prepare(`INSERT INTO usage(user_id,month,audio_seconds) VALUES(?,?,?)
      ON CONFLICT(user_id,month) DO UPDATE SET audio_seconds=audio_seconds+excluded.audio_seconds`).run(userId, month, seconds);
  }

  addLunaUsage(userId: string, input: number, cached: number, output: number) {
    const month = new Date().toISOString().slice(0, 7);
    this.db.prepare(`INSERT INTO usage(user_id,month,luna_input_tokens,luna_cached_tokens,luna_output_tokens) VALUES(?,?,?,?,?)
      ON CONFLICT(user_id,month) DO UPDATE SET
        luna_input_tokens=luna_input_tokens+excluded.luna_input_tokens,
        luna_cached_tokens=luna_cached_tokens+excluded.luna_cached_tokens,
        luna_output_tokens=luna_output_tokens+excluded.luna_output_tokens`).run(userId, month, input, cached, output);
  }

  usage(userId: string) {
    const month = new Date().toISOString().slice(0, 7);
    const row = this.db.prepare("SELECT * FROM usage WHERE user_id=? AND month=?").get(userId, month) as Record<string, number> | undefined;
    const audioSeconds = row?.audio_seconds ?? 0;
    const input = row?.luna_input_tokens ?? 0, cached = Math.min(input, row?.luna_cached_tokens ?? 0), output = row?.luna_output_tokens ?? 0;
    return { month, audioSeconds, lunaInputTokens: input, lunaCachedTokens: cached, lunaOutputTokens: output,
      audioCost: audioSeconds / 60 * 0.0045,
      lunaCost: (input - cached) * 0.2 / 1e6 + cached * 0.02 / 1e6 + output * 1.2 / 1e6 };
  }
}
