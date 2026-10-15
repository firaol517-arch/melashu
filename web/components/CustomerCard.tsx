"use client";
import { useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";

type C = { id: string; display_name: string; username: string | null; interests: string[]; notes: string; last_contact_at: string | null; followup_status: string; chat_id?: string };
export default function CustomerCard({ c }: { c: C }) {
  const [notes, setNotes] = useState(c.notes); const [interests, setInterests] = useState(c.interests.join(", ")); const [fs, setFs] = useState(c.followup_status);
  const [saved, setSaved] = useState(""); const [open, setOpen] = useState(false);
  async function save() {
    const { error } = await supabaseBrowser().from("sec_customers").update({ notes, interests: interests.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20), followup_status: fs }).eq("id", c.id);
    setSaved(error ? "Could not save" : "Saved ✓"); setTimeout(() => setSaved(""), 2000);
  }
  return (
    <div className="card p-5">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span><b>{c.display_name || "Unknown"}</b>{c.username && <span className="ml-2 text-sage">@{c.username}</span>}
          <span className="block text-sm text-sage">Last contact: {c.last_contact_at ? new Date(c.last_contact_at).toLocaleDateString() : "—"} · follow-up: {fs}</span></span><span>{open ? "−" : "+"}</span></button>
      {open && <div className="mt-4 space-y-3">
        <input className="input" placeholder="Interests (comma separated)" value={interests} onChange={(e) => setInterests(e.target.value)} />
        <textarea className="input" rows={3} placeholder="Private notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <select className="input" value={fs} onChange={(e) => setFs(e.target.value)} aria-label="Follow-up status"><option value="none">No follow-up</option><option value="pending">Follow-up pending</option><option value="done">Follow-up done</option></select>
        <div className="flex items-center gap-3"><button className="btn btn-primary" onClick={save}>Save</button>{c.chat_id && <Link className="underline" href={`/chats/${c.chat_id}`}>Open conversation history</Link>}<span className="text-sm text-leaf">{saved}</span></div></div>}
    </div>
  );
}
