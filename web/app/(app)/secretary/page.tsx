import { requireBusiness } from "@/lib/session";
import SecretaryPanel from "@/components/SecretaryPanel";
export const dynamic = "force-dynamic";
export default async function Page() {
  const { supabase, business } = await requireBusiness();
  const [{ data: s }, { data: conn }, { count }] = await Promise.all([
    supabase.from("sec_settings").select("*").eq("business_id", business.id).single(),
    supabase.from("sec_telegram_connections").select("status").eq("business_id", business.id).single(),
    supabase.from("sec_knowledge").select("id", { count: "exact", head: true }).eq("business_id", business.id).eq("active", true),
  ]);
  return (<div className="space-y-4"><p className="eyebrow">AI Secretary</p><h2 className="font-display text-4xl">Rules & safety</h2>
    <SecretaryPanel s={s!} setup={{ telegram: conn?.status === "connected", kb: count ?? 0 }} /></div>);
}
