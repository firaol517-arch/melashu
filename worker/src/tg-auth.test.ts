import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyInitData, signSession, verifySession } from "./tg-auth.js";

const TOKEN = "123456:TEST_TOKEN_not_real_aaaaaaaaaaaaaaaaa";
function makeInit(user: object, authDate: number, token = TOKEN) {
  const p = new URLSearchParams({ auth_date: String(authDate), query_id: "AAH", user: JSON.stringify(user) });
  const check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  p.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return p.toString();
}
const now = Date.now(), sec = Math.floor(now / 1000);

describe("Telegram initData verification", () => {
  it("accepts valid data", () => expect(verifyInitData(makeInit({ id: 42, first_name: "Abebe" }, sec), TOKEN, 3600, now)?.id).toBe(42));
  it("rejects wrong bot token", () => expect(verifyInitData(makeInit({ id: 42 }, sec, "999:OTHER"), TOKEN, 3600, now)).toBeNull());
  it("rejects tampered user", () => {
    const s = makeInit({ id: 42 }, sec).replace("%22id%22%3A42", "%22id%22%3A43");
    expect(verifyInitData(s, TOKEN, 3600, now)).toBeNull();
  });
  it("rejects stale auth_date", () => expect(verifyInitData(makeInit({ id: 42 }, sec - 90_000), TOKEN, 3600, now)).toBeNull());
  it("rejects missing hash / empty", () => { expect(verifyInitData("auth_date=1", TOKEN)).toBeNull(); expect(verifyInitData("", TOKEN)).toBeNull(); });
});
describe("session token", () => {
  const key = "k".repeat(32);
  it("round-trips", () => expect(verifySession(signSession({ tg: 7, biz: "b1" }, key, 60, now), key, now)).toEqual({ tg: 7, biz: "b1" }));
  it("expires", () => expect(verifySession(signSession({ tg: 7, biz: "b1" }, key, 60, now), key, now + 61_000)).toBeNull());
  it("rejects tampering and wrong key", () => {
    const t = signSession({ tg: 7, biz: "b1" }, key, 60, now);
    expect(verifySession(t.replace(/^./, "x"), key, now)).toBeNull();
    expect(verifySession(t, "z".repeat(32), now)).toBeNull();
  });
});
