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

export type DashboardRange = 7 | 30 | 365;

export interface DashboardPoint {
  period: string;
  dictates: number;
  audioSeconds: number;
  audioCost: number;
  lunaCost: number;
  totalCost: number;
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
      CREATE TABLE IF NOT EXISTS usage_daily (
        user_id TEXT NOT NULL,
        day TEXT NOT NULL,
        audio_seconds REAL NOT NULL DEFAULT 0,
        luna_input_tokens INTEGER NOT NULL DEFAULT 0,
        luna_cached_tokens INTEGER NOT NULL DEFAULT 0,
        luna_output_tokens INTEGER NOT NULL DEFAULT 0,
        dictates_created INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(user_id, day)
      );
      CREATE TABLE IF NOT EXISTS dictate_counts (
        user_id TEXT NOT NULL,
        dictate_id TEXT NOT NULL,
        day TEXT NOT NULL,
        PRIMARY KEY(user_id, dictate_id)
      );
      CREATE INDEX IF NOT EXISTS dictate_counts_day ON dictate_counts(day);
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    const now = new Date().toISOString();
    this.db.prepare("INSERT OR IGNORE INTO app_meta(key,value) VALUES('daily_usage_started_at',?)").run(now);
    this.backfillDictateCounts();
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
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO dictates(id,user_id,title_enc,text_enc,created_at,updated_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET title_enc=excluded.title_enc,text_enc=excluded.text_enc,updated_at=excluded.updated_at
        WHERE user_id=excluded.user_id AND dictates.updated_at <= excluded.updated_at`).run(
          item.id, userId, this.vault.encrypt(item.title), this.vault.encrypt(item.text), item.createdAt, item.updatedAt
        );
      if (!item.text.trim()) return;
      const day = item.createdAt.slice(0, 10);
      const counted = this.db.prepare("INSERT OR IGNORE INTO dictate_counts(user_id,dictate_id,day) VALUES(?,?,?)").run(userId, item.id, day);
      if (counted.changes) this.addDailyUsage(userId, day, { dictates: 1 });
    })();
  }

  deleteDictate(userId: string, id: string) {
    return this.db.prepare("DELETE FROM dictates WHERE user_id=? AND id=?").run(userId, id).changes > 0;
  }

  cleanup() {
    const dictatesCutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
    const metricsCutoff = new Date(Date.now() - 400 * 86400_000).toISOString().slice(0, 10);
    const idemCutoff = new Date().toISOString();
    this.db.prepare("DELETE FROM dictates WHERE updated_at < ?").run(dictatesCutoff);
    this.db.prepare("DELETE FROM idempotency WHERE expires_at < ?").run(idemCutoff);
    this.db.prepare("DELETE FROM usage_daily WHERE day < ?").run(metricsCutoff);
    this.db.prepare("DELETE FROM dictate_counts WHERE day < ?").run(metricsCutoff);
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
    const day = new Date().toISOString().slice(0, 10);
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO usage(user_id,month,audio_seconds) VALUES(?,?,?)
        ON CONFLICT(user_id,month) DO UPDATE SET audio_seconds=audio_seconds+excluded.audio_seconds`).run(userId, month, seconds);
      this.addDailyUsage(userId, day, { audioSeconds: seconds });
    })();
  }

  addLunaUsage(userId: string, input: number, cached: number, output: number) {
    const month = new Date().toISOString().slice(0, 7);
    const day = new Date().toISOString().slice(0, 10);
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO usage(user_id,month,luna_input_tokens,luna_cached_tokens,luna_output_tokens) VALUES(?,?,?,?,?)
        ON CONFLICT(user_id,month) DO UPDATE SET
          luna_input_tokens=luna_input_tokens+excluded.luna_input_tokens,
          luna_cached_tokens=luna_cached_tokens+excluded.luna_cached_tokens,
          luna_output_tokens=luna_output_tokens+excluded.luna_output_tokens`).run(userId, month, input, cached, output);
      this.addDailyUsage(userId, day, { input, cached, output });
    })();
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

  dashboard(userId: string, days: DashboardRange) {
    const today = new Date();
    const end = today.toISOString().slice(0, 10);
    const startDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - days + 1));
    const start = startDate.toISOString().slice(0, 10);
    const rows = this.db.prepare(`SELECT day,audio_seconds,luna_input_tokens,luna_cached_tokens,luna_output_tokens,dictates_created
      FROM usage_daily WHERE user_id=? AND day BETWEEN ? AND ? ORDER BY day`).all(userId, start, end) as Array<Record<string, number | string>>;
    const byDay = new Map(rows.map((row) => [String(row.day), row]));
    const daily: DashboardPoint[] = [];
    for (let offset = 0; offset < days; offset++) {
      const date = new Date(startDate); date.setUTCDate(date.getUTCDate() + offset);
      const day = date.toISOString().slice(0, 10), row = byDay.get(day);
      daily.push(this.dashboardPoint(day, row));
    }
    const points = days === 365 ? this.groupDashboardMonths(daily) : daily;
    const summary = daily.reduce((total, point) => ({
      dictates: total.dictates + point.dictates,
      audioSeconds: total.audioSeconds + point.audioSeconds,
      audioCost: total.audioCost + point.audioCost,
      lunaCost: total.lunaCost + point.lunaCost,
      totalCost: total.totalCost + point.totalCost
    }), { dictates: 0, audioSeconds: 0, audioCost: 0, lunaCost: 0, totalCost: 0 });
    const meta = this.db.prepare("SELECT value FROM app_meta WHERE key='daily_usage_started_at'").get() as { value: string };
    return { days, bucket: days === 365 ? "month" as const : "day" as const, costTrackingSince: meta.value, summary, points };
  }

  private addDailyUsage(userId: string, day: string, values: { audioSeconds?: number; input?: number; cached?: number; output?: number; dictates?: number }) {
    this.db.prepare(`INSERT INTO usage_daily(user_id,day,audio_seconds,luna_input_tokens,luna_cached_tokens,luna_output_tokens,dictates_created)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,day) DO UPDATE SET
        audio_seconds=audio_seconds+excluded.audio_seconds,
        luna_input_tokens=luna_input_tokens+excluded.luna_input_tokens,
        luna_cached_tokens=luna_cached_tokens+excluded.luna_cached_tokens,
        luna_output_tokens=luna_output_tokens+excluded.luna_output_tokens,
        dictates_created=dictates_created+excluded.dictates_created`).run(
          userId, day, values.audioSeconds ?? 0, values.input ?? 0, values.cached ?? 0, values.output ?? 0, values.dictates ?? 0
        );
  }

  private dashboardPoint(period: string, row?: Record<string, number | string>): DashboardPoint {
    const audioSeconds = Number(row?.audio_seconds ?? 0);
    const input = Number(row?.luna_input_tokens ?? 0), cached = Math.min(input, Number(row?.luna_cached_tokens ?? 0)), output = Number(row?.luna_output_tokens ?? 0);
    const audioCost = audioSeconds / 60 * 0.0045;
    const lunaCost = (input - cached) * 0.2 / 1e6 + cached * 0.02 / 1e6 + output * 1.2 / 1e6;
    return { period, dictates: Number(row?.dictates_created ?? 0), audioSeconds, audioCost, lunaCost, totalCost: audioCost + lunaCost };
  }

  private groupDashboardMonths(daily: DashboardPoint[]) {
    const grouped = new Map<string, DashboardPoint>();
    for (const point of daily) {
      const period = point.period.slice(0, 7), found = grouped.get(period) ?? { period, dictates: 0, audioSeconds: 0, audioCost: 0, lunaCost: 0, totalCost: 0 };
      found.dictates += point.dictates; found.audioSeconds += point.audioSeconds; found.audioCost += point.audioCost;
      found.lunaCost += point.lunaCost; found.totalCost += point.totalCost; grouped.set(period, found);
    }
    return [...grouped.values()];
  }

  private backfillDictateCounts() {
    if (this.db.prepare("SELECT 1 FROM app_meta WHERE key='dictate_counts_backfill_v1'").get()) return;
    this.db.transaction(() => {
      this.db.prepare(`INSERT OR IGNORE INTO dictate_counts(user_id,dictate_id,day)
        SELECT user_id,id,substr(created_at,1,10) FROM dictates`).run();
      this.db.prepare(`INSERT INTO usage_daily(user_id,day,dictates_created)
        SELECT user_id,day,count(*) FROM dictate_counts GROUP BY user_id,day
        ON CONFLICT(user_id,day) DO UPDATE SET dictates_created=excluded.dictates_created`).run();
      this.db.prepare("INSERT INTO app_meta(key,value) VALUES('dictate_counts_backfill_v1',?)").run(new Date().toISOString());
    })();
  }
}
