import { NextResponse } from "next/server";
import { z } from "zod";
import { guard, fail, audit } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);
const schema = z.object({
  automation_enabled: z.boolean().optional(), dry_run: z.boolean().optional(), emergency_stop: z.boolean().optional(),
  quiet_hours_enabled: z.boolean().optional(), quiet_start: time.optional(), quiet_end: time.optional(),
  reply_to_unknown_private: z.boolean().optional(), reply_to_groups: z.boolean().optional(), reply_to_contacts: z.boolean().optional(),
  language_mode: z.enum(["match", "am", "en"]).optional(), response_rules: z.string().max(4000).optional(),
  ai_model: z.string().regex(/^[\w.:-]{2,60}$/).optional(), max_replies_per_hour: z.number().int().min(1).max(300).optional(),
  reply_delay_seconds: z.number().int().min(0).max(120).optional(),
  launch_checklist: z.record(z.string(), z.boolean()).optional(),
}).strict();

const CHECKLIST = ["reviewed_knowledge", "tested_dry_run", "understand_disclosure", "allow_list_set", "can_pause"] as const;

export async function PATCH(req: Request) {
  const g = await guard(req, schema); if ("err" in g) return g.err;
  const { ctx, body } = g; const admin = supabaseAdmin();
  const { data: cur } = await admin.from("sec_settings").select("*").eq("business_id", ctx.businessId).single();
  if (!cur) return fail("settings_missing", 404);
  const next = { ...cur, ...body };

  const goingLive = next.automation_enabled && !next.dry_run && !next.emergency_stop && (!cur.automation_enabled || cur.dry_run);
  if (goingLive) {
    const [{ data: conn }, { count: kb }, { count: tests }] = await Promise.all([
      admin.from("sec_telegram_connections").select("status").eq("business_id", ctx.businessId).single(),
      admin.from("sec_knowledge").select("id", { count: "exact", head: true }).eq("business_id", ctx.businessId).eq("active", true),
      admin.from("sec_activity_logs").select("id", { count: "exact", head: true }).eq("business_id", ctx.businessId).eq("event", "ai.test"),
    ]);
    const missing: string[] = [];
    if (conn?.status !== "connected") missing.push("Telegram must be connected");
    if ((kb ?? 0) < 3) missing.push("Add at least 3 knowledge items");
    if ((tests ?? 0) < 1) missing.push("Run at least one test reply");
    for (const k of CHECKLIST) if (!next.launch_checklist?.[k]) missing.push(`Confirm checklist item: ${k}`);
    if (missing.length) return NextResponse.json({ error: "launch_checklist_incomplete", missing }, { status: 422 });
  }
  const { error } = await admin.from("sec_settings").update(body).eq("business_id", ctx.businessId);
  if (error) return fail("update_failed", 500);
  const changed = Object.keys(body).filter((k) => k !== "response_rules" && k !== "launch_checklist");
  await audit(ctx.businessId, goingLive ? "automation.live_enabled" : "settings.updated", { keys: changed });
  return NextResponse.json({ ok: true });
}
