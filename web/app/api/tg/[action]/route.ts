// Mini App API. Auth = Telegram initData (verified with the platform bot token) → short HMAC session token.
// All data access uses the service role but is always scoped to the business owned by the verified Telegram user.
import { NextResponse } from "next/server";
import { z } from "zod";
import OpenAI from "openai";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyInitData, signSession, verifySession } from "@/lib/tg-auth";
import { hmacKey } from "@/lib/crypto";
import { aiConfig } from "@/lib/ai-config";
import { generateDecision, retrieveKnowledge } from "@/lib/ai-core";

export const dynamic = "force-dynamic";
const json = (b: unknown, status = 200) => NextResponse.json(b, { status });
const err = (e: string, status = 400) => json({ error: e }, status);

async function session(req: Request) {
  const t = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  let s; try { s = verifySession(t, hmacKey()); } catch { return null; }
  if (!s) return null;
  const { data } = await supabaseAdmin().from("sec_businesses").select("*").eq("id", s.biz).eq("tg_owner_id", s.tg).maybeSingle();
  return data ? { tg: s.tg, biz: data } : null;
}
const log = (b: string, event: string, detail: Record<string, unknown> = {}) => supabaseAdmin().from("sec_activity_logs").insert({ business_id: b, actor: "user", event, detail });

async function authenticate(req: Request) {
  const body = await req.json().catch(() => null);
  const token = (process.env.PLATFORM_BOT_TOKEN ?? "").replace(/\s+/g, "").replace(/^["']|["']$/g, "");
  if (!token) return err("PLATFORM_BOT_TOKEN is not configured on the server", 503);
  const u = verifyInitData(String(body?.initData ?? ""), token);
  if (!u) return err("invalid_telegram_data", 401);
  const admin = supabaseAdmin();
  await admin.from("sec_owners").upsert({ tg_user_id: u.id, first_name: u.first_name ?? null, username: u.username ?? null, language_code: u.language_code ?? null }, { onConflict: "tg_user_id" });
  let { data: biz } = await admin.from("sec_businesses").select("id").eq("tg_owner_id", u.id).maybeSingle();
  if (!biz) {
    const { data, error } = await admin.from("sec_businesses").insert({ tg_owner_id: u.id, name: u.first_name ? `${u.first_name}'s business` : "My business" }).select("id").single();
    if (error || !data) return err("could_not_create_business", 500);
    biz = data;
    await admin.from("sec_settings").insert({ business_id: biz.id, ai_provider: "gemini" });
    await admin.from("sec_telegram_connections").insert({ business_id: biz.id, mode: "business" });
    await admin.from("sec_owners").update({ business_id: biz.id }).eq("tg_user_id", u.id);
    await log(biz.id, "tg.business_created");
  } else await admin.from("sec_owners").update({ business_id: biz.id }).eq("tg_user_id", u.id);
  return json({ token: signSession({ tg: u.id, biz: biz.id }, hmacKey()), user: { id: u.id, name: u.first_name ?? "" } });
}

const bizSchema = z.object({
  name: z.string().trim().min(1).max(120), business_type: z.string().trim().max(120).default(""),
  hours: z.string().trim().max(400).default(""), location: z.string().trim().max(400).default(""),
  tone: z.string().trim().min(2).max(300).default("friendly, polite, concise"), languages: z.array(z.enum(["am", "en"])).min(1).default(["am", "en"]),
});
const kbSchema = z.object({ kind: z.enum(["faq", "product", "service", "price", "hours", "policy"]), title: z.string().trim().min(1).max(200), content: z.string().trim().min(1).max(4000) });

export async function GET(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params; const s = await session(req); if (!s) return err("unauthorized", 401);
  const admin = supabaseAdmin(); const id = s.biz.id as string;
  if (action === "me") {
    const [{ data: settings }, { data: conn }, { data: kb }, { data: owner }, { count: tests }] = await Promise.all([
      admin.from("sec_settings").select("automation_enabled,dry_run,emergency_stop,reply_to_friends,reply_to_family").eq("business_id", id).single(),
      admin.from("sec_telegram_connections").select("status,mode,last_heartbeat_at").eq("business_id", id).maybeSingle(),
      admin.from("sec_knowledge").select("id,kind,title,content").eq("business_id", id).eq("active", true).order("created_at"),
      admin.from("sec_owners").select("agreed_at").eq("tg_user_id", s.tg).maybeSingle(),
      admin.from("sec_activity_logs").select("id", { count: "exact", head: true }).eq("business_id", id).eq("event", "ai.test"),
    ]);
    const hours = (s.biz.business_hours as any)?.text ?? "";
    return json({ business: { name: s.biz.name, business_type: s.biz.business_type, tone: s.biz.tone, languages: s.biz.languages, hours },
      settings, connection: conn, knowledge: kb ?? [], agreed: !!owner?.agreed_at, tested: (tests ?? 0) > 0,
      botUsername: process.env.PLATFORM_BOT_USERNAME ?? "qeltafaw_bot",
      workerOnline: !!conn?.last_heartbeat_at && Date.now() - new Date(conn.last_heartbeat_at).getTime() < 120_000 });
  }
  if (action === "chats") {
    const { data } = await admin.from("sec_conversations").select("id,last_message_preview,last_message_at,needs_attention,attention_reason,contact_kind,sec_customers(display_name)")
      .eq("business_id", id).order("last_message_at", { ascending: false, nullsFirst: false }).limit(25);
    return json({ chats: (data ?? []).map((c: any) => ({ id: c.id, name: c.sec_customers?.display_name ?? "", preview: c.last_message_preview, at: c.last_message_at, attention: c.needs_attention, reason: c.attention_reason, kind: c.contact_kind ?? null })) });
  }
  return err("not_found", 404);
}

export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (action === "auth") return authenticate(req);
  const s = await session(req); if (!s) return err("unauthorized", 401);
  const admin = supabaseAdmin(); const id = s.biz.id as string;
  const body = await req.json().catch(() => ({}));

  if (action === "business") {
    const p = bizSchema.safeParse(body); if (!p.success) return err("invalid_input");
    const v = p.data;
    await admin.from("sec_businesses").update({ name: v.name, business_type: v.business_type, tone: v.tone, languages: v.languages, business_hours: { text: v.hours } }).eq("id", id);
    await admin.from("sec_knowledge").delete().eq("business_id", id).in("title", ["Business hours", "Location"]);          // managed items
    const rows = [v.hours && { kind: "hours", title: "Business hours", content: v.hours }, v.location && { kind: "policy", title: "Location", content: v.location }].filter(Boolean) as any[];
    if (rows.length) await admin.from("sec_knowledge").insert(rows.map((r) => ({ ...r, business_id: id })));
    await log(id, "tg.business_saved");
    return json({ ok: true });
  }
  if (action === "knowledge") {
    const p = kbSchema.safeParse(body); if (!p.success) return err("invalid_input");
    const { count } = await admin.from("sec_knowledge").select("id", { count: "exact", head: true }).eq("business_id", id);
    if ((count ?? 0) >= 100) return err("knowledge_limit_reached");
    const { data } = await admin.from("sec_knowledge").insert({ ...p.data, business_id: id }).select("id,kind,title,content").single();
    return json({ item: data });
  }
  if (action === "test") {
    const msg = z.string().trim().min(1).max(1000).safeParse(body?.message); if (!msg.success) return err("invalid_input");
    const { apiKey, baseURL, model, jsonMode } = aiConfig(); if (!apiKey) return err("AI provider is not configured", 503);
    const [{ data: st }, { data: kb }] = await Promise.all([
      admin.from("sec_settings").select("response_rules,language_mode,ai_model").eq("business_id", id).single(),
      admin.from("sec_knowledge").select("id,kind,title,content").eq("business_id", id).eq("active", true).limit(300),
    ]);
    const knowledge = retrieveKnowledge(msg.data, kb ?? []);
    const decision = await generateDecision(new OpenAI({ apiKey, baseURL }) as any, { businessName: s.biz.name, businessType: s.biz.business_type, tone: s.biz.tone,
      rules: st?.response_rules ?? "", hours: (s.biz.business_hours as any)?.text ?? "", languageMode: st?.language_mode ?? "match", knowledge, history: [], incoming: msg.data, model: model || st?.ai_model || "gpt-4o-mini", jsonMode });
    await log(id, "ai.test", { action: decision.action });
    return json({ decision });
  }
  if (action === "agree") {
    const a = z.object({ disclosure: z.literal(true), reviewed: z.literal(true), can_pause: z.literal(true) }).safeParse(body); if (!a.success) return err("you_must_accept_all");
    const [{ count: kb }, { count: tests }] = await Promise.all([
      admin.from("sec_knowledge").select("id", { count: "exact", head: true }).eq("business_id", id).eq("active", true),
      admin.from("sec_activity_logs").select("id", { count: "exact", head: true }).eq("business_id", id).eq("event", "ai.test"),
    ]);
    if ((kb ?? 0) < 3) return err("add_at_least_3_knowledge_items");
    if ((tests ?? 0) < 1) return err("run_at_least_one_test");
    await admin.from("sec_settings").update({ automation_enabled: true, dry_run: false, emergency_stop: false, reply_to_unknown_private: true, reply_to_contacts: true,
      launch_checklist: { reviewed_knowledge: true, tested_dry_run: true, understand_disclosure: true, allow_list_set: true, can_pause: true } }).eq("business_id", id);
    await admin.from("sec_businesses").update({ onboarding_completed: true }).eq("id", id);
    await admin.from("sec_owners").update({ agreed_at: new Date().toISOString() }).eq("tg_user_id", s.tg);
    await log(id, "automation.live_enabled", { via: "mini_app_agreement" });
    return json({ ok: true });
  }
  if (action === "prefs") {
    const a = z.object({ reply_to_friends: z.boolean().optional(), reply_to_family: z.boolean().optional() }).safeParse(body); if (!a.success) return err("invalid_input");
    await admin.from("sec_settings").update(a.data).eq("business_id", id);
    await log(id, "settings.personal_replies", a.data);
    return json({ ok: true });
  }
  if (action === "classify") {
    const a = z.object({ id: z.string().uuid(), kind: z.enum(["customer", "friend", "family", "ignore"]) }).safeParse(body); if (!a.success) return err("invalid_input");
    const { data } = await admin.from("sec_conversations").update({ contact_kind: a.data.kind }).eq("id", a.data.id).eq("business_id", id).select("id").maybeSingle();
    if (!data) return err("not_found", 404);
    await log(id, "chat.classified", { kind: a.data.kind, via: "mini_app" });
    return json({ ok: true });
  }
  if (action === "pause") {
    const on = z.object({ on: z.boolean() }).safeParse(body); if (!on.success) return err("invalid_input");
    await admin.from("sec_settings").update({ automation_enabled: on.data.on }).eq("business_id", id);
    await log(id, on.data.on ? "settings.resumed" : "settings.paused");
    return json({ ok: true });
  }
  return err("not_found", 404);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params; const s = await session(req); if (!s) return err("unauthorized", 401);
  if (action !== "knowledge") return err("not_found", 404);
  const kid = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(kid)) return err("invalid_input");
  await supabaseAdmin().from("sec_knowledge").delete().eq("id", kid).eq("business_id", s.biz.id);
  return json({ ok: true });
}
