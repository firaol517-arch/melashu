import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM. Format: v1.<iv>.<tag>.<ciphertext> (base64url). Server-side only.
function key(): Buffer {
  const raw = process.env.SESSION_ENC_KEY;
  if (!raw) throw new Error("SESSION_ENC_KEY is not configured");
  const k = Buffer.from(raw.replace(/\s+/g, "").replace(/^['"`]+|['"`]+$/g, ""), "base64");   // tolerate pasted quotes/whitespace
  if (k.length !== 32) throw new Error("SESSION_ENC_KEY must be 32 bytes (base64)");
  return k;
}
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}
export function decrypt(token: string): string {
  const [v, iv, tag, ct] = token.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Invalid ciphertext");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

/** Normalised SESSION_ENC_KEY string, used as an HMAC key for Mini App session tokens (never sent to the browser). */
export function hmacKey(): string {
  const raw = process.env.SESSION_ENC_KEY; if (!raw) throw new Error("SESSION_ENC_KEY is not configured");
  return raw.replace(/\s+/g, "").replace(/^['"`]+|['"`]+$/g, "");
}
