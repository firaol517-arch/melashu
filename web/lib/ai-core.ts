// Pure decision logic shared by the web app (test-reply) and the Telegram worker.
// Source of truth: /shared/ai-core.ts — run `node scripts/sync-shared.mjs` after editing.
import { z } from "zod";

export type Settings = {
  automation_enabled: boolean; dry_run: boolean; emergency_stop: boolean;
  quiet_hours_enabled: boolean; quiet_start: string; quiet_end: string;
  reply_to_unknown_private: boolean; reply_to_groups: boolean; reply_to_contacts: boolean;
  language_mode: "match" | "am" | "en"; response_rules: string; ai_model: string;
  max_replies_per_hour: number; reply_delay_seconds: number;
  reply_to_friends?: boolean; reply_to_family?: boolean;   // personal-tone replies to chats classified friend / family
  tone_friend?: string; tone_family?: string;   // owner-taught tone / instructions per relationship
  auto_classify?: boolean;     // let the AI guess customer / friend / family for new chats
  learn_style?: boolean;       // false → never send the owner's past replies to the AI provider
  classify_new?: boolean;      // true → chats without a contact_kind get no reply until the owner classifies them
};
export type Conversation = {
  chat_kind: "private" | "group" | "channel"; auto_reply_allowed: boolean; ai_paused: boolean;
  manual_takeover: boolean; sensitive: boolean;
  contact_kind?: "customer" | "friend" | "family" | "ignore" | null;
};
export type Customer = { is_contact: boolean; is_blocked: boolean };
export type Knowledge = { id: string; kind: string; title: string; content: string };

export type Eligibility = { ok: true } | { ok: false; reason: string };

/** Minutes since midnight in a timezone. */
export function minutesInTz(now: Date, tz: string): number {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const h = Number(p.find((x) => x.type === "hour")!.value) % 24;
  return h * 60 + Number(p.find((x) => x.type === "minute")!.value);
}
const hm = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };

export function inQuietHours(s: Pick<Settings, "quiet_hours_enabled" | "quiet_start" | "quiet_end">, now: Date, tz: string) {
  if (!s.quiet_hours_enabled) return false;
  const m = minutesInTz(now, tz), a = hm(s.quiet_start), b = hm(s.quiet_end);
  return a <= b ? m >= a && m < b : m >= a || m < b; // handles overnight ranges
}

/** Decides whether the AI may auto-reply. Every gate is default-deny. */
export function checkEligibility(o: {
  settings: Settings; conv: Conversation; customer: Customer; tz: string; now?: Date;
  repliesLastHour: number; fromSelf?: boolean;
}): Eligibility {
  const { settings: s, conv: c, customer: u } = o;
  const now = o.now ?? new Date();
  if (o.fromSelf) return { ok: false, reason: "own_message" };
  if (s.emergency_stop) return { ok: false, reason: "emergency_stop" };
  if (!s.automation_enabled) return { ok: false, reason: "automation_off" };
  if (c.chat_kind === "channel") return { ok: false, reason: "channel" };
  if (c.chat_kind === "group" && !s.reply_to_groups) return { ok: false, reason: "group_not_enabled" };
  if (u.is_blocked) return { ok: false, reason: "customer_blocked" };
  if (c.contact_kind === "ignore") return { ok: false, reason: "personal_chat" };
  if (c.contact_kind === "friend" && !s.reply_to_friends) return { ok: false, reason: "personal_chat" };
  if (c.contact_kind === "family" && !s.reply_to_family) return { ok: false, reason: "personal_chat" };
  if (!c.contact_kind && s.classify_new) return { ok: false, reason: "awaiting_classification" };
  const isCustomer = c.contact_kind === "customer" || c.contact_kind === "friend" || c.contact_kind === "family";   // classified & allowed above
  if (u.is_contact && !s.reply_to_contacts && !c.auto_reply_allowed && !isCustomer) return { ok: false, reason: "personal_contact" };
  if (c.sensitive) return { ok: false, reason: "sensitive_conversation" };
  if (c.ai_paused) return { ok: false, reason: "conversation_paused" };
  if (c.manual_takeover) return { ok: false, reason: "manual_takeover" };
  if (!c.auto_reply_allowed && !isCustomer && !s.reply_to_unknown_private) return { ok: false, reason: "not_allow_listed" };
  if (inQuietHours(s, now, o.tz)) return { ok: false, reason: "quiet_hours" };
  if (o.repliesLastHour >= s.max_replies_per_hour) return { ok: false, reason: "rate_limited" };
  return { ok: true };
}

// ───────── language ─────────
export function detectLanguage(text: string): "am" | "en" {
  const eth = (text.match(/[ሀ-፿]/g) ?? []).length;
  const lat = (text.match(/[A-Za-z]/g) ?? []).length;
  return eth > lat ? "am" : "en";
}

// ───────── retrieval (token overlap; works for Amharic, which is space-delimited) ─────────
const tok = (t: string) => t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
export function retrieveKnowledge(query: string, items: Knowledge[], limit = 6): Knowledge[] {
  const q = new Set(tok(query));
  if (!q.size) return items.filter((i) => i.kind === "hours" || i.kind === "policy").slice(0, limit);
  return items
    .map((i) => { const words = tok(i.title + " " + i.content); const hit = words.filter((w) => q.has(w)).length;
      return { i, score: hit + (tok(i.title).filter((w) => q.has(w)).length * 2) }; })
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.i);
}

// ───────── model output contract ─────────
export const ReplySchema = z.object({
  reply: z.string().max(1200),
  language: z.enum(["am", "en"]),
  confidence: z.number().min(0).max(1),
  needs_human: z.boolean(),
  reason: z.string().max(300).optional().default(""),
  used_knowledge_ids: z.array(z.string()).default([]),
  lead: z.object({ kind: z.enum(["order", "booking", "none"]).catch("none"), summary: z.string().max(300).optional().default("") }).optional().catch(undefined),
});
export type ModelReply = z.infer<typeof ReplySchema>;

export type Decision =
  | { action: "send"; reply: string; meta: Omit<ModelReply, "reply"> }
  | { action: "flag"; reason: string; draft?: string; detail?: string };

const NUM = /(?<![\p{L}\d])\d[\d,.]*\d|\d/gu;
const URLRE = /(https?:\/\/|www\.|t\.me\/)\S+/gi;

/** Rejects replies that state numbers/URLs that are not grounded in knowledge or the customer's own message. */
export function validateReply(out: ModelReply, ctx: { knowledge: Knowledge[]; customerText: string; minConfidence?: number }): Decision {
  const flag = (reason: string): Decision => ({ action: "flag", reason, draft: out.reply });
  if (out.needs_human) return flag(out.reason || "model_requested_human");
  if (!out.reply.trim()) return flag("empty_reply");
  if (out.confidence < (ctx.minConfidence ?? 0.6)) return flag("low_confidence");
  const corpus = (ctx.knowledge.map((k) => `${k.title} ${k.content}`).join(" ") + " " + ctx.customerText).replace(/,/g, "");
  for (const n of out.reply.match(NUM) ?? []) {
    const clean = n.replace(/,/g, "").replace(/[.]$/, "");
    if (!corpus.includes(clean)) return flag(`ungrounded_number:${clean}`);
  }
  for (const u of out.reply.match(URLRE) ?? []) if (!corpus.includes(u)) return flag("ungrounded_link");
  const { reply, ...meta } = out;
  return { action: "send", reply: reply.trim(), meta };
}

// ───────── prompt ─────────
export function buildMessages(o: {
  businessName: string; businessType: string; tone: string; rules: string; hours: string;
  languageMode: Settings["language_mode"]; knowledge: Knowledge[];
  history: { role: "customer" | "us"; text: string }[]; incoming: string;
  relationship?: "customer" | "friend" | "family" | null;
  personalTone?: string;        // owner-taught tone for friend / family replies
  ownerNotes?: { title: string; content: string }[];   // things the owner taught for this friend/family category: "when they say X → I answer Y"
  styleExamples?: string[];     // the owner's own past replies — imitate tone/length/greetings, never copy facts
}) {
  const target = o.languageMode === "match" ? "Reply in the same language as the customer's latest message (Amharic ↔ አማርኛ, English ↔ English)." :
    o.languageMode === "am" ? "Always reply in Amharic (አማርኛ)." : "Always reply in English.";
  const style = o.styleExamples?.length
    ? `\nOWNER'S OWN PAST REPLIES (imitate their tone, length, greeting and sign-off habits only; these are NOT facts and must not be reused as information):\n${o.styleExamples.map((e) => `- ${e.replace(/\s+/g, " ").slice(0, 280)}`).join("\n")}\n` : "";
  const kb = o.knowledge.length
    ? o.knowledge.map((k) => `[#${k.id}] (${k.kind}) ${k.title}: ${k.content}`).join("\n")
    : "(no relevant knowledge found)";
  if (o.relationship === "friend" || o.relationship === "family") {
    const notes = o.ownerNotes?.length ? `\nTHINGS THE OWNER TAUGHT YOU (their own words — when a message matches, answer the way they taught; these are the only personal facts you may use):\n${o.ownerNotes.map((n) => `- When they say/ask: ${n.title} → owner's answer: ${n.content}`).join("\n")}` : "";
    const who = o.relationship === "family" ? "a family member" : "a friend";
    const personal = `You write the owner's personal Telegram replies to ${who}, in the owner's own voice (first person, like a real friend texting).
${target}
Tone and style (set by the owner — follow it, within the rules below): ${o.personalTone?.trim() || "warm, casual, short, natural, like a real Telegram message"}. Write exactly like a normal person chatting: short, natural, mirror the sender's language AND script (if they write Amharic in Latin letters, reply the same way). If the sender sincerely asks whether you are a bot/AI/the real person, answer honestly that this is the owner's AI assistant replying for them.
STRICT RULES:
- You know NOTHING about the owner's private life: location, plans, health, money, feelings, relationships, news. Never invent or guess any of it.
- Allowed: greetings, polite small talk, acknowledging the message. Keep the conversation going naturally until the other person ends it: answer, ask a short question back when it fits, and never say "the owner will reply" or hand the chat off. If something needs a real decision, money, a place or a time, respond like a friend would ("ishi enayew", "bego ayalehu") without promising or inventing specifics.
- Greetings and check-ins such as "hi", "selam", "how are you?", "endet neh?", "ጓደኛዬ እንዴት ነህ?" are NORMAL and NOT urgent: just answer like the owner would, in one short line ("selam wendime, dehna negn, ante endet neh?"). Do NOT introduce yourself as an assistant and do NOT say "the owner will reply" for plain small talk. Keep it light; never invent specific news, plans or feelings beyond a simple "dehna negn". Do NOT set needs_human.
- Farewells and thanks ("bye", "ciao", "tena yistilign", "ቻው", "አመሰግናለሁ", "ok") get a short, friendly closing reply; never needs_human.
- Judge urgency ONLY from the LATEST message. Earlier messages are context: if the person earlier asked to talk and the owner was already told, a new plain greeting or farewell is NOT urgent again — just answer it briefly.
- Set needs_human=true ONLY when the latest message really asks for a decision, commitment, money, a place/time, news, or help; or is urgent (emergency, "call me now"), emotional, or sensitive.
- Do not mention any business, prices, or products. Do not share links or numbers.
Owner's extra rules: ${o.rules || "(none)"}${notes}${style}
Respond ONLY with JSON: {"reply": string, "language": "am"|"en", "confidence": 0..1, "needs_human": boolean, "reason": string, "used_knowledge_ids": []}`;
    return [
      { role: "system" as const, content: personal },
      ...o.history.slice(-10).map((h) => ({ role: (h.role === "customer" ? "user" : "assistant") as "user" | "assistant", content: h.text })),
      { role: "user" as const, content: o.incoming },
    ];
  }
  const system = `You are the customer-facing secretary of "${o.businessName}" (${o.businessType || "business"}).
Tone: ${o.tone}. Write like a real person on Telegram: short, warm, natural. Never say you are an AI unless asked directly.
${target}
STRICT RULES:
- Use ONLY the BUSINESS KNOWLEDGE below. Never invent prices, stock/inventory, delivery times, discounts, policies, addresses or any fact.
- If the knowledge does not answer the question, ask ONE short clarifying question or set needs_human=true. Do not guess.
- Never promise anything (delivery, refunds, availability) unless the knowledge states it.
- Do not share links or numbers that are not in the knowledge.
- Complaints, payments, legal, medical, or anything sensitive → needs_human=true.
- If the customer clearly places an ORDER or asks to BOOK/reserve (an appointment, table, visit, delivery), set "lead": {"kind":"order"|"booking","summary":"short note: what, how many, when/where exactly as the customer said"} — never invent details; otherwise omit "lead" or use {"kind":"none"}. Still reply normally and politely confirm you noted it for the team.
Owner's extra rules: ${o.rules || "(none)"}${style}
Business hours: ${o.hours || "(not set)"}
Respond ONLY with JSON: {"reply": string, "language": "am"|"en", "confidence": 0..1, "needs_human": boolean, "reason": string, "used_knowledge_ids": string[], "lead"?: {"kind":"order"|"booking"|"none","summary":string}}

BUSINESS KNOWLEDGE:
${kb}`;
  return [
    { role: "system" as const, content: system },
    ...o.history.slice(-10).map((h) => ({ role: (h.role === "customer" ? "user" : "assistant") as "user" | "assistant", content: h.text })),
    { role: "user" as const, content: o.incoming },
  ];
}

/** Minimal chat client surface so tests can inject a fake. */
export type ChatClient = { chat: { completions: { create: (a: any) => Promise<{ choices: { message: { content: string | null } }[] }> } } };

/** Models sometimes wrap JSON in ```fences``` or add prose; pull out the first balanced {...} object. */
export function extractJson(raw: string): unknown {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("no_json");
}

/** jsonMode=false for OpenAI-compatible providers (e.g. Gemini) that don't document response_format json_object. */
export async function generateDecision(client: ChatClient, o: Parameters<typeof buildMessages>[0] & { model: string; jsonMode?: boolean }): Promise<Decision> {
  let raw: string | null = null;
  const call = () => client.chat.completions.create({ model: o.model, temperature: 0.3, ...(o.jsonMode === false ? {} : { response_format: { type: "json_object" } }), messages: buildMessages(o) });
  try {
    let r;
    try { r = await call(); }
    catch (e: any) {                                   // one retry for rate limits / transient provider errors
      const st = Number(e?.status ?? e?.code ?? 0);
      if (st === 429 || st >= 500) { await new Promise((res) => setTimeout(res, 2500)); r = await call(); } else throw e;
    }
    raw = r.choices[0]?.message?.content ?? null;
  } catch (e: any) { return { action: "flag", reason: "ai_provider_error", detail: `${e?.status ?? e?.code ?? ""} ${String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 200)}`.trim() }; }
  if (!raw) return { action: "flag", reason: "ai_empty_response" };
  let parsed;
  try { parsed = ReplySchema.safeParse(extractJson(raw)); } catch { return { action: "flag", reason: "ai_invalid_json" }; }
  if (!parsed.success) return { action: "flag", reason: "ai_schema_violation" };
  return validateReply(parsed.data, { knowledge: o.knowledge, customerText: o.incoming + " " + o.history.map((h) => h.text).join(" ") });
}

// ───────── who is this? (auto-classification of a new chat) ─────────
export const ClassifySchema = z.object({ kind: z.enum(["customer", "friend", "family", "unknown"]), confidence: z.number().min(0).max(1), why: z.string().max(200).optional().default("") });
export type Classification = z.infer<typeof ClassifySchema>;

/** Guess the relationship from the first few messages. Conservative: anything unclear is "unknown". */
export async function classifyContact(client: ChatClient, o: { name: string; username?: string; businessType: string; messages: string[]; model: string; jsonMode?: boolean }): Promise<Classification> {
  const unknown: Classification = { kind: "unknown", confidence: 0, why: "" };
  const system = `You label who a Telegram sender is relative to the owner of a ${o.businessType || "small"} business.
Labels: "customer" (asks about products, prices, orders, services, availability, delivery, booking, or is clearly doing business),
"friend" (casual banter, jokes, plans, informal teasing between peers), "family" (addresses the owner as a relative: mom, dad, brother, sister, uncle, እናት, አባት, ወንድም, እህት, አክስት, አጎት; or clearly family matters),
"unknown" (only a greeting or too little information, or anything ambiguous).
Messages may be Amharic ( አማርኛ) or Amharic written in Latin letters. Be conservative: a bare greeting like "selam" or "how are you" is "unknown".
Respond ONLY with JSON: {"kind":"customer"|"friend"|"family"|"unknown","confidence":0..1,"why":"short reason"}`;
  const user = `Sender name: ${o.name}${o.username ? ` (@${o.username})` : ""}\nMessages (oldest first):\n${o.messages.map((m) => `- ${m.slice(0, 300)}`).join("\n")}`;
  try {
    const r = await client.chat.completions.create({ model: o.model, temperature: 0, ...(o.jsonMode === false ? {} : { response_format: { type: "json_object" } }), messages: [{ role: "system", content: system }, { role: "user", content: user }] });
    const raw = r.choices[0]?.message?.content; if (!raw) return unknown;
    const p = ClassifySchema.safeParse(extractJson(raw)); return p.success ? p.data : unknown;
  } catch { return unknown; }
}

// ───────── small talk ─────────
const SMALL = new Set(("hi hello hey hola selam sellam salam selamta endet neh nesh nachu nacha endemin amesh aderu dehna dehnaneh dehnanesh dehnanachu des yilal eshi eshy ok okay okk thanks thank you tnx ameseginalehu amesegnalew yimesgen bye ciao chaw chao goodnight gn tena yistilign yistilgn how are u doing bedgame bedegame degame gwadenaye gwandenaye gwadegna wendime wondime wendeme ye ante ene negn mn new tadiya tadia ደህና ሰላም ሰላምታ እንዴት ነህ ነሽ ናችሁ ቻው አመሰግናለሁ እሺ ጓደኛዬ ወንድሜ ደግሞ በደግሜ ዛሬ").split(" "));

/** True for plain greetings / check-ins / farewells ("Hi endet neh", "bye", "እንዴት ነህ") — messages that never need the owner and must not inherit urgency from earlier chat. */
export function isSmallTalk(text: string): boolean {
  const t = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return t.length > 0 && t.length <= 7 && t.every((w) => SMALL.has(w));
}

/** Rule-based reply for plain small talk, used when the AI provider is down (quota/outage) so friends and family still get an answer. */
export function offlineSmallTalk(text: string, formal = false): string {
  const am = /[\u1200-\u137F]/.test(text);
  const low = text.toLowerCase();
  const has = (...w: string[]) => w.some((x) => low.includes(x));
  if (formal && !has("bye", "chaw", "ciao", "ቻው", "thank", "ameseginalehu", "amesegnalew", "yimesgen", "አመሰግናለሁ")) return am ? "ሰላም! እንዴት ልርዳዎት?" : "Selam! Endet lagelglot?";
  const pick = (a: string[], l: string[]) => { const arr = am ? a : l; return arr[Math.floor(Math.random() * arr.length)]; };
  if (has("bye", "chaw", "ciao", "ቻው", "goodnight", "tena yistilign")) return pick(["ቻው! በደህና 🙏", "ደህና እደር/ዋል 👋"], ["Chaw! Bedehna 🙏", "Ishi chaw 👋"]);
  if (has("thank", "ameseginalehu", "amesegnalew", "yimesgen", "አመሰግናለሁ", "ymesgen")) return pick(["ምንም አይደል! 😊", "ችግር የለም 🙏"], ["Minim ayidel! 😊", "Chigir yelem 🙏"]);
  if (has("ene dena", "ene dehna", "dena nen", "dehna nen", "dehna negn", "ደህና ነኝ")) return pick(["ጥሩ ነው፣ ደስ ይላል 😊", "ጎሽ! 👍"], ["Tiru new, des yilal 😊", "Gosh! 👍"]);
  if (has("endet", "endemin", "እንዴት", "ደህና")) return pick(["ደህና ነኝ፣ አንተስ? 😊", "ሰላም ነው፣ አንተ እንዴት ነህ?"], ["Dehna negn, antess? 😊", "Selam new, ante endet neh?"]);
  return pick(["ሰላም! 😊 ደህና ነህ?", "ሰላም ወንድሜ 👋"], ["Selam! 😊 Dehna neh?", "Selam wendime 👋"]);
}
