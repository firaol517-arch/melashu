import { requireBusiness } from "@/lib/session";
import { Empty } from "@/components/ui";
export const dynamic = "force-dynamic";

export default async function Analytics() {
  const { supabase, business } = await requireBusiness();
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const [{ data: msgs }, { count: unresolved }] = await Promise.all([
    supabase.from("sec_messages").select("id,direction,sender,status,created_at,sent_at,reply_to_message_id").eq("business_id", business.id).gte("created_at", since).limit(5000),
    supabase.from("sec_conversations").select("id", { count: "exact", head: true }).eq("business_id", business.id).or("unread_count.gt.0,needs_attention.eq.true"),
  ]);
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: business.timezone }).format(d);
  const days = Array.from({ length: 14 }, (_, i) => fmt(new Date(Date.now() - (13 - i) * 864e5)));
  const inc: Record<string, number> = {}, ai: Record<string, number> = {};
  const byId = new Map((msgs ?? []).map((m) => [m.id, m]));
  const times: number[] = [];
  for (const m of msgs ?? []) {
    const d = fmt(new Date(m.created_at));
    if (m.direction === "in") inc[d] = (inc[d] ?? 0) + 1;
    if (m.sender === "ai" && m.status === "sent") {
      ai[d] = (ai[d] ?? 0) + 1;
      const q = m.reply_to_message_id ? byId.get(m.reply_to_message_id) : null;
      if (q && m.sent_at) times.push((new Date(m.sent_at).getTime() - new Date(q.created_at).getTime()) / 1000);
    }
  }
  const total = (msgs ?? []).filter((m) => m.direction === "in").length, aiTotal = Object.values(ai).reduce((a, b) => a + b, 0);
  const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
  const max = Math.max(1, ...days.map((d) => inc[d] ?? 0));
  const cards = [["Incoming (14d)", total], ["AI replies (14d)", aiTotal], ["Avg AI response", avg === null ? "—" : `${avg}s`], ["Unresolved chats", unresolved ?? 0]];
  return (<div className="space-y-6"><p className="eyebrow">Progress</p><h2 className="font-display text-4xl">Last 14 days</h2>
    <div className="grid grid-cols-2 gap-3">{cards.map(([l, v]) => <div key={l as string} className="card p-5"><p className="font-display text-3xl">{v}</p><p className="text-sm text-sage">{l}</p></div>)}</div>
    {total === 0 ? <Empty title="No data yet" hint="Charts fill in once customers message you." /> :
      <section className="card p-5"><p className="mb-3 font-semibold">Messages per day</p>
        <div className="flex h-40 items-end gap-1" role="img" aria-label="Incoming messages per day">{days.map((d) => (
          <div key={d} className="flex flex-1 flex-col items-center justify-end gap-0.5" title={`${d}: ${inc[d] ?? 0} in, ${ai[d] ?? 0} AI`}>
            <div className="w-full rounded-t bg-gold-soft" style={{ height: `${((inc[d] ?? 0) / max) * 100}%` }} /><span className="text-[10px] text-sage">{d.slice(8)}</span></div>))}</div>
        <p className="mt-3 text-xs text-sage">Bars: incoming messages. AI replies counted only when Telegram confirmed delivery.</p></section>}
  </div>);
}
