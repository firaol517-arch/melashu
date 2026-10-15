import Link from "next/link";
import { requireBusiness } from "@/lib/session";
import { homeStats } from "@/lib/stats";
import { Package, Users, Megaphone, ClipboardList, BrainCircuit, ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { supabase, business } = await requireBusiness();
  const s = await homeStats(supabase, business.id, business.timezone);
  const tg = s.conn?.status ?? "disconnected";
  const tgLabel = tg === "connected" ? (s.heartbeatFresh ? "Telegram connected" : "Connected · worker silent") : tg === "error" ? "Telegram error" : "Telegram not connected";
  const stats = [["Messages today", s.messages], ["AI replies", s.aiReplies], ["Active customers", s.active], ["Unanswered", s.unanswered]];
  const manage = [
    { href: "/chats", icon: ClipboardList, t: "Chats", d: "Inbox & manual replies" },
    { href: "/customers", icon: Users, t: "Customers", d: "Profiles, notes & history" },
    { href: "/knowledge", icon: BrainCircuit, t: "Knowledge Base", d: "FAQs, prices & policies" },
    { href: "/followups", icon: Megaphone, t: "Follow-ups", d: "Reminders for you" },
    { href: "/secretary", icon: Package, t: "AI Secretary", d: "Rules, scope & safety" },
  ];
  return (
    <div className="space-y-6">
      <section className="card p-6">
        <p className="eyebrow">Today</p>
        <h2 className="font-display mt-2 text-3xl leading-tight">
          Your secretary handled <em className="text-gold">{s.aiReplies} {s.aiReplies === 1 ? "reply" : "replies"}</em> today.
        </h2>
        <Link href="/settings/telegram" className={`mt-3 inline-flex items-center gap-2 text-sm font-medium ${tg === "connected" && s.heartbeatFresh ? "text-leaf" : "text-danger"}`}>
          ● {tgLabel}</Link>
      </section>

      <section aria-label="Today's activity" className="card grid grid-cols-2 divide-x divide-y divide-line overflow-hidden sm:grid-cols-4 sm:divide-y-0">
        {stats.map(([l, v]) => (
          <div key={l as string} className="p-5 text-center"><p className="font-display text-3xl">{v as number}</p><p className="mt-1 text-sm text-sage">{l}</p></div>
        ))}
      </section>

      <section className="card p-6">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Setup</h3><span className="font-semibold text-gold">{s.progress}%</span></div>
        <div className="mt-3 h-2 rounded-full bg-sand" role="progressbar" aria-valuenow={s.progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-2 rounded-full bg-gold" style={{ width: `${s.progress}%` }} /></div>
        <ul className="mt-4 space-y-2 text-sm">
          {s.steps.map((x) => (<li key={x.key}><Link href={x.href} className="flex items-center gap-2"><span className={x.done ? "text-leaf" : "text-sage"}>{x.done ? "✓" : "○"}</span>{x.label}</Link></li>))}
        </ul>
        {s.next && <Link href={s.next.href} className="btn btn-gold mt-4">Next: {s.next.label} →</Link>}
      </section>

      <section>
        <p className="eyebrow !text-sage mb-3">Manage your shop</p>
        <div className="card divide-y divide-line overflow-hidden">
          {manage.map(({ href, icon: I, t, d }) => (
            <Link key={href} href={href} className="flex items-center gap-4 p-5 hover:bg-cream">
              <I className="text-gold" /><div className="flex-1"><p className="font-semibold">{t}</p><p className="text-sm text-sage">{d}</p></div><ChevronRight className="text-sage" />
            </Link>))}
        </div>
      </section>
    </div>
  );
}
