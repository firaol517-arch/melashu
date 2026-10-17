import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage, type NewMessageEvent } from "telegram/events/index.js";
import { db, audit } from "./db.js";
import { decrypt, encrypt } from "./crypto.js";
import { log } from "./log.js";
import { handleIncoming, type Sender, type Typing } from "./pipeline.js";
import { connectBot, disconnectBot, hasBot, botSend, botTyping, botCount, resumeBots } from "./botapi.js";

type Live = { client: TelegramClient; businessId: string; failures: number };
const live = new Map<string, Live>();                                  // authorized, running clients
const pending = new Map<string, { client: TelegramClient; apiId: number; apiHash: string; phone: string; hash: string }>(); // mid-login

export const liveCount = () => live.size + botCount();
const setConn = (businessId: string, patch: Record<string, unknown>) =>
  db.from("sec_telegram_connections").update(patch).eq("business_id", businessId);

async function creds(businessId: string) {
  const { data } = await db.from("sec_telegram_secrets").select("*").eq("business_id", businessId).single();
  if (!data?.api_id_enc || !data.api_hash_enc) throw new Error("api_credentials_missing");
  return { apiId: Number(decrypt(data.api_id_enc)), apiHash: decrypt(data.api_hash_enc), session: data.session_enc ? decrypt(data.session_enc) : "" };
}
const newClient = (apiId: number, apiHash: string, session = "") =>
  new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 8, autoReconnect: true, retryDelay: 2000, useWSS: false });

const peerOf = async (l: Live, tgChatId: number, accessHash?: string, kind = "private") =>
  kind === "private" && accessHash ? new Api.InputPeerUser({ userId: BigInt(tgChatId) as any, accessHash: BigInt(accessHash) as any }) : l.client.getInputEntity(tgChatId);

export const send: Sender = async ({ businessId, tgChatId, accessHash, chatKind, text }) => {
  if (hasBot(businessId)) return botSend({ businessId, tgChatId, accessHash, chatKind, text });
  const l = live.get(businessId); if (!l) throw new Error("telegram_not_connected");
  const r = await l.client.sendMessage(await peerOf(l, tgChatId, accessHash, chatKind), { message: text });
  if (!r?.id) throw new Error("no_confirmation_from_telegram");           // no id → not confirmed → caller marks failed
  return { tgMessageId: r.id };
};
export const typing: Typing = async ({ businessId, tgChatId, accessHash }) => {
  if (hasBot(businessId)) return botTyping({ businessId, tgChatId, accessHash });
  const l = live.get(businessId); if (!l) return;
  await l.client.invoke(new Api.messages.SetTyping({ peer: await peerOf(l, tgChatId, accessHash), action: new Api.SendMessageTypingAction() }));
};

// ───────── running client ─────────
async function attach(businessId: string, client: TelegramClient) {
  live.get(businessId)?.client.disconnect().catch(() => {});
  live.set(businessId, { client, businessId, failures: 0 });
  client.addEventHandler(async (ev: NewMessageEvent) => {
    try {
      const msg = ev.message; if (msg.out) return;
      const sender: any = await msg.getSender().catch(() => null);
      const peer: any = msg.peerId;
      const chatKind = ev.isPrivate ? "private" : ev.isGroup ? "group" : "channel";
      const tgUserId = Number(String(sender?.id ?? msg.senderId ?? 0));
      await handleIncoming({
        businessId, tgChatId: Number(String(ev.chatId)), tgAccessHash: sender?.accessHash ? String(sender.accessHash) : undefined,
        tgUserId, tgMessageId: msg.id, chatKind, text: msg.message ?? "", fromSelf: !!msg.out, isBot: !!sender?.bot,
        name: [sender?.firstName, sender?.lastName].filter(Boolean).join(" ") || sender?.title || "Unknown", username: sender?.username,
        isContact: !!sender?.contact || !!sender?.mutualContact,
      }, send, typing);
      void peer;
    } catch (e: any) { log.error({ err: e?.message, businessId }, "incoming handler failed"); }
  }, new NewMessage({ incoming: true }));
}

export async function resumeAll() {
  await resumeBots();
  const { data } = await db.from("sec_telegram_connections").select("business_id,status").eq("mode", "account").in("status", ["connected", "connecting", "error"]);
  for (const row of data ?? []) await resume(row.business_id).catch((e) => log.warn({ err: e.message }, "resume failed"));
}
async function resume(businessId: string) {
  const c = await creds(businessId); if (!c.session) return;
  const client = newClient(c.apiId, c.apiHash, c.session);
  await client.connect();
  if (!(await client.isUserAuthorized())) { await setConn(businessId, { status: "error", last_error: "session_revoked_or_expired" }); await audit(businessId, "telegram.session_invalid"); return; }
  await attach(businessId, client);
  await setConn(businessId, { status: "connected", last_error: null, last_heartbeat_at: new Date().toISOString() });
}

// ───────── login handshake ─────────
async function finishLogin(businessId: string, client: TelegramClient) {
  const me: any = await client.getMe();
  const session = (client.session as StringSession).save();
  await db.from("sec_telegram_secrets").update({ session_enc: encrypt(session), updated_at: new Date().toISOString() }).eq("business_id", businessId);
  await attach(businessId, client); pending.delete(businessId);
  await setConn(businessId, { status: "connected", tg_user_id: Number(String(me.id)), tg_username: me.username ?? null, connected_at: new Date().toISOString(), last_error: null, last_heartbeat_at: new Date().toISOString() });
  await audit(businessId, "telegram.connected");
}

export async function handleAuthRequest(req: { id: string; business_id: string; action: string; payload_enc: string | null }) {
  const b = req.business_id; const payload = req.payload_enc ? JSON.parse(decrypt(req.payload_enc)) : {};
  try {
    if (req.action === "send_code") {
      const c = await creds(b); pending.get(b)?.client.disconnect().catch(() => {});
      const client = newClient(c.apiId, c.apiHash); await client.connect();
      const r: any = await client.sendCode({ apiId: c.apiId, apiHash: c.apiHash }, payload.phone);
      pending.set(b, { client, apiId: c.apiId, apiHash: c.apiHash, phone: payload.phone, hash: r.phoneCodeHash });
      await setConn(b, { status: "awaiting_code", last_error: null });
    } else if (req.action === "verify_code") {
      const p = pending.get(b); if (!p) throw new Error("no_login_in_progress");
      try {
        await p.client.invoke(new Api.auth.SignIn({ phoneNumber: p.phone, phoneCodeHash: p.hash, phoneCode: payload.code }));
        await finishLogin(b, p.client);
      } catch (e: any) {
        if (e?.errorMessage === "SESSION_PASSWORD_NEEDED") await setConn(b, { status: "awaiting_password" });
        else throw e;
      }
    } else if (req.action === "verify_password") {
      const p = pending.get(b); if (!p) throw new Error("no_login_in_progress");
      await p.client.signInWithPassword({ apiId: p.apiId, apiHash: p.apiHash }, { password: async () => payload.password, onError: async (e) => { throw e; } });
      await finishLogin(b, p.client);
    } else if (req.action === "connect_bot") {
      await connectBot(b, String(payload.token));
    } else if (req.action === "disconnect") {
      await disconnectBot(b);
      const c = live.get(b)?.client ?? pending.get(b)?.client;
      if (c) { await c.invoke(new Api.auth.LogOut()).catch(() => {}); await c.disconnect().catch(() => {}); }
      live.delete(b); pending.delete(b);
      await audit(b, "telegram.session_revoked");
    }
    await db.from("sec_telegram_auth_requests").update({ status: "done", payload_enc: null, processed_at: new Date().toISOString() }).eq("id", req.id);
  } catch (e: any) {
    const msg = String(e?.errorMessage ?? e?.message ?? "failed").slice(0, 160);
    await db.from("sec_telegram_auth_requests").update({ status: "failed", error: msg, payload_enc: null, processed_at: new Date().toISOString() }).eq("id", req.id);
    if (req.action !== "disconnect") await setConn(b, { status: pending.has(b) ? (req.action === "verify_password" ? "awaiting_password" : "awaiting_code") : "error", last_error: msg });
    log.warn({ action: req.action, err: msg }, "auth request failed");
  }
}

export async function pollAuthRequests() {
  const { data } = await db.from("sec_telegram_auth_requests").select("id,business_id,action,payload_enc").eq("status", "pending").order("created_at").limit(10);
  for (const r of data ?? []) {
    // atomic claim → safe even if two workers ever run
    const { data: claimed } = await db.from("sec_telegram_auth_requests").update({ status: "processing" }).eq("id", r.id).eq("status", "pending").select("id");
    if (claimed?.length) await handleAuthRequest(r);
  }
}

// ───────── manual replies (outbox) ─────────
export async function pollOutbox() {
  const { data } = await db.from("sec_messages").select("id,business_id,conversation_id,body").eq("sender", "owner").eq("direction", "out").eq("status", "queued").order("created_at").limit(10);
  for (const m of data ?? []) {
    const { data: claimed } = await db.from("sec_messages").update({ status: "sending" }).eq("id", m.id).eq("status", "queued").select("id");
    if (!claimed?.length) continue;
    try {
      const { data: c } = await db.from("sec_conversations").select("tg_chat_id,tg_access_hash,chat_kind").eq("id", m.conversation_id).single();
      const r = await send({ businessId: m.business_id, tgChatId: Number(c!.tg_chat_id), accessHash: c!.tg_access_hash ?? undefined, chatKind: c!.chat_kind, text: m.body });
      await db.from("sec_messages").update({ status: "sent", tg_message_id: r.tgMessageId, sent_at: new Date().toISOString() }).eq("id", m.id);
      await db.from("sec_conversations").update({ unread_count: 0, last_message_at: new Date().toISOString(), last_message_preview: m.body.slice(0, 80) }).eq("id", m.conversation_id);
    } catch (e: any) {
      await db.from("sec_messages").update({ status: "failed", error: String(e?.errorMessage ?? e?.message ?? "send_failed").slice(0, 200) }).eq("id", m.id);
    }
  }
}

// ───────── heartbeat / reconnection ─────────
export async function heartbeat() {
  for (const [businessId, l] of live) {
    try {
      if (!l.client.connected) { await l.client.connect(); }
      await l.client.invoke(new Api.updates.GetState());                // cheap liveness probe that also keeps updates flowing
      l.failures = 0;
      await setConn(businessId, { last_heartbeat_at: new Date().toISOString(), status: "connected", last_error: null });
    } catch (e: any) {
      l.failures++;
      const fatal = ["AUTH_KEY_UNREGISTERED", "SESSION_REVOKED", "USER_DEACTIVATED"].includes(e?.errorMessage);
      if (fatal) { live.delete(businessId); await setConn(businessId, { status: "error", last_error: e.errorMessage });
        await db.from("sec_settings").update({ automation_enabled: false }).eq("business_id", businessId); await audit(businessId, "telegram.session_invalid"); continue; }
      await setConn(businessId, { last_error: `heartbeat_failed_${l.failures}` });
      const backoff = Math.min(60_000, 1000 * 2 ** l.failures);          // exponential backoff, capped at 60 s
      log.warn({ businessId, failures: l.failures, backoff }, "heartbeat failed");
      setTimeout(() => l.client.connect().catch(() => {}), backoff);
    }
  }
}
