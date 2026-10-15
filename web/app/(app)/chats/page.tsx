import Link from "next/link";
import { requireBusiness } from "@/lib/session";
import { Empty } from "@/components/ui";
export const dynamic = "force-dynamic";

const ago = (d: string | null) => { if (!d) return ""; const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };

export default async function Chats({ searchParams }: { searchParams: Promise<{ q?: string; f?: string }> }) {
  const { q = "", f = "all" } = await searchParams;
  const { supabase, business } = await requireBusiness();
  let query = supabase.from("sec_conversations").select("id,unread_count,needs_attention,ai_paused,manual_takeover,auto_reply_allowed,last_message_at,last_message_preview,customer:sec_customers(display_name,username)")
    .eq("business_id", business.id).order("last_message_at", { ascending: false, nullsFirst: false }).limit(100);
  if (f === "unread") query = query.gt("unread_count", 0);
  if (f === "attention") query = query.eq("needs_attention", true);
  if (f === "allowed") query = query.eq("auto_reply_allowed", true);
  let ids: string[] | null = null;
  const term = q.trim().replace(/[%,()]/g, " ").slice(0, 60);
  if (term) {                                               // search by message content …
    const { data: hits } = await supabase.from("sec_messages").select("conversation_id").eq("business_id", business.id).ilike("body", `%${term}%`).limit(200);
    const { data: byName } = await supabase.from("sec_customers").select("id").eq("business_id", business.id).ilike("display_name", `%${term}%`);  // … or by customer name
    const { data: convByName } = byName?.length ? await supabase.from("sec_conversations").select("id").in("customer_id", byName.map((c) => c.id)) : { data: [] };
    ids = [...new Set([...(hits ?? []).map((h) => h.conversation_id), ...(convByName ?? []).map((c) => c.id)])];
    query = ids.length ? query.in("id", ids) : query.eq("id", "00000000-0000-0000-0000-000000000000");
  }
  const { data: convs } = await query;
  const unread = (convs ?? []).filter((c) => c.unread_count > 0).length;
  const tabs = [["all", "All"], ["unread", "Unread"], ["attention", "Needs you"], ["allowed", "Auto-reply on"]];
  return (
    <div className="space-y-5">
      <p className="eyebrow">Inbox</p>
      <h2 className="font-display text-4xl">{unread ? `${unread} waiting for you.` : "All caught up."}</h2>
      <form><input name="q" defaultValue={q} className="input" placeholder="Search by name or message content…" aria-label="Search chats" />{f !== "all" && <input type="hidden" name="f" value={f} />}</form>
      <div className="flex gap-2 overflow-x-auto" role="tablist">{tabs.map(([k, l]) => (
        <Link key={k} href={`/chats?f=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`btn !px-4 !py-2 text-sm whitespace-nowrap ${f === k ? "btn-primary" : "btn-ghost"}`}>{l}</Link>))}</div>
      {!convs?.length ? <Empty title={q || f !== "all" ? "No matching chats" : "No conversations yet"} hint={q || f !== "all" ? "Try clearing the search or filter." : "Once Telegram is connected, customer chats appear here."} /> :
        <div className="space-y-3">{convs.map((c: any) => (
          <Link key={c.id} href={`/chats/${c.id}`} className="card flex items-center gap-4 p-4 hover:bg-cream">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-sand font-display text-xl">{(c.customer?.display_name || "?")[0]}</span>
            <div className="min-w-0 flex-1"><div className="flex justify-between"><p className="font-semibold">{c.customer?.display_name || "Unknown"}</p><span className="text-sm text-sage">{ago(c.last_message_at)}</span></div>
              <p className="truncate text-sm text-sage">{c.last_message_preview}</p>
              <div className="mt-1 flex gap-2 text-xs">{c.needs_attention && <span className="text-danger">● needs you</span>}{c.ai_paused && <span className="text-sage">paused</span>}{c.manual_takeover && <span className="text-gold">manual</span>}{c.auto_reply_allowed && <span className="text-leaf">AI on</span>}</div></div>
            {c.unread_count > 0 && <span className="grid h-6 min-w-6 place-items-center rounded-full bg-forest px-2 text-xs text-cream">{c.unread_count}</span>}
          </Link>))}</div>}
    </div>
  );
}
