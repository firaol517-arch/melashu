// Platform bot: ONE shared bot (PLATFORM_BOT_TOKEN) serving many businesses.
//  • Owners open the Mini App from the bot, teach the AI, agree, then connect via Telegram Business → Chatbots.
//  • Customer messages arrive as `business_message` updates; replies go out "as the owner" via business_connection_id.
import { db, audit } from "./db.js";
import { config } from "./config.js";
import { log } from "./log.js";
import { api } from "./botapi.js";
import { handleIncoming, hooks, type Sender, type Typing } from "./pipeline.js";

type Conn = { bcId: string; businessId: string; userId: number; canReply: boolean; enabled: boolean };
const byBc = new Map<string, Conn>();
const bcOfBiz = new Map<string, string>();
let stop = false, running = false, offset = 0, username = "";
const st = { bot: "", lastPollAt: 0, lastUpdateAt: 0, lastError: "" };
export const platformStatus = () => ({ running, bot: st.bot || username, pollAgoSec: st.lastPollAt ? Math.round((Date.now() - st.lastPollAt) / 1000) : null, updateAgoSec: st.lastUpdateAt ? Math.round((Date.now() - st.lastUpdateAt) / 1000) : null, lastError: st.lastError || null });
export const platformCount = () => (running ? bcOfBiz.size : 0);
export const hasPlatform = (businessId: string) => running && bcOfBiz.has(businessId);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const T = () => config.platformBotToken;
const keyboard = () => ({ inline_keyboard: [[{ text: "📱 አፑን ክፈት", web_app: { url: config.webAppUrl } }]] });
const say = (chatId: number, text: string, markup = false) =>
  api(T(), "sendMessage", { chat_id: chatId, text, ...(markup ? { reply_markup: keyboard() } : {}) }).catch((e) => log.warn({ err: e?.message }, "say failed"));

export const platformSend: Sender = async ({ businessId, tgChatId, text }) => {
  const bc = bcOfBiz.get(businessId); if (!bc) throw new Error("business_not_connected");
  if (!byBc.get(bc)?.canReply) throw new Error("bot_cannot_reply_check_business_settings");
  const m = await api<{ message_id: number }>(T(), "sendMessage", { business_connection_id: bc, chat_id: tgChatId, text });
  if (!m?.message_id) throw new Error("no_confirmation_from_telegram");
  return { tgMessageId: m.message_id };
};
export const platformTyping: Typing = async ({ businessId, tgChatId }) => {
  const bc = bcOfBiz.get(businessId); if (!bc) return;
  await api(T(), "sendChatAction", { business_connection_id: bc, chat_id: tgChatId, action: "typing" }).catch(() => {});
};

const remember = (c: Conn) => { byBc.set(c.bcId, c); if (c.enabled) bcOfBiz.set(c.businessId, c.bcId); else if (bcOfBiz.get(c.businessId) === c.bcId) bcOfBiz.delete(c.businessId); };
async function loadConnections() {
  const { data } = await db.from("sec_business_connections").select("*");
  for (const r of data ?? []) remember({ bcId: r.bc_id, businessId: r.business_id, userId: Number(r.tg_user_id), canReply: r.can_reply, enabled: r.is_enabled });
}
async function ownerOf(tgUserId: number) {
  const { data } = await db.from("sec_owners").select("tg_user_id,business_id,bot_chat_id").eq("tg_user_id", tgUserId).maybeSingle();
  return data;
}
async function registerConnection(bc: any): Promise<Conn | null> {
  const userId = Number(bc.user?.id); const owner = await ownerOf(userId);
  const canReply = !!(bc.can_reply ?? bc.rights?.can_reply); const enabled = bc.is_enabled !== false;
  if (!owner?.business_id) { if (owner?.bot_chat_id) await say(owner.bot_chat_id, "ተገናኝተሃል! 👋 መጀመሪያ አፑን ከፍተህ ንግድህን አዘጋጅ፣ ከዚያ እንደገና አገናኝ።", true); return null; }
  const c: Conn = { bcId: bc.id, businessId: owner.business_id, userId, canReply, enabled };
  await db.from("sec_business_connections").upsert({ bc_id: c.bcId, business_id: c.businessId, tg_user_id: userId, can_reply: canReply, is_enabled: enabled, updated_at: new Date().toISOString() });
  remember(c);
  await db.from("sec_telegram_connections").upsert({ business_id: c.businessId, mode: "business", status: enabled ? "connected" : "disconnected", tg_user_id: userId, last_error: null,
    last_heartbeat_at: new Date().toISOString(), connected_at: enabled ? new Date().toISOString() : null });
  await audit(c.businessId, enabled ? "telegram.business_connected" : "telegram.business_disconnected");
  if (owner.bot_chat_id) await say(owner.bot_chat_id, !enabled ? "⚠️ ረዳቱ ከአካውንትህ ተቋርጧል። በ Telegram → Settings → Business → Chatbots እንደገና አገናኝ።"
    : canReply ? "✅ ተገናኝቷል! አሁን ደንበኞች ሲጽፉልህ ረዳቱ በስምህ ይመልሳል። ማቆም ከፈለግህ /pause ጻፍ።"
    : "⚠️ ተገናኝቷል ግን 'መልስ መስጠት' ፈቃድ አልተሰጠውም። በ Chatbots ቅንብር ውስጥ 'Reply to messages' ን አብራ።");
  return c;
}
async function resolve(bcId: string): Promise<Conn | null> {
  const known = byBc.get(bcId); if (known) return known;
  const bc = await api(T(), "getBusinessConnection", { business_connection_id: bcId }).catch(() => null);
  return bc ? registerConnection(bc) : null;
}

async function onDirectMessage(m: any) {
  if (m.chat?.type !== "private" || !m.from || m.from.is_bot) return;
  const u = m.from; const text: string = (m.text ?? "").trim();
  await db.from("sec_owners").upsert({ tg_user_id: u.id, bot_chat_id: m.chat.id, first_name: u.first_name ?? null, username: u.username ?? null, language_code: u.language_code ?? null }, { onConflict: "tg_user_id" });
  const owner = await ownerOf(u.id); const biz = owner?.business_id as string | undefined;
  const cmd = text.split(/[\s@]/)[0].toLowerCase();
  if (cmd === "/pause" || cmd === "/resume") {
    if (!biz) return void say(m.chat.id, "መጀመሪያ አፑን ክፈት።", true);
    const on = cmd === "/resume";
    await db.from("sec_settings").update({ automation_enabled: on }).eq("business_id", biz); await audit(biz, on ? "settings.resumed" : "settings.paused");
    return void say(m.chat.id, on ? "▶️ ረዳቱ እንደገና ይመልሳል።" : "⏸️ ረዳቱ ቆሟል። ደንበኞችን አይመልስም። ለመቀጠል /resume");
  }
  if (cmd === "/status") {
    if (!biz) return void say(m.chat.id, "ገና ንግድ አላዘጋጀህም።", true);
    const [{ data: s }, { data: c }] = await Promise.all([db.from("sec_settings").select("automation_enabled,dry_run").eq("business_id", biz).single(), db.from("sec_telegram_connections").select("status").eq("business_id", biz).maybeSingle()]);
    return void say(m.chat.id, `ግንኙነት: ${c?.status ?? "—"}\nረዳት: ${s?.automation_enabled ? (s.dry_run ? "ሙከራ (አይልክም)" : "በርቷል ✅") : "ቆሟል"}`);
  }
  if (cmd === "/start" || cmd === "/help" || !biz)
    return void say(m.chat.id, `ሰላም ${u.first_name ?? ""}! 👋\nእኔ ደንበኞችህን በራስህ ስም በአማርኛና በእንግሊዝኛ የምመልስ AI ጸሐፊ ነኝ።\n\n1️⃣ አፑን ክፈት\n2️⃣ ስለ ንግድህ ጥቂት ጥያቄዎችን መልስ\n3️⃣ ስትስማማ ከ Telegram አካውንትህ አገናኝ\n\nትዕዛዞች: /status · /pause · /resume`, true);
  return void say(m.chat.id, "ለማስተካከል አፑን ክፈት 👇\n/pause ለማቆም · /resume ለመቀጠል", true);
}

async function onBusinessMessage(m: any) {
  if (m.chat?.type !== "private" || !m.from) return;
  const c = await resolve(m.business_connection_id); if (!c || !c.enabled) return;
  const text = m.text ?? m.caption ?? "";
  if (m.sender_business_bot) return;                                       // sent by a bot on the owner's behalf (our own replies) — ignore
  if (m.from.id === c.userId) {                                            // the owner wrote by hand → note it so the AI stays quiet
    await sleep(3000);
    const { data: conv } = await db.from("sec_conversations").select("id").eq("business_id", c.businessId).eq("tg_chat_id", m.chat.id).maybeSingle();
    if (conv) await db.from("sec_messages").insert({ business_id: c.businessId, conversation_id: conv.id, tg_message_id: m.message_id, direction: "out", sender: "owner", body: text || "[non-text]", status: "sent", sent_at: new Date().toISOString() });
    return;                                                                // unique(conversation_id, tg_message_id) silently drops echoes of rows we already stored
  }
  if (m.from.is_bot) return;
  await handleIncoming({
    businessId: c.businessId, tgChatId: m.chat.id, tgUserId: m.from.id, tgMessageId: m.message_id, chatKind: "private", text, fromSelf: false, isBot: false, isContact: false,
    name: [m.from.first_name, m.from.last_name].filter(Boolean).join(" ") || m.from.username || "Unknown", username: m.from.username,
  }, platformSend, platformTyping);
}


// ── "Who is this?" — the owner classifies each new chat; only customers get AI replies ──
const KINDS: Record<string, { kind: "customer" | "friend" | "family" | "ignore"; label: string }> = {
  c: { kind: "customer", label: "💼 ደንበኛ / ሥራ" }, f: { kind: "friend", label: "🤝 ጓደኛ" }, r: { kind: "family", label: "👨‍👩‍👧 ቤተሰብ" }, x: { kind: "ignore", label: "🚫 ችላ በል" },
};
const askKeyboard = (convId: string) => ({ inline_keyboard: [
  [{ text: KINDS.c.label, callback_data: `k:${convId}:c` }, { text: KINDS.f.label, callback_data: `k:${convId}:f` }],
  [{ text: KINDS.r.label, callback_data: `k:${convId}:r` }, { text: KINDS.x.label, callback_data: `k:${convId}:x` }],
] });

async function askOwner(businessId: string, convId: string, name: string, preview: string) {
  const { data } = await db.from("sec_owners").select("bot_chat_id").eq("business_id", businessId).maybeSingle();
  if (!data?.bot_chat_id) return;
  await api(T(), "sendMessage", { chat_id: Number(data.bot_chat_id), reply_markup: askKeyboard(convId),
    text: `💬 አዲስ ውይይት: ${name}\n"${preview.slice(0, 160)}"\n\nይህ ማን ነው? ደንበኛ ከሆነ ብቻ ረዳቱ ይመልሳል፤ ጓደኛ/ቤተሰብ ከሆነ አይመልስም።` }).catch((e) => log.warn({ err: e?.message }, "ask owner failed"));
}

async function onCallback(q: any) {
  const m = /^k:([0-9a-f-]{36}):([cfrx])$/.exec(q.data ?? "");
  if (!m) return void api(T(), "answerCallbackQuery", { callback_query_id: q.id }).catch(() => {});
  const { data: owner } = await db.from("sec_owners").select("business_id").eq("tg_user_id", q.from.id).maybeSingle();
  if (!owner?.business_id) return void api(T(), "answerCallbackQuery", { callback_query_id: q.id, text: "አልተፈቀደም" }).catch(() => {});
  const k = KINDS[m[2]];
  const { data: conv } = await db.from("sec_conversations").update({ contact_kind: k.kind }).eq("id", m[1]).eq("business_id", owner.business_id)
    .select("id,tg_chat_id,customer_id,sec_customers(display_name,tg_user_id,username)").maybeSingle() as any;
  if (!conv) return void api(T(), "answerCallbackQuery", { callback_query_id: q.id, text: "ውይይቱ አልተገኘም" }).catch(() => {});
  await audit(owner.business_id, "chat.classified", { kind: k.kind });
  await api(T(), "answerCallbackQuery", { callback_query_id: q.id, text: k.label }).catch(() => {});
  const name = conv.sec_customers?.display_name ?? "";
  await api(T(), "editMessageText", { chat_id: q.message?.chat?.id, message_id: q.message?.message_id,
    text: `${k.label} — ${name}\n${k.kind === "customer" ? "✅ ረዳቱ ለዚህ ሰው በስምህ ይመልሳል።" : "ረዳቱ ለዚህ ሰው አይመልስም።"}` }).catch(() => {});
  if (k.kind !== "customer") return;
  // The first message arrived before we knew who this was — answer it now.
  const { data: last } = await db.from("sec_messages").select("tg_message_id,body").eq("conversation_id", conv.id).eq("sender", "customer")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!last || last.body === "[non-text message]") return;
  await handleIncoming({ businessId: owner.business_id, tgChatId: Number(conv.tg_chat_id), tgUserId: Number(conv.sec_customers?.tg_user_id), tgMessageId: Number(last.tg_message_id),
    chatKind: "private", text: last.body, fromSelf: false, isBot: false, isContact: false, name, username: conv.sec_customers?.username ?? undefined, replay: true }, platformSend, platformTyping);
}

async function loop() {
  let failures = 0, lastBeat = 0;
  while (!stop) {
    try {
      const updates = await api<any[]>(T(), "getUpdates", { offset, timeout: 25, allowed_updates: ["message", "business_connection", "business_message", "callback_query"] }, 40_000);
      failures = 0; st.lastPollAt = Date.now(); st.lastError = "";
      for (const u of updates) {
        st.lastUpdateAt = Date.now(); log.info({ id: u.update_id, kind: u.callback_query ? "callback_query" : u.business_message ? "business_message" : u.business_connection ? "business_connection" : "message" }, "platform update");
        offset = u.update_id + 1;
        try {
          if (u.business_connection) await registerConnection(u.business_connection);
          else if (u.business_message) await onBusinessMessage(u.business_message);
          else if (u.callback_query) await onCallback(u.callback_query);
          else if (u.message) await onDirectMessage(u.message);
        } catch (e: any) { log.error({ err: e?.message }, "platform update failed"); }
      }
      if (Date.now() - lastBeat > 30_000) { lastBeat = Date.now(); await db.from("sec_telegram_connections").update({ last_heartbeat_at: new Date().toISOString(), last_error: null }).eq("mode", "business").eq("status", "connected"); }
    } catch (e: any) {
      failures++; st.lastError = String(e?.message ?? e).slice(0, 120); log.warn({ err: e?.message, code: e?.code, failures }, "platform poll failed");
      if (e?.code === 401) { running = false; log.error("PLATFORM_BOT_TOKEN rejected by Telegram"); return; }
      await sleep(Math.min(60_000, 1000 * 2 ** Math.min(failures, 6)));       // 409 = another instance polling; back off until it exits
    }
  }
}

export async function startPlatform() {
  if (!T()) return log.info("PLATFORM_BOT_TOKEN not set — platform bot disabled");
  const me = await api<{ username: string }>(T(), "getMe"); username = me.username;
  await api(T(), "deleteWebhook", { drop_pending_updates: false }).catch(() => {});
  await api(T(), "setChatMenuButton", { menu_button: { type: "web_app", text: "ክፈት", web_app: { url: config.webAppUrl } } }).catch((e) => log.warn({ err: e?.message }, "menu button failed"));
  await api(T(), "setMyCommands", { commands: [{ command: "start", description: "ጀምር" }, { command: "status", description: "ሁኔታ" }, { command: "pause", description: "ረዳቱን አቁም" }, { command: "resume", description: "ረዳቱን ቀጥል" }] }).catch(() => {});
  await loadConnections();
  hooks.ask = askOwner;
  hooks.notify = async (businessId, text) => {
    const { data } = await db.from("sec_owners").select("bot_chat_id").eq("business_id", businessId).maybeSingle();
    if (data?.bot_chat_id) await say(Number(data.bot_chat_id), text);
  };
  running = true; void loop(); log.info({ bot: username, connections: byBc.size }, "platform bot running");
}
