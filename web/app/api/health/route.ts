import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
export const dynamic = "force-dynamic";

/** Non-secret diagnosis of the PUBLIC anon key the browser will use. Never returns key material. */
async function anonKeyCheck() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const out: Record<string, unknown> = { present: key.length > 0, length: key.length };
  if (!key) return out;
  out.dirty = key !== key.trim() || /["'\s]/.test(key);               // spaces, quotes or newlines pasted in
  out.format = key.startsWith("sb_publishable_") ? "publishable" : key.split(".").length === 3 ? "jwt" : "unknown";
  const urlRef = (() => { try { return new URL(url).hostname.split(".")[0]; } catch { return ""; } })();
  out.urlRef = urlRef;
  if (out.format === "jwt") {
    try {
      const p = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString());
      out.jwtRole = p.role;                                              // must be "anon" (NOT service_role)
      out.matchesUrlProject = p.ref === urlRef;                          // false => key is from a different project
    } catch { out.jwtDecodable = false; }
  }
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/auth/v1/settings`, { headers: { apikey: key.trim() }, cache: "no-store" });
    out.supabaseAuthStatus = r.status;                                   // 200 = key accepted, 401 = "Invalid API key"
  } catch { out.supabaseAuthStatus = "unreachable"; }
  return out;
}

export async function GET(req: Request) {
  let db = false;
  try { const { error } = await supabaseAdmin().from("sec_businesses").select("id", { head: true, count: "exact" }).limit(1); db = !error; } catch {}
  const env = { supabase: !!process.env.NEXT_PUBLIC_SUPABASE_URL, serviceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    encryptionKey: !!process.env.SESSION_ENC_KEY, ai: !!(process.env.AI_API_KEY || process.env.OPENAI_API_KEY) };
  const anon = await anonKeyCheck();
  const ok = db && Object.values(env).every(Boolean) && anon.supabaseAuthStatus === 200;
  const debug = new URL(req.url).searchParams.get("debug") === "1";   // debug=1 always answers 200 so tools that hide error bodies can read it
  return NextResponse.json({ ok, db, env, anonKey: anon }, { status: ok || debug ? 200 : 503 });
}
