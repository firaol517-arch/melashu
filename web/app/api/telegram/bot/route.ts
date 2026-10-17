import { NextResponse } from "next/server";
import { z } from "zod";
import { guard, audit } from "@/lib/api";
import { encrypt } from "@/lib/crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

const schema = z.object({ token: z.string().trim().regex(/^\d{6,12}:[A-Za-z0-9_-]{30,50}$/, "That doesn't look like a BotFather token (format 123456789:AA…)") });

export async function POST(req: Request) {
  const g = await guard(req, schema); if ("err" in g) return g.err;
  const { ctx, body } = g; const admin = supabaseAdmin();
  // Token travels to the worker encrypted; it is never stored in plain text nor returned to the browser.
  await admin.from("sec_telegram_connections").upsert({ business_id: ctx.businessId, mode: "bot", status: "connecting", phone_hint: null, last_error: null });
  await admin.from("sec_telegram_auth_requests").insert({ business_id: ctx.businessId, action: "connect_bot", payload_enc: encrypt(JSON.stringify({ token: body.token })) });
  await audit(ctx.businessId, "telegram.bot_requested");
  return NextResponse.json({ ok: true });
}
