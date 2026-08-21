import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class Vault {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("AES-256-GCM benötigt einen 32-Byte-Schlüssel");
  }

  encrypt(plain: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  decrypt(payload: Buffer) {
    if (payload.length < 28) throw new Error("Ungültiger verschlüsselter Wert");
    const decipher = createDecipheriv("aes-256-gcm", this.key, payload.subarray(0, 12));
    decipher.setAuthTag(payload.subarray(12, 28));
    return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8");
  }
}
