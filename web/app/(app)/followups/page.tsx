import { requireBusiness } from "@/lib/session";
import FollowupManager from "@/components/FollowupManager";
export const dynamic = "force-dynamic";
export default async function Page() {
  const { supabase, business } = await requireBusiness();
  const [{ data }, { data: cs }] = await Promise.all([
    supabase.from("sec_followups").select("id,title,due_at,done,customer:sec_customers(display_name)").eq("business_id", business.id).order("done").order("due_at", { nullsFirst: false }),
    supabase.from("sec_customers").select("id,display_name").eq("business_id", business.id).order("display_name").limit(300)]);
  return (<div className="space-y-4"><p className="eyebrow">Follow-ups</p><h2 className="font-display text-4xl">Your reminders</h2><FollowupManager items={(data as any) ?? []} businessId={business.id} customers={cs ?? []} /></div>);
}
