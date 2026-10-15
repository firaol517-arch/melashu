import { NextResponse } from "next/server";
import { guard, audit } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const g = await guard(req); if ("err" in g) return g.err;
  const { ctx } = g; const admin = supabaseAdmin();
  // 1) Immediately destroy our copy of the session so nothing can use it again.
  await admin.from("sec_telegram_secrets").update({ session_enc: null }).eq("business_id", ctx.businessId);
  await admin.from("sec_telegram_connections").update({ status: "revoked", tg_user_id: null, tg_username: null }).eq("business_id", ctx.businessId);
  // 2) Ask the worker to log out server-side at Telegram (revokes the session) and stop its client.
  await admin.from("sec_telegram_auth_requests").insert({ business_id: ctx.businessId, action: "disconnect" });
  // 3) Safety net: turn automation off.
  await admin.from("sec_settings").update({ automation_enabled: false }).eq("business_id", ctx.businessId);
  await audit(ctx.businessId, "telegram.disconnected");
  return NextResponse.json({ ok: true, note: "If the worker was offline, also remove this session in Telegram → Settings → Devices." });
}
