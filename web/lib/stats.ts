import type { SupabaseClient } from "@supabase/supabase-js";

/** Start of "today" in the business timezone, as ISO (UTC). */
export function startOfToday(tz: string): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  // Offset of tz right now (minutes)
  const local = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const offsetMs = local.getTime() - new Date(now.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return new Date(new Date(`${parts}T00:00:00Z`).getTime() - offsetMs).toISOString();
}

export async function homeStats(sb: SupabaseClient, businessId: string, tz: string) {
  const since = startOfToday(tz);
  const week = new Date(Date.now() - 7 * 864e5).toISOString();
  const count = (q: any) => q.then((r: any) => r.count ?? 0);
  const [messages, aiReplies, active, unanswered, conn, knowledge, dry, settings] = await Promise.all([
    count(sb.from("sec_messages").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("direction", "in").gte("created_at", since)),
    count(sb.from("sec_messages").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("sender", "ai").eq("status", "sent").gte("created_at", since)),
    count(sb.from("sec_customers").select("id", { count: "exact", head: true }).eq("business_id", businessId).gte("last_contact_at", week)),
    count(sb.from("sec_conversations").select("id", { count: "exact", head: true }).eq("business_id", businessId).gt("unread_count", 0)),
    sb.from("sec_telegram_connections").select("status,last_heartbeat_at,tg_username,last_error").eq("business_id", businessId).maybeSingle().then((r) => r.data),
    count(sb.from("sec_knowledge").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("active", true)),
    count(sb.from("sec_activity_logs").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("event", "ai.test")),
    sb.from("sec_settings").select("*").eq("business_id", businessId).maybeSingle().then((r) => r.data),
  ]);
  const heartbeatFresh = !!conn?.last_heartbeat_at && Date.now() - new Date(conn.last_heartbeat_at).getTime() < 90_000;
  const steps = [
    { key: "profile", label: "Business profile", done: true, href: "/settings" },
    { key: "knowledge", label: "Add 3+ knowledge items", done: knowledge >= 3, href: "/knowledge" },
    { key: "telegram", label: "Connect Telegram", done: conn?.status === "connected", href: "/settings/telegram" },
    { key: "dryrun", label: "Test replies in dry-run", done: dry > 0, href: "/secretary" },
    { key: "live", label: "Go live (launch checklist)", done: !!settings?.automation_enabled && !settings?.dry_run, href: "/secretary" },
  ];
  const progress = Math.round((steps.filter((s) => s.done).length / steps.length) * 100);
  return { messages, aiReplies, active, unanswered, conn, heartbeatFresh, settings, steps, progress, next: steps.find((s) => !s.done) };
}
