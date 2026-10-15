"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Empty } from "./ui";

type K = { id: string; kind: string; title: string; content: string; active: boolean };
const KINDS = ["faq", "product", "service", "price", "hours", "policy"];
export default function KnowledgeManager({ items, businessId }: { items: K[]; businessId: string }) {
  const router = useRouter(); const [f, setF] = useState({ kind: "faq", title: "", content: "" }); const [err, setErr] = useState(""); const [filter, setFilter] = useState("all");
  const sb = supabaseBrowser();
  async function add(e: React.FormEvent) { e.preventDefault(); setErr("");
    const { error } = await sb.from("sec_knowledge").insert({ business_id: businessId, ...f }); if (error) return setErr("Could not save."); setF({ ...f, title: "", content: "" }); router.refresh(); }
  const shown = items.filter((i) => filter === "all" || i.kind === filter);
  return (
    <div className="space-y-5">
      <form onSubmit={add} className="card space-y-3 p-5">
        <p className="font-semibold">Add knowledge</p>
        <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="Type">{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
        <input className="input" required maxLength={200} placeholder="Title or question — e.g. Laptop price" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <textarea className="input" required rows={3} maxLength={8000} placeholder="Exact facts the AI may state — prices, hours, policy" value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} />
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}<button className="btn btn-primary">Add</button>
      </form>
      <div className="flex gap-2 overflow-x-auto">{["all", ...KINDS].map((k) => <button key={k} onClick={() => setFilter(k)} className={`btn !px-4 !py-2 text-sm ${filter === k ? "btn-primary" : "btn-ghost"}`}>{k}</button>)}</div>
      {!shown.length ? <Empty title="Nothing here yet" hint="The AI only states facts that exist here. Add prices, hours, FAQs and policies." /> :
        shown.map((i) => (<div key={i.id} className={`card p-5 ${i.active ? "" : "opacity-50"}`}>
          <div className="flex justify-between"><span className="eyebrow">{i.kind}</span>
            <span className="flex gap-3 text-sm"><button className="underline" onClick={async () => { await sb.from("sec_knowledge").update({ active: !i.active }).eq("id", i.id); router.refresh(); }}>{i.active ? "Disable" : "Enable"}</button>
              <button className="text-danger underline" onClick={async () => { if (confirm("Delete this item?")) { await sb.from("sec_knowledge").delete().eq("id", i.id); router.refresh(); } }}>Delete</button></span></div>
          <p className="mt-1 font-semibold">{i.title}</p><p className="whitespace-pre-wrap text-sm text-sage">{i.content}</p></div>))}
    </div>
  );
}
