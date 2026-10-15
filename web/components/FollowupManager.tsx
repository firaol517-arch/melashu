"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Empty } from "./ui";
type F = { id: string; title: string; due_at: string | null; done: boolean; customer: { display_name: string } | null };
export default function FollowupManager({ items, businessId, customers }: { items: F[]; businessId: string; customers: { id: string; display_name: string }[] }) {
  const router = useRouter(); const sb = supabaseBrowser(); const [t, setT] = useState(""); const [due, setDue] = useState(""); const [cid, setCid] = useState(""); const [err, setErr] = useState("");
  return (<div className="space-y-5">
    <form className="card space-y-3 p-5" onSubmit={async (e) => { e.preventDefault(); setErr("");
      const { error } = await sb.from("sec_followups").insert({ business_id: businessId, title: t, due_at: due ? new Date(due).toISOString() : null, customer_id: cid || null });
      if (error) return setErr("Could not save."); setT(""); setDue(""); router.refresh(); }}>
      <p className="font-semibold">New reminder for you</p>
      <input className="input" required maxLength={200} placeholder="Call Abebe about the laptop order" value={t} onChange={(e) => setT(e.target.value)} />
      <div className="grid grid-cols-2 gap-3"><input type="datetime-local" className="input" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due" />
        <select className="input" value={cid} onChange={(e) => setCid(e.target.value)} aria-label="Customer"><option value="">No customer</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}</select></div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}<button className="btn btn-primary">Add reminder</button>
      <p className="text-xs text-sage">Reminders are for you. They never send messages to customers automatically.</p></form>
    {!items.length ? <Empty title="No follow-ups" hint="Add a reminder to follow up with a customer yourself." /> :
      items.map((i) => (<label key={i.id} className="card flex items-start gap-3 p-4"><input type="checkbox" className="mt-1" checked={i.done} onChange={async (e) => { await sb.from("sec_followups").update({ done: e.target.checked }).eq("id", i.id); router.refresh(); }} />
        <span className={i.done ? "line-through opacity-50" : ""}><b>{i.title}</b><span className="block text-sm text-sage">{i.customer?.display_name ? `${i.customer.display_name} · ` : ""}{i.due_at ? `due ${new Date(i.due_at).toLocaleString()}${!i.done && new Date(i.due_at) < new Date() ? " · overdue" : ""}` : "no due date"}</span></span></label>))}
  </div>);
}
