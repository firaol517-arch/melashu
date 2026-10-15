import { NextResponse } from "next/server";
import { z } from "zod";
import { guard, fail, audit } from "@/lib/api";
import { encrypt } from "@/lib/crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

const schema = z.object({
  api_id: z.coerce.number().int().positive(),
  api_hash: z.string().trim().regex(/^[a-f0-9]{32}$/i, "API hash must be 32 hex characters"),
  phone: z.string().trim().regex(/^\+\d{8,15}$/, "Use international format, e.g. +2519XXXXXXXX"),
});

export async function POST(req: Request) {
  const g = await guard(req, schema); if ("err" in g) return g.err;
  const { ctx, body } = g; const admin = supabaseAdmin();
  const { data: recent } = await admin.from("sec_telegram_auth_requests").select("created_at").eq("business_id", ctx.businessId)
    .eq("action", "send_code").gte("created_at", new Date(Date.now() - 60_000).toISOString()).limit(1);
  if (recent?.length) return fail("Please wait a minute before requesting another code (Telegram rate limit).", 429);

  await admin.from("sec_telegram_secrets").upsert({ business_id: ctx.businessId, api_id_enc: encrypt(String(body.api_id)),
    api_hash_enc: encrypt(body.api_hash), session_enc: null, updated_at: new Date().toISOString() });
  await admin.from("sec_telegram_auth_requests").insert({ business_id: ctx.businessId, action: "send_code", payload_enc: encrypt(JSON.stringify({ phone: body.phone })) });
  const masked = body.phone.slice(0, 5) + "•••" + body.phone.slice(-2);
  await admin.from("sec_telegram_connections").upsert({ business_id: ctx.businessId, status: "connecting", phone_hint: masked, last_error: null });
  await audit(ctx.businessId, "telegram.code_requested");
  return NextResponse.json({ ok: true });
}
