import { NextResponse } from "next/server";
import { z } from "zod";
import { guard, audit } from "@/lib/api";
import { encrypt } from "@/lib/crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

const schema = z.object({ password: z.string().min(1).max(256) });

export async function POST(req: Request) {
  const g = await guard(req, schema); if ("err" in g) return g.err;
  const { ctx, body } = g;
  // The value is encrypted, consumed once by the worker, then wiped. It is never logged.
  await supabaseAdmin().from("sec_telegram_auth_requests").insert({ business_id: ctx.businessId, action: "verify_password", payload_enc: encrypt(JSON.stringify({ password: body.password })) });
  await audit(ctx.businessId, "telegram.verify_password");
  return NextResponse.json({ ok: true });
}
