import OpenAI from "openai";
import { db, audit } from "./db.js";
import { config } from "./config.js";
import { log } from "./log.js";
import { checkEligibility, classifyContact, generateDecision, isSmallTalk, retrieveKnowledge, type Settings } from "./ai-core.js";

export type Incoming = {
  businessId: string; tgChatId: number; tgAccessHash?: string; tgUserId: number; tgMessageId: number;
  chatKind: "private" | "group" | "channel"; text: string; name: string; username?: string; isContact: boolean;
  fromSelf: boolean; isBot: boolean;
  replay?: boolean;            // re-run an already-stored message (after the owner classifies the chat)
};
export type Sender = (a: { businessId: string; tgChatId: number; accessHash?: string; chatKind: string; text: string }) => Promise<{ tgMessageId: number }>;
export type Typing = (a: { businessId: string; tgChatId: number; accessHash?: string }) => Promise<void>;

/** Optional owner-notification hook (set by the platform bot). */
export const hooks = {
  notify: async (_businessId: string, _text: string): Promise<void> => {},
  ask: async (_businessId: string, _convId: string, _name: string, _preview: string, _note?: string): Promise<void> => {},   // ask the owner who a new chat is
};

const openai = config.aiKey ? new OpenAI({ apiKey: config.aiKey, baseURL: config.aiBaseUrl }) : null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Per-chat serialization so two messages in one chat never race each other.
const chains = new Map<string, Promise<unknown>>();
export function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  chains.set(key, next);
  next.finally(() => { if (chains.get(key) === next) chains.delete(key); }).catch(() => {});
  return next;
}

/** The owner's own earlier replies (stored since connection) become style examples: same chat first, then chats of the same kind. */
async function ownerStyle(businessId: string, convId: string, rel: "customer" | "friend" | "family"): Promise<string[]> {
  const ok = (t: string) => t.length >= 3 && t.length <= 280 && t !== "[non-text]";
  const { data: same } = await db.from("sec_messages").select("body").eq("conversation_id", convId).eq("sender", "owner").order("created_at", { ascending: false }).limit(6);
  const { data: ids } = await db.from("sec_conversations").select("id").eq("business_id", businessId).eq("contact_kind", rel).neq("id", convId).limit(100);
  let other: { body: string }[] = [];
  if (ids?.length) ({ data: other = [] } = await db.from("sec_messages").select("body").in("conversation_id", ids.map((i) => i.id)).eq("sender", "owner").order("created_at", { ascending: false }).limit(10) as any);
  return [...new Set([...(same ?? []), ...other].map((r) => r.body).filter(ok))].slice(0, 10);
}

export async function handleIncoming(m: Incoming, send: Sender, typing: Typing) {
  try { await handleIncomingInner(m, send, typing); }
  catch (err: any) {            // never fail silently: record why a message got no reply
    log.error({ err: err?.message }, "handleIncoming crashed");
    try { await audit(m.businessId, "ai.error", { message: String(err?.message ?? err).slice(0, 200) }); } catch {}
  }
}

async function handleIncomingInner(m: Incoming, send: Sender, typing: Typing) {
  if (m.fromSelf || m.isBot) return;                       // never process own messages or bots
  return serialize(`${m.businessId}:${m.tgChatId}`, () => process_(m, send, typing));
}

async function process_(m: Incoming, send: Sender, typing: Typing) {
  // 1) Upsert customer + conversation
  const { data: customer } = await db.from("sec_customers").upsert(
    { business_id: m.businessId, tg_user_id: m.tgUserId, display_name: m.name, username: m.username ?? null, is_contact: m.isContact, last_contact_at: new Date().toISOString() },
    { onConflict: "business_id,tg_user_id" }).select("id,is_contact,is_blocked").single();
  if (!customer) return log.error({ businessId: m.businessId }, "customer upsert failed");
  const { data: conv } = await db.from("sec_conversations").upsert(
    { business_id: m.businessId, customer_id: customer.id, tg_chat_id: m.tgChatId, chat_kind: m.chatKind, tg_access_hash: m.tgAccessHash ?? null },
    { onConflict: "business_id,tg_chat_id" }).select("*").single();
  if (!conv) return log.error({ businessId: m.businessId }, "conversation upsert failed");

  // 2) Deduplicate: unique(conversation_id, tg_message_id). A replay or reconnect re-delivery is dropped here.
  let inserted: { id: string } | null;
  if (m.replay) {
    ({ data: inserted } = await db.from("sec_messages").select("id").eq("conversation_id", conv.id).eq("tg_message_id", m.tgMessageId).maybeSingle());
    if (!inserted) return;
  } else {
    const { data, error } = await db.from("sec_messages").insert({
      business_id: m.businessId, conversation_id: conv.id, tg_message_id: m.tgMessageId, direction: "in", sender: "customer",
      body: m.text || "[non-text message]", status: "received" }).select("id").single();
    if (error) { if (error.code === "23505") return log.debug("duplicate message ignored"); await audit(m.businessId, "ai.error", { message: "message insert failed " + error.code }); return log.error({ code: error.code }, "message insert failed"); }
    inserted = data;
    await db.from("sec_conversations").update({ unread_count: (conv.unread_count ?? 0) + 1, last_message_at: new Date().toISOString(),
      last_message_preview: (m.text || "[non-text message]").slice(0, 80) }).eq("id", conv.id);
    if (!m.text) { await db.from("sec_conversations").update({ needs_attention: true, attention_reason: "non_text_message" }).eq("id", conv.id); return; }
  }

  // 3) Eligibility (default-deny)
  const [{ data: biz }, { data: settings }] = await Promise.all([
    db.from("sec_businesses").select("name,business_type,tone,business_hours,timezone").eq("id", m.businessId).single(),
    db.from("sec_settings").select("*").eq("business_id", m.businessId).single(),
  ]);
  if (!biz || !settings) return;
  // 2b) New chat? Let the AI guess customer / friend / family from what they wrote (only when confident; owner can always correct it).
  if (!conv.contact_kind && settings.auto_classify !== false && openai) {
    const { data: recent } = await db.from("sec_messages").select("body").eq("conversation_id", conv.id).eq("sender", "customer").order("created_at", { ascending: false }).limit(6);
    if ((recent?.length ?? 0) <= 6) {
      const c = await classifyContact(openai as any, { name: m.name, username: m.username, businessType: biz.business_type, messages: (recent ?? []).map((r) => r.body).reverse(), model: config.aiModel ?? settings.ai_model, jsonMode: !config.aiBaseUrl });
      if (c.kind !== "unknown" && c.confidence >= 0.75) {
        await audit(m.businessId, "chat.auto_classified", { kind: c.kind, confidence: c.confidence });
        if (c.kind === "customer") { await db.from("sec_conversations").update({ contact_kind: "customer" }).eq("id", conv.id); conv.contact_kind = "customer"; }
        else {
          // Looks personal: hold the reply and let the owner confirm the category ONCE; after that every reply is automatic.
          if (!conv.classify_prompted_at) {
            await db.from("sec_conversations").update({ classify_prompted_at: new Date().toISOString() }).eq("id", conv.id);
            void hooks.ask(m.businessId, conv.id, m.name, m.text, `🤖 ${c.kind === "family" ? "ቤተሰብ" : "ጓደኛ"} መስሎኛል። ማን እንደሆነ አረጋግጥ (አንድ ጊዜ ብቻ፤ ከዚያ በኋላ ራሱ ይመልሳል)።`).catch(() => {});
          }
          await audit(m.businessId, "ai.skipped", { reason: "awaiting_confirmation" });
          return;
        }
      }
    }
  }
  const elig = async () => {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await db.from("sec_messages").select("id", { count: "exact", head: true }).eq("business_id", m.businessId)
      .eq("sender", "ai").in("status", ["sent", "dry_run"]).gte("created_at", since);
    const { data: c } = await db.from("sec_conversations").select("*").eq("id", conv.id).single();
    const { data: cu } = await db.from("sec_customers").select("is_contact,is_blocked").eq("id", customer.id).single();
    const { data: st } = await db.from("sec_settings").select("*").eq("business_id", m.businessId).single();
    return { st: st as Settings, kind: (c as any)?.contact_kind ?? null, res: checkEligibility({ settings: st as Settings, conv: c!, customer: cu!, tz: biz.timezone, repliesLastHour: count ?? 0 }) };
  };
  const first = await elig();
  // Who is this? Only in "hold" mode (classify_new) do we ask about chats the AI could not place; otherwise unclear chats get a normal reply.
  if (!conv.contact_kind && !conv.classify_prompted_at && first.st.classify_new) {
    await db.from("sec_conversations").update({ classify_prompted_at: new Date().toISOString() }).eq("id", conv.id);
    void hooks.ask(m.businessId, conv.id, m.name, m.text).catch(() => {});
  }
  if (!first.res.ok) { await audit(m.businessId, "ai.skipped", { reason: first.res.reason }); return; }
  if (!openai) { await audit(m.businessId, "ai.skipped", { reason: "ai_not_configured" }); return; }

  // 4) Human-like delay, then re-check: settings/takeover may have changed meanwhile
  if (settings.reply_delay_seconds) { await typing({ businessId: m.businessId, tgChatId: m.tgChatId, accessHash: m.tgAccessHash }).catch(() => {}); await sleep(settings.reply_delay_seconds * 1000); }
  const again = await elig();
  if (!again.res.ok) { await audit(m.businessId, "ai.skipped", { reason: again.res.reason, phase: "recheck" }); return; }
  // If the owner already replied by hand in the last 2 minutes, stay out of the way.
  const { count: ownerRecent } = await db.from("sec_messages").select("id", { count: "exact", head: true })
    .eq("conversation_id", conv.id).eq("sender", "owner").gte("created_at", new Date(Date.now() - 120_000).toISOString());
  if (ownerRecent) { await audit(m.businessId, "ai.skipped", { reason: "owner_active" }); return; }

  // 5) Generate + validate
  const [{ data: kb }, { data: hist }] = await Promise.all([
    db.from("sec_knowledge").select("id,kind,title,content").eq("business_id", m.businessId).eq("active", true).limit(300),
    db.from("sec_messages").select("sender,body").eq("conversation_id", conv.id).neq("status", "failed").order("created_at", { ascending: false }).limit(11),
  ]);
  const relationship = again.kind === "friend" || again.kind === "family" ? again.kind : "customer";
  const smallTalk = relationship !== "customer" && isSmallTalk(m.text);                      // plain greeting from a friend/family → never inherit earlier urgency
  const history = smallTalk ? [] : (hist ?? []).reverse().slice(0, -1).map((h) => ({ role: (h.sender === "customer" ? "customer" : "us") as "customer" | "us", text: h.body }));
  const styleExamples = again.st.learn_style === false ? [] : await ownerStyle(m.businessId, conv.id, relationship);
  const knowledge = relationship === "customer" ? retrieveKnowledge(m.text, kb ?? []) : [];
  const decision = await generateDecision(openai as any, { businessName: biz.name, businessType: biz.business_type, tone: biz.tone,
    rules: again.st.response_rules, hours: (biz.business_hours as any)?.text ?? "", languageMode: again.st.language_mode, knowledge, history, incoming: m.text, relationship, styleExamples, personalTone: relationship === "friend" ? again.st.tone_friend : relationship === "family" ? again.st.tone_family : undefined, model: config.aiModel ?? again.st.ai_model, jsonMode: !config.aiBaseUrl });

  if (decision.action === "flag" && smallTalk) {   // a friend's plain greeting/farewell never needs the owner — answer with a safe short reply instead of escalating
    const am = /[\u1200-\u137F]/.test(m.text);
    (decision as any).action = "reply";
    (decision as any).reply = am ? "ሰላም! ደህና ነኝ፣ አንተስ? 🙏" : "Selam! Dehna negn, antess? 🙏";
    (decision as any).meta = { ...(decision as any).meta, fallback: "small_talk" };
  }

  if (decision.action === "flag") {
    if (decision.reason === "ai_provider_error") log.warn({ detail: (decision as any).detail, model: config.aiModel }, "ai provider error");
    await db.from("sec_conversations").update({ needs_attention: true, attention_reason: decision.reason }).eq("id", conv.id);
    await audit(m.businessId, "ai.flagged", { reason: decision.reason, detail: (decision as any).detail });
    const recent = conv.last_flag_notified_at && Date.now() - new Date(conv.last_flag_notified_at).getTime() < 15 * 60_000;   // one DM per chat per 15 min
    if (!recent) {
      await db.from("sec_conversations").update({ last_flag_notified_at: new Date().toISOString() }).eq("id", conv.id);
      void hooks.notify(m.businessId, `🔔 ${m.name} ጋር ያንተ ትኩረት ያስፈልጋል (${decision.reason}):\n"${m.text.slice(0, 140)}"\n\nበቀጥታ መልስ ስጠው።`).catch(() => {});
    }
    return;
  }

  // 6) Idempotent reply row FIRST: unique(reply_to_message_id) guarantees we never answer the same message twice.
  const dry = again.st.dry_run;
  const { data: out, error: e2 } = await db.from("sec_messages").insert({ business_id: m.businessId, conversation_id: conv.id, direction: "out",
    sender: "ai", body: decision.reply, status: dry ? "dry_run" : "sending", reply_to_message_id: inserted.id, ai_meta: decision.meta }).select("id").single();
  if (e2) { if (e2.code === "23505") { await audit(m.businessId, "ai.skipped", { reason: "already_replied" }); return log.debug("already replied"); } { await audit(m.businessId, "ai.error", { message: "reply insert failed " + e2.code }); return log.error({ code: e2.code }, "reply insert failed"); } }
  if (dry) { await audit(m.businessId, "ai.dry_run_reply"); return; }

  // 7) Send, and only mark 'sent' when Telegram returns a message id.
  try {
    const r = await send({ businessId: m.businessId, tgChatId: m.tgChatId, accessHash: m.tgAccessHash, chatKind: m.chatKind, text: decision.reply });
    await db.from("sec_messages").update({ status: "sent", tg_message_id: r.tgMessageId, sent_at: new Date().toISOString() }).eq("id", out.id);
    await db.from("sec_conversations").update({ unread_count: 0, last_message_at: new Date().toISOString(), last_message_preview: decision.reply.slice(0, 80) }).eq("id", conv.id);
    await audit(m.businessId, "ai.reply_sent");
  } catch (err: any) {
    await db.from("sec_messages").update({ status: "failed", error: String(err?.errorMessage ?? err?.message ?? "send_failed").slice(0, 200) }).eq("id", out.id);
    await db.from("sec_conversations").update({ needs_attention: true, attention_reason: "send_failed" }).eq("id", conv.id);
    await audit(m.businessId, "ai.send_failed", { error: String(err?.errorMessage ?? "send_failed").slice(0, 100) });
    void hooks.notify(m.businessId, `⚠️ ለ ${m.name} መልስ መላክ አልተሳካም። እባክህ ራስህ መልስ ስጥ።`).catch(() => {});
  }
}
