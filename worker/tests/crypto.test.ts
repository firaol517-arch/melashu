import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
beforeAll(() => { process.env.SESSION_ENC_KEY = randomBytes(32).toString("base64"); });
describe("session encryption (AES-256-GCM)", () => {
  it("round-trips and never stores plaintext", async () => {
    const { encrypt, decrypt } = await import("../src/crypto.js");
    const secret = "1BVtsOKwBu-session-string";
    const enc = encrypt(secret);
    expect(enc).not.toContain(secret); expect(enc.startsWith("v1.")).toBe(true);
    expect(decrypt(enc)).toBe(secret);
    expect(encrypt(secret)).not.toBe(enc);          // random IV
  });
  it("detects tampering", async () => {
    const { encrypt, decrypt } = await import("../src/crypto.js");
    const parts = encrypt("hello").split("."); parts[3] = Buffer.from("evil").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
});
