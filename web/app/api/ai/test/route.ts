import { NextResponse } from "next/server";
import { z } from "zod";
import OpenAI from "openai";
import { guard, fail, audit } from "@/lib/api";
import { generateDecision, retrieveKnowledge } from "@/lib/ai-core";

const schema = z.object({ message: z.string().trim().min(1).max(1000) });

/** Dry-run: generates a suggested reply. Never sends anything to Telegram. */
export async function POST(req: Request) {
  const g = await guard(req, schema); if ("err" in g) return g.err;
  const { ctx, body } = g;
  if (!process.env.OPENAI_API_KEY) return fail("AI provider is not configured (OPENAI_API_KEY missing on the server).", 503);
  const [{ data: biz }, { data: s }, { data: kb }] = await Promise.all([
    ctx.supabase.from("sec_businesses").select("name,business_type,tone,business_hours").eq("id", ctx.businessId).single(),
    ctx.supabase.from("sec_settings").select("response_rules,language_mode,ai_model").eq("business_id", ctx.businessId).single(),
    ctx.supabase.from("sec_knowledge").select("id,kind,title,content").eq("business_id", ctx.businessId).eq("active", true).limit(300),
  ]);
  if (!biz || !s) return fail("not_found", 404);
  const knowledge = retrieveKnowledge(body.message, kb ?? []);
  const decision = await generateDecision(new OpenAI() as any, { businessName: biz.name, businessType: biz.business_type, tone: biz.tone,
    rules: s.response_rules, hours: (biz.business_hours as any)?.text ?? "", languageMode: s.language_mode, knowledge, history: [], incoming: body.message, model: s.ai_model });
  await audit(ctx.businessId, "ai.test", { action: decision.action, reason: decision.action === "flag" ? decision.reason : undefined });
  return NextResponse.json({ decision, sources: knowledge.map((k) => ({ id: k.id, title: k.title })) });
}
