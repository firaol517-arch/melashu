import { requireBusiness } from "@/lib/session";
import { Empty } from "@/components/ui";
export const dynamic = "force-dynamic";
export default async function Logs() {
  const { supabase, business } = await requireBusiness();
  const { data } = await supabase.from("sec_activity_logs").select("id,actor,event,detail,created_at").eq("business_id", business.id).order("created_at", { ascending: false }).limit(100);
  return (<div className="space-y-4"><p className="eyebrow">Settings</p><h2 className="font-display text-3xl">Activity log</h2>
    {!data?.length ? <Empty title="Nothing yet" hint="Important actions appear here. Message text is never logged." /> :
      <div className="card divide-y divide-line">{data.map((l) => (<div key={l.id} className="p-4 text-sm"><div className="flex justify-between"><b>{l.event}</b><span className="text-sage">{new Date(l.created_at).toLocaleString()}</span></div>
        <p className="text-sage">{l.actor}{Object.keys(l.detail ?? {}).length ? ` · ${JSON.stringify(l.detail)}` : ""}</p></div>))}</div>}</div>);
}
