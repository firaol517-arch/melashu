// Telegram Mini App authentication (server-side only).
// 1) verifyInitData: validates Telegram WebApp initData per https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
// 2) signSession / verifySession: short app session token (HMAC-SHA256) so the browser never holds the bot token.
import { createHmac, timingSafeEqual } from "node:crypto";

export type TgUser = { id: number; first_name?: string; last_name?: string; username?: string; language_code?: string };

const eq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export function verifyInitData(initData: string, botToken: string, maxAgeSec = 24 * 3600, now = Date.now()): TgUser | null {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash"); if (!hash) return null;
  params.delete("hash");
  const dataCheck = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = createHmac("sha256", secret).update(dataCheck).digest("hex");
  if (!eq(calc, hash)) return null;
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || now / 1000 - authDate > maxAgeSec || authDate - now / 1000 > 300) return null;
  try { const u = JSON.parse(params.get("user") ?? "null"); return u && Number.isFinite(u.id) ? (u as TgUser) : null; } catch { return null; }
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
export function signSession(payload: { tg: number; biz: string }, key: string, ttlSec = 12 * 3600, now = Date.now()) {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(now / 1000) + ttlSec }));
  return `${body}.${createHmac("sha256", key).update("tgs1." + body).digest("base64url")}`;
}
export function verifySession(token: string | null | undefined, key: string, now = Date.now()): { tg: number; biz: string } | null {
  if (!token) return null;
  const [body, sig] = token.split("."); if (!body || !sig) return null;
  if (!eq(createHmac("sha256", key).update("tgs1." + body).digest("base64url"), sig)) return null;
  try { const p = JSON.parse(Buffer.from(body, "base64url").toString()); return p.exp > now / 1000 && p.tg && p.biz ? { tg: p.tg, biz: p.biz } : null; } catch { return null; }
}
