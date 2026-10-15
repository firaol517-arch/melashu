import { NextResponse } from "next/server";
import { guard } from "@/lib/api";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const g = await guard(req); if ("err" in g) return g.err;
  const { ctx } = g; const t = (n: string) => ctx.supabase.from(n).select("*").eq("business_id", ctx.businessId).then((r) => r.data ?? []);
  const [customers, conversations, messages, knowledge, followups] = await Promise.all(["sec_customers","sec_conversations","sec_messages","sec_knowledge","sec_followups"].map(t));
  return new NextResponse(JSON.stringify({ exportedAt: new Date().toISOString(), customers, conversations, messages, knowledge, followups }, null, 2),
    { headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="export.json"' } });
}
