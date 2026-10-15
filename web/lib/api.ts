import { NextResponse } from "next/server";
import type { ZodTypeAny, z } from "zod";
import { apiBusiness } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function guard<S extends ZodTypeAny>(req: Request, schema?: S) {
  const ctx = await apiBusiness();
  if (!ctx) return { err: fail("unauthorized", 401) } as const;
  let body: z.infer<S> | undefined;
  if (schema) {
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return { err: fail("invalid_input") } as const;
    body = parsed.data;
  }
  return { ctx, body: body as z.infer<S> } as const;
}

export async function audit(businessId: string, event: string, detail: Record<string, unknown> = {}) {
  // Never put message bodies, codes, passwords or tokens in `detail`.
  await supabaseAdmin().from("sec_activity_logs").insert({ business_id: businessId, actor: "user", event, detail });
}
