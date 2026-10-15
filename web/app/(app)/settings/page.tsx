import Link from "next/link";
import { requireBusiness } from "@/lib/session";
import SecurityForm from "@/components/SecurityForm";
import { ChevronRight } from "lucide-react";
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { supabase, business } = await requireBusiness();
  const [{ data: s }, { count: msgs }, { count: ai }] = await Promise.all([
    supabase.from("sec_settings").select("ai_provider,ai_model").eq("business_id", business.id).single(),
    supabase.from("sec_messages").select("id", { count: "exact", head: true }).eq("business_id", business.id),
    supabase.from("sec_messages").select("id", { count: "exact", head: true }).eq("business_id", business.id).eq("sender", "ai"),
  ]);
  const rows = [["/settings/telegram", "Telegram connection", "Connect, diagnose or revoke your account"], ["/secretary", "AI provider & model", `${s?.ai_provider} · ${s?.ai_model}`],
    ["/settings/logs", "Activity log", "Audit trail of important actions"], ["/?tour=1", "Replay the tour", "Reopen the quick walkthrough"]];
  return (
    <div className="space-y-6">
      <p className="eyebrow">Settings</p>
      <div className="card divide-y divide-line overflow-hidden">{rows.map(([h, t, d]) => (
        <Link key={h} href={h} className="flex items-center justify-between p-5 hover:bg-cream"><div><p className="font-semibold">{t}</p><p className="text-sm text-sage">{d}</p></div><ChevronRight className="text-sage" /></Link>))}</div>
      <section className="card p-6"><p className="font-semibold">Usage</p><p className="mt-1 text-sm text-sage">{msgs ?? 0} messages stored · {ai ?? 0} AI messages</p></section>
      <section className="card p-6"><p className="mb-3 font-semibold">Account security & data</p><SecurityForm /></section>
    </div>
  );
}
