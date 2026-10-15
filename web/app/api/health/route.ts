import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
export const dynamic = "force-dynamic";
export async function GET() {
  let db = false;
  try { const { error } = await supabaseAdmin().from("sec_businesses").select("id", { head: true, count: "exact" }).limit(1); db = !error; } catch {}
  const env = { supabase: !!process.env.NEXT_PUBLIC_SUPABASE_URL, serviceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    encryptionKey: !!process.env.SESSION_ENC_KEY, ai: !!(process.env.AI_API_KEY || process.env.OPENAI_API_KEY) };
  const ok = db && Object.values(env).every(Boolean);
  return NextResponse.json({ ok, db, env }, { status: ok ? 200 : 503 });
}
