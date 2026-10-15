"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./ui";

type Msg = { id: string; direction: string; sender: string; body: string; status: string; error: string | null; created_at: string };
type Conv = { id: string; ai_paused: boolean; manual_takeover: boolean; auto_reply_allowed: boolean; sensitive: boolean; needs_attention: boolean; attention_reason: string | null };

const label: Record<string, string> = { customer: "Customer", ai: "AI", owner: "You" };

export default function ChatPanel({ conv, messages, name }: { conv: Conv; messages: Msg[]; name: string }) {
  const router = useRouter(); const [text, setText] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { api(`/api/conversations/${conv.id}`, "PATCH", { unread_count: 0 }); }, [conv.id]);
  useEffect(() => { end.current?.scrollIntoView(); }, [messages.length]);
  useEffect(() => { const i = setInterval(() => router.refresh(), 5000); return () => clearInterval(i); }, [router]);

  async function toggle(k: keyof Conv, v: boolean) { const r = await api(`/api/conversations/${conv.id}`, "PATCH", { [k]: v }); if (r.ok) router.refresh(); else setErr("Could not update."); }
  async function send(e: React.FormEvent) {
    e.preventDefault(); if (!text.trim()) return; setBusy(true); setErr("");
    const r = await api("/api/messages/send", "POST", { conversation_id: conv.id, text }); setBusy(false);
    if (!r.ok) return setErr("Could not queue your message."); setText(""); router.refresh();
  }
  const T = ({ k, l }: { k: keyof Conv; l: string }) => (
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!conv[k]} onChange={(e) => toggle(k, e.target.checked)} />{l}</label>);

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap gap-x-6 gap-y-2 p-4"><T k="auto_reply_allowed" l="Allow AI auto-reply" /><T k="ai_paused" l="Pause AI here" /><T k="manual_takeover" l="I'll handle this (manual)" /><T k="sensitive" l="Sensitive" /></div>
      {conv.needs_attention && <div className="rounded-2xl bg-sand p-4 text-sm"><b>Needs you:</b> {conv.attention_reason}. <button className="underline" onClick={() => toggle("needs_attention", false)}>Mark handled</button></div>}
      <div className="space-y-3" aria-live="polite">{messages.length === 0 && <p className="text-center text-sage">No messages yet.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : ""}`}>
            <div className={`max-w-[85%] rounded-3xl px-4 py-3 ${m.direction === "out" ? "bg-forest text-cream" : "bg-white border border-line"} ${m.status === "dry_run" ? "opacity-60 border-dashed" : ""}`}>
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p className={`mt-1 text-xs ${m.direction === "out" ? "text-cream/70" : "text-sage"}`}>{label[m.sender]}{m.status === "dry_run" ? " · draft (not sent)" : m.status === "queued" || m.status === "sending" ? " · sending…" : m.status === "failed" ? ` · failed${m.error ? `: ${m.error}` : ""}` : ""} · {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
            </div></div>))}<div ref={end} /></div>
      <form onSubmit={send} className="sticky bottom-24 flex gap-2 bg-ivory py-2"><input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Reply to ${name}…`} aria-label="Manual reply" maxLength={4000} />
        <button className="btn btn-primary" disabled={busy || !text.trim()}>Send</button></form>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}
