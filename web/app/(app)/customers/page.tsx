import { requireBusiness } from "@/lib/session";
import CustomerCard from "@/components/CustomerCard";
import { Empty } from "@/components/ui";
export const dynamic = "force-dynamic";
export default async function Customers() {
  const { supabase, business } = await requireBusiness();
  const [{ data: cs }, { data: convs }] = await Promise.all([
    supabase.from("sec_customers").select("id,display_name,username,interests,notes,last_contact_at,followup_status").eq("business_id", business.id).order("last_contact_at", { ascending: false, nullsFirst: false }).limit(200),
    supabase.from("sec_conversations").select("id,customer_id").eq("business_id", business.id),
  ]);
  const chat = new Map((convs ?? []).map((c) => [c.customer_id, c.id]));
  return (<div className="space-y-4"><p className="eyebrow">Customers</p><h2 className="font-display text-4xl">{cs?.length ?? 0} customers</h2>
    {!cs?.length ? <Empty title="No customers yet" hint="People who message you on Telegram appear here automatically." /> : cs.map((c) => <CustomerCard key={c.id} c={{ ...c, chat_id: chat.get(c.id) }} />)}</div>);
}
