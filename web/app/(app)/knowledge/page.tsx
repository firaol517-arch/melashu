import { requireBusiness } from "@/lib/session";
import KnowledgeManager from "@/components/KnowledgeManager";
export const dynamic = "force-dynamic";
export default async function Page() {
  const { supabase, business } = await requireBusiness();
  const { data } = await supabase.from("sec_knowledge").select("id,kind,title,content,active").eq("business_id", business.id).order("created_at", { ascending: false });
  return (<div className="space-y-4"><p className="eyebrow">Knowledge Base</p><h2 className="font-display text-4xl">What your secretary knows</h2><KnowledgeManager items={data ?? []} businessId={business.id} />
    <p className="text-sm text-sage">Document import isn't included yet — paste text into an item for now.</p></div>);
}
