import { NextResponse } from "next/server";
import { guard } from "@/lib/api";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const g = await guard(req); if ("err" in g) return g.err;
  const { ctx } = g;
  const [{ data: conn }, { data: reqs }] = await Promise.all([
    ctx.supabase.from("sec_telegram_connections").select("status,phone_hint,tg_username,last_error,last_heartbeat_at,connected_at").eq("business_id", ctx.businessId).maybeSingle(),
    ctx.supabase.from("sec_telegram_auth_requests").select("action,status,error,created_at").eq("business_id", ctx.businessId).order("created_at", { ascending: false }).limit(1),
  ]);
  const fresh = !!conn?.last_heartbeat_at && Date.now() - new Date(conn.last_heartbeat_at).getTime() < 90_000;
  return NextResponse.json({ connection: conn, lastRequest: reqs?.[0] ?? null, workerOnline: fresh });
}
