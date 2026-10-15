import { NextResponse } from "next/server";
import { z } from "zod";
import { guard, fail, audit } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

const schema = z.object({ conversation_id: z.string().uuid(), text: z.string().trim().min(1).max(4000) });

export async function POST(req: Request) {
  const g = await guard(req, schema); if ("err" in g) return g.err;
  const { ctx, body } = g;
  // Ownership check through RLS (user-scoped client).
  const { data: conv } = await ctx.supabase.from("sec_conversations").select("id").eq("id", body.conversation_id).maybeSingle();
  if (!conv) return fail("not_found", 404);
  // Queue only. The worker sends it and marks it 'sent' ONLY after Telegram confirms.
  const { data, error } = await supabaseAdmin().from("sec_messages").insert({
    business_id: ctx.businessId, conversation_id: body.conversation_id, direction: "out", sender: "owner", body: body.text, status: "queued",
  }).select("id").single();
  if (error) return fail("queue_failed", 500);
  await audit(ctx.businessId, "message.manual_queued", { message_id: data.id });
  return NextResponse.json({ ok: true, id: data.id });
}
