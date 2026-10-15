import { NextResponse } from "next/server";
import { z } from "zod";
import { guard, audit } from "@/lib/api";
import { encrypt } from "@/lib/crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

const schema = z.object({ code: z.string().trim().regex(/^\d{4,8}$/, "Enter the numeric code") });

export async function POST(req: Request) {
  const g = await guard(req, schema); if ("err" in g) return g.err;
  const { ctx, body } = g;
  // The value is encrypted, consumed once by the worker, then wiped. It is never logged.
  await supabaseAdmin().from("sec_telegram_auth_requests").insert({ business_id: ctx.businessId, action: "verify_code", payload_enc: encrypt(JSON.stringify({ code: body.code })) });
  await audit(ctx.businessId, "telegram.verify_code");
  return NextResponse.json({ ok: true });
}
