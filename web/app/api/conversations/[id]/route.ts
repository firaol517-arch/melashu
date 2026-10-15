import { NextResponse } from "next/server";
import { z } from "zod";
import { guard, fail, audit } from "@/lib/api";

const schema = z.object({ ai_paused: z.boolean().optional(), manual_takeover: z.boolean().optional(), auto_reply_allowed: z.boolean().optional(),
  sensitive: z.boolean().optional(), needs_attention: z.boolean().optional(), unread_count: z.literal(0).optional() }).strict();

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(req, schema); if ("err" in g) return g.err;
  const { ctx, body } = g; const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("bad_id");
  const { data, error } = await ctx.supabase.from("sec_conversations").update(body).eq("id", id).select("id"); // RLS-scoped
  if (error || !data?.length) return fail("not_found", 404);
  await audit(ctx.businessId, "conversation.updated", { conversation_id: id, keys: Object.keys(body) });
  return NextResponse.json({ ok: true });
}
