// Pure decision logic shared by the web app (test-reply) and the Telegram worker.
// Source of truth: /shared/ai-core.ts — run `node scripts/sync-shared.mjs` after editing.
import { z } from "zod";

export type Settings = {
  automation_enabled: boolean; dry_run: boolean; emergency_stop: boolean;
  quiet_hours_enabled: boolean; quiet_start: string; quiet_end: string;
  reply_to_unknown_private: boolean; reply_to_groups: boolean; reply_to_contacts: boolean;
  language_mode: "match" | "am" | "en"; response_rules: string; ai_model: string;
  max_replies_per_hour: number; reply_delay_seconds: number;
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
  if (c.contact_kind === "friend" || c.contact_kind === "family" || c.contact_kind === "ignore") return { ok: false, reason: "personal_chat" };
  if (!c.contact_kind && s.classify_new) return { ok: false, reason: "awaiting_classification" };
  const isCustomer = c.contact_kind === "customer";
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
});
export type ModelReply = z.infer<typeof ReplySchema>;

export type Decision =
  | { action: "send"; reply: string; meta: Omit<ModelReply, "reply"> }
  | { action: "flag"; reason: string; draft?: string };

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
}) {
  const target = o.languageMode === "match" ? "Reply in the same language as the customer's latest message (Amharic ↔ አማርኛ, English ↔ English)." :
    o.languageMode === "am" ? "Always reply in Amharic (አማርኛ)." : "Always reply in English.";
  const kb = o.knowledge.length
    ? o.knowledge.map((k) => `[#${k.id}] (${k.kind}) ${k.title}: ${k.content}`).join("\n")
    : "(no relevant knowledge found)";
  const system = `You are the customer-facing secretary of "${o.businessName}" (${o.businessType || "business"}).
Tone: ${o.tone}. Write like a real person on Telegram: short, warm, natural. Never say you are an AI unless asked directly.
${target}
STRICT RULES:
- Use ONLY the BUSINESS KNOWLEDGE below. Never invent prices, stock/inventory, delivery times, discounts, policies, addresses or any fact.
- If the knowledge does not answer the question, ask ONE short clarifying question or set needs_human=true. Do not guess.
- Never promise anything (delivery, refunds, availability) unless the knowledge states it.
- Do not share links or numbers that are not in the knowledge.
- Complaints, payments, legal, medical, or anything sensitive → needs_human=true.
Owner's extra rules: ${o.rules || "(none)"}
Business hours: ${o.hours || "(not set)"}
Respond ONLY with JSON: {"reply": string, "language": "am"|"en", "confidence": 0..1, "needs_human": boolean, "reason": string, "used_knowledge_ids": string[]}

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
  try {
    const r = await client.chat.completions.create({ model: o.model, temperature: 0.3, ...(o.jsonMode === false ? {} : { response_format: { type: "json_object" } }), messages: buildMessages(o) });
    raw = r.choices[0]?.message?.content ?? null;
  } catch { return { action: "flag", reason: "ai_provider_error" }; }
  if (!raw) return { action: "flag", reason: "ai_empty_response" };
  let parsed;
  try { parsed = ReplySchema.safeParse(extractJson(raw)); } catch { return { action: "flag", reason: "ai_invalid_json" }; }
  if (!parsed.success) return { action: "flag", reason: "ai_schema_violation" };
  return validateReply(parsed.data, { knowledge: o.knowledge, customerText: o.incoming + " " + o.history.map((h) => h.text).join(" ") });
}
