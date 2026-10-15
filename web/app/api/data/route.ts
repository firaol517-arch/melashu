import { NextResponse } from "next/server";
import { guard, audit } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function DELETE(req: Request) {
  const g = await guard(req); if ("err" in g) return g.err;
  const { ctx } = g; const a = supabaseAdmin();
  await a.from("sec_messages").delete().eq("business_id", ctx.businessId);
  await a.from("sec_conversations").delete().eq("business_id", ctx.businessId);
  await a.from("sec_followups").delete().eq("business_id", ctx.businessId);
  await a.from("sec_customers").delete().eq("business_id", ctx.businessId);
  await audit(ctx.businessId, "data.customer_data_deleted");
  return NextResponse.json({ ok: true });
}
