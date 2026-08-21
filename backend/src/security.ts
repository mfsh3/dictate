import { randomBytes } from "node:crypto";
import { constants as fsConstants, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

function permissions(mode: number) {
  return mode & 0o777;
}

function assertMode(filePath: string, expected: number, label: string) {
  const actual = permissions(statSync(filePath).mode);
  if (actual !== expected) {
    throw new Error(`${label} hat unsichere Rechte ${actual.toString(8)}; erwartet ${expected.toString(8)}`);
  }
}

export function prepareState(stateDir: string, dbPath: string, keyPath: string) {
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  assertMode(stateDir, 0o700, "State-Verzeichnis");

  if (existsSync(dbPath) && statSync(dbPath).size > 0 && !existsSync(keyPath)) {
    throw new Error("Datenbank ist vorhanden, aber der zugehörige Datenschlüssel fehlt");
  }
  if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: "wx" });
  assertMode(keyPath, 0o600, "Datenschlüssel");
  const key = readFileSync(keyPath);
  if (key.length !== 32) throw new Error("Datenschlüssel muss exakt 32 Bytes lang sein");

  if (!existsSync(dbPath)) closeSync(openSync(dbPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR, 0o600));
  assertMode(dbPath, 0o600, "Datenbank");
  return key;
}

export function assertPinnedCa(caPath: string) {
  if (!existsSync(caPath)) throw new Error(`RadsUp-Dev-CA fehlt: ${caPath}`);
  const mode = permissions(statSync(caPath).mode);
  if ((mode & 0o022) !== 0) throw new Error("RadsUp-Dev-CA darf nicht gruppen- oder weltbeschreibbar sein");
  return readFileSync(caPath);
}

export function safeStatePath(stateDir: string, name: string) {
  const resolved = path.resolve(stateDir, name);
  if (path.dirname(resolved) !== path.resolve(stateDir)) throw new Error("Ungültiger State-Pfad");
  return resolved;
}
