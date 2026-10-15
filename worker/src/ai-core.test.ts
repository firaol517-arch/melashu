import { describe, it, expect } from "vitest";
import { checkEligibility, detectLanguage, retrieveKnowledge, validateReply, generateDecision, inQuietHours, type Settings } from "./ai-core.js";

const base: Settings = { automation_enabled: true, dry_run: false, emergency_stop: false, quiet_hours_enabled: false,
  quiet_start: "22:00", quiet_end: "07:00", reply_to_unknown_private: false, reply_to_groups: false, reply_to_contacts: false,
  language_mode: "match", response_rules: "", ai_model: "x", max_replies_per_hour: 30, reply_delay_seconds: 0 };
const conv = { chat_kind: "private" as const, auto_reply_allowed: true, ai_paused: false, manual_takeover: false, sensitive: false };
const cust = { is_contact: false, is_blocked: false };
const run = (s = {}, c = {}, u = {}, extra = {}) =>
  checkEligibility({ settings: { ...base, ...s }, conv: { ...conv, ...c }, customer: { ...cust, ...u }, tz: "Africa/Addis_Ababa", repliesLastHour: 0, ...extra });

describe("eligibility (default-deny)", () => {
  it("allows an allow-listed private customer", () => expect(run().ok).toBe(true));
  it("blocks when automation is off", () => expect(run({ automation_enabled: false })).toEqual({ ok: false, reason: "automation_off" }));
  it("emergency stop wins", () => expect(run({ emergency_stop: true })).toMatchObject({ reason: "emergency_stop" }));
  it("ignores own messages", () => expect(run({}, {}, {}, { fromSelf: true })).toMatchObject({ reason: "own_message" }));
  it("never replies in channels", () => expect(run({}, { chat_kind: "channel" })).toMatchObject({ reason: "channel" }));
  it("skips groups unless enabled", () => { expect(run({}, { chat_kind: "group" }).ok).toBe(false); expect(run({ reply_to_groups: true }, { chat_kind: "group" }).ok).toBe(true); });
  it("skips personal contacts by default", () => expect(run({}, { auto_reply_allowed: false }, { is_contact: true })).toMatchObject({ ok: false }));
  it("skips sensitive, paused and manual-takeover chats", () => {
    expect(run({}, { sensitive: true })).toMatchObject({ reason: "sensitive_conversation" });
    expect(run({}, { ai_paused: true })).toMatchObject({ reason: "conversation_paused" });
    expect(run({}, { manual_takeover: true })).toMatchObject({ reason: "manual_takeover" });
  });
  it("requires allow-list unless unknown private is enabled", () => {
    expect(run({}, { auto_reply_allowed: false })).toMatchObject({ reason: "not_allow_listed" });
    expect(run({ reply_to_unknown_private: true }, { auto_reply_allowed: false }).ok).toBe(true);
  });
  it("enforces hourly rate limit", () => expect(run({}, {}, {}, { repliesLastHour: 30 })).toMatchObject({ reason: "rate_limited" }));
  it("handles overnight quiet hours in the business timezone", () => {
    const s = { quiet_hours_enabled: true, quiet_start: "22:00", quiet_end: "07:00" };
    expect(inQuietHours(s, new Date("2026-10-14T20:00:00Z"), "Africa/Addis_Ababa")).toBe(true);  // 23:00 local
    expect(inQuietHours(s, new Date("2026-10-14T09:00:00Z"), "Africa/Addis_Ababa")).toBe(false); // 12:00 local
  });
});

describe("language + retrieval", () => {
  it("detects Amharic vs English", () => { expect(detectLanguage("ሰላም ዋጋው ስንት ነው")).toBe("am"); expect(detectLanguage("how much is it")).toBe("en"); });
  it("retrieves relevant Amharic knowledge", () => {
    const kb = [{ id: "1", kind: "price", title: "ላፕቶፕ ዋጋ", content: "ላፕቶፕ 45000 ብር" }, { id: "2", kind: "hours", title: "ሰዓት", content: "ከሰኞ እስከ ቅዳሜ" }];
    expect(retrieveKnowledge("የላፕቶፕ ዋጋ ስንት ነው", kb)[0].id).toBe("1");
  });
});

describe("reply validation (no invented facts)", () => {
  const kb = [{ id: "1", kind: "price", title: "Laptop", content: "Laptop costs 45,000 ETB" }];
  const ok = { reply: "The laptop is 45,000 ETB.", language: "en" as const, confidence: 0.9, needs_human: false, reason: "", used_knowledge_ids: ["1"] };
  it("sends grounded replies", () => expect(validateReply(ok, { knowledge: kb, customerText: "price?" }).action).toBe("send"));
  it("flags an invented price", () => expect(validateReply({ ...ok, reply: "It is 39,000 ETB." }, { knowledge: kb, customerText: "price?" })).toMatchObject({ action: "flag", reason: "ungrounded_number:39000" }));
  it("flags invented links", () => expect(validateReply({ ...ok, reply: "See https://evil.example" }, { knowledge: kb, customerText: "" }).action).toBe("flag"));
  it("flags low confidence and human requests", () => {
    expect(validateReply({ ...ok, confidence: 0.3 }, { knowledge: kb, customerText: "" }).action).toBe("flag");
    expect(validateReply({ ...ok, needs_human: true }, { knowledge: kb, customerText: "" }).action).toBe("flag");
  });
});

describe("generateDecision error recovery", () => {
  const args = { businessName: "B", businessType: "", tone: "t", rules: "", hours: "", languageMode: "match" as const, knowledge: [], history: [], incoming: "hi", model: "m" };
  const fake = (content: string | null | Error) => ({ chat: { completions: { create: async () => { if (content instanceof Error) throw content; return { choices: [{ message: { content } }] }; } } } });
  it("flags on provider failure", async () => expect(await generateDecision(fake(new Error("boom")), args)).toMatchObject({ action: "flag", reason: "ai_provider_error" }));
  it("flags on invalid JSON", async () => expect(await generateDecision(fake("not json"), args)).toMatchObject({ reason: "ai_invalid_json" }));
  it("flags on schema violation", async () => expect(await generateDecision(fake('{"reply":1}'), args)).toMatchObject({ reason: "ai_schema_violation" }));
  it("sends a valid structured reply", async () =>
    expect(await generateDecision(fake(JSON.stringify({ reply: "Hello! How can I help?", language: "en", confidence: 0.9, needs_human: false })), args)).toMatchObject({ action: "send" }));
});
