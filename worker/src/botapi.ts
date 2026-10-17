// Telegram Bot API runner (BotFather tokens). Long-polls getUpdates; no api_id/api_hash needed.
// Customers must message the bot first (Telegram rule). Token is stored AES-GCM encrypted.
import { db, audit } from "./db.js";
import { decrypt, encrypt } from "./crypto.js";
import { log } from "./log.js";
import { handleIncoming, type Sender, type Typing } from "./pipeline.js";

type Runner = { token: string; offset: number; stop: boolean; username: string };
const runners = new Map<string, Runner>();
export const botCount = () => runners.size;
export const hasBot = (businessId: string) => runners.has(businessId);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T = any>(token: string, method: string, body: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<T> {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j.ok) { const e: any = new Error(j.description ?? `telegram_http_${r.status}`); e.code = j.error_code; throw e; }
  return j.result as T;
}
const setConn = (businessId: string, patch: Record<string, unknown>) =>
  db.from("sec_telegram_connections").update(patch).eq("business_id", businessId);

export const botSend: Sender = async ({ businessId, tgChatId, text }) => {
  const r = runners.get(businessId); if (!r) throw new Error("bot_not_connected");
  const m = await api<{ message_id: number }>(r.token, "sendMessage", { chat_id: tgChatId, text });
  if (!m?.message_id) throw new Error("no_confirmation_from_telegram");
  return { tgMessageId: m.message_id };
};
export const botTyping: Typing = async ({ businessId, tgChatId }) => {
  const r = runners.get(businessId); if (!r) return;
  await api(r.token, "sendChatAction", { chat_id: tgChatId, action: "typing" }).catch(() => {});
};

async function loop(businessId: string, r: Runner) {
  let failures = 0;
  while (!r.stop) {
    try {
      const updates = await api<any[]>(r.token, "getUpdates", { offset: r.offset, timeout: 25, allowed_updates: ["message"] }, 40_000);
      failures = 0;
      for (const u of updates) {
        r.offset = u.update_id + 1;
        const m = u.message; if (!m || m.chat?.type !== "private" || !m.from || m.from.is_bot) continue;
        try {
          await handleIncoming({
            businessId, tgChatId: m.chat.id, tgUserId: m.from.id, tgMessageId: m.message_id, chatKind: "private",
            text: m.text ?? m.caption ?? "", fromSelf: false, isBot: false, isContact: false,
            name: [m.from.first_name, m.from.last_name].filter(Boolean).join(" ") || m.from.username || "Unknown", username: m.from.username,
          }, botSend, botTyping);
        } catch (e: any) { log.error({ err: e?.message, businessId }, "bot incoming handler failed"); }
      }
      await setConn(businessId, { last_heartbeat_at: new Date().toISOString(), status: "connected", last_error: null });
    } catch (e: any) {
      if (r.stop) break;
      failures++;
      if (e?.code === 401) {                                   // token revoked in BotFather
        runners.delete(businessId); r.stop = true;
        await setConn(businessId, { status: "error", last_error: "bot_token_revoked" });
        await db.from("sec_settings").update({ automation_enabled: false }).eq("business_id", businessId);
        await audit(businessId, "telegram.session_invalid"); break;
      }
      await setConn(businessId, { last_error: `bot_poll_${e?.code ?? "error"}_${failures}` });
      await sleep(Math.min(60_000, 1000 * 2 ** Math.min(failures, 6)));
    }
  }
}

async function start(businessId: string, token: string) {
  runners.get(businessId) && (runners.get(businessId)!.stop = true);
  const me = await api<{ username: string; id: number }>(token, "getMe");
  await api(token, "deleteWebhook", { drop_pending_updates: false }).catch(() => {});   // getUpdates requires no webhook
  const r: Runner = { token, offset: 0, stop: false, username: me.username };
  runners.set(businessId, r);
  void loop(businessId, r);
  return me;
}

export async function connectBot(businessId: string, token: string) {
  const me = await start(businessId, token);
  await db.from("sec_telegram_secrets").upsert({ business_id: businessId, bot_token_enc: encrypt(token), session_enc: null, updated_at: new Date().toISOString() });
  await setConn(businessId, { mode: "bot", status: "connected", tg_user_id: me.id, tg_username: me.username, connected_at: new Date().toISOString(), last_error: null, last_heartbeat_at: new Date().toISOString() });
  await audit(businessId, "telegram.bot_connected");
}
export async function disconnectBot(businessId: string) {
  const r = runners.get(businessId); if (r) r.stop = true; runners.delete(businessId);
  await db.from("sec_telegram_secrets").update({ bot_token_enc: null }).eq("business_id", businessId);
  await audit(businessId, "telegram.session_revoked");
}
export async function resumeBots() {
  const { data } = await db.from("sec_telegram_connections").select("business_id").eq("mode", "bot").in("status", ["connected", "error"]);
  for (const row of data ?? []) {
    try {
      const { data: s } = await db.from("sec_telegram_secrets").select("bot_token_enc").eq("business_id", row.business_id).single();
      if (s?.bot_token_enc) await start(row.business_id, decrypt(s.bot_token_enc));
    } catch (e: any) { log.warn({ err: e?.message }, "bot resume failed"); }
  }
}
