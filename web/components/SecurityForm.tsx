"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { api } from "./ui";
import { useRouter } from "next/navigation";

export default function SecurityForm() {
  const router = useRouter(); const [pw, setPw] = useState(""); const [m, setM] = useState<{ ok: boolean; t: string } | null>(null);
  return (
    <div className="space-y-4">
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const { error } = await supabaseBrowser().auth.updateUser({ password: pw });
        setM(error ? { ok: false, t: error.message } : { ok: true, t: "Password updated." }); setPw(""); }}>
        <input className="input" type="password" minLength={8} required autoComplete="new-password" placeholder="New password (8+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} />
        <button className="btn btn-primary">Change password</button>
      </form>
      <button className="btn btn-ghost" onClick={async () => { await supabaseBrowser().auth.signOut(); router.replace("/login"); router.refresh(); }}>Sign out</button>
      <div className="rounded-2xl border border-danger/40 p-4">
        <p className="font-semibold text-danger">Delete customer data</p>
        <p className="mb-3 text-sm text-sage">Permanently removes all customers, conversations and messages. Knowledge and settings stay.</p>
        <button className="btn btn-ghost !border-danger text-danger" onClick={async () => {
          if (!confirm("Delete ALL customers, conversations and messages? This cannot be undone.")) return;
          const r = await api("/api/data", "DELETE"); setM({ ok: r.ok, t: r.ok ? "Customer data deleted." : "Could not delete." }); }}>Delete all customer data</button>
        <a className="ml-3 text-sm underline" href="/api/data/export">Export my data (JSON)</a>
      </div>
      {m && <p role="status" className={`text-sm ${m.ok ? "text-leaf" : "text-danger"}`}>{m.t}</p>}
    </div>
  );
}
