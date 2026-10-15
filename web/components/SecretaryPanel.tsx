"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./ui";

type S = Record<string, any>;
const CHECK: [string, string][] = [
  ["reviewed_knowledge", "I reviewed my knowledge base: prices, hours and policies are correct."],
  ["tested_dry_run", "I tested several realistic customer questions (Amharic and English) and the replies are acceptable."],
  ["understand_disclosure", "I understand customer messages are sent to my AI provider to generate replies, and I have told customers where required."],
  ["allow_list_set", "I know which chats are allowed to receive auto-replies (everything else stays manual)."],
  ["can_pause", "I know how to pause the AI and use the emergency stop."],
];

export default function SecretaryPanel({ s, setup }: { s: S; setup: { telegram: boolean; kb: number } }) {
  const router = useRouter();
  const [v, setV] = useState<S>(s); const [msg, setMsg] = useState<{ ok: boolean; t: string; list?: string[] } | null>(null);
  const [test, setTest] = useState(""); const [res, setRes] = useState<any>(null); const [busy, setBusy] = useState(false);

  async function patch(p: S) {
    const r = await api("/api/settings", "PATCH", p);
    if (r.ok) { setV((x) => ({ ...x, ...p })); setMsg({ ok: true, t: "Saved." }); router.refresh(); }
    else setMsg({ ok: false, t: r.data?.error === "launch_checklist_incomplete" ? "Can't go live yet:" : "Could not save.", list: r.data?.missing });
    return r.ok;
  }
  const Toggle = ({ k, l, d }: { k: string; l: string; d?: string }) => (
    <label className="flex items-start gap-3 py-2"><input type="checkbox" className="mt-1" checked={!!v[k]} onChange={(e) => patch({ [k]: e.target.checked })} />
      <span><span className="font-medium">{l}</span>{d && <span className="block text-sm text-sage">{d}</span>}</span></label>);
  const live = v.automation_enabled && !v.dry_run && !v.emergency_stop;
  const cl = v.launch_checklist ?? {};

  return (
    <div className="space-y-6">
      <section className={`card p-6 ${v.emergency_stop ? "!border-danger" : ""}`}>
        <p className="eyebrow">Status</p>
        <p className="font-display mt-1 text-3xl">{v.emergency_stop ? "Emergency stopped" : live ? "Live — replying to allow-listed chats" : v.automation_enabled ? "Dry-run — drafting, not sending" : "Paused"}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button className="btn btn-ghost !border-danger text-danger" onClick={() => patch({ emergency_stop: !v.emergency_stop })}>{v.emergency_stop ? "Release emergency stop" : "🛑 Emergency stop"}</button>
          <button className="btn btn-ghost" onClick={() => patch({ automation_enabled: !v.automation_enabled })}>{v.automation_enabled ? "Pause AI (global)" : "Enable AI (dry-run first)"}</button>
        </div>
      </section>

      <section className="card p-6">
        <p className="font-semibold">Test a reply (never sent)</p>
        <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setRes(null); const r = await api("/api/ai/test", "POST", { message: test }); setBusy(false); setRes(r.ok ? r.data : { error: r.data?.error ?? "Failed" }); router.refresh(); }}>
          <input className="input" placeholder="e.g. ላፕቶፕ ዋጋው ስንት ነው?" value={test} onChange={(e) => setTest(e.target.value)} required maxLength={1000} />
          <button className="btn btn-primary" disabled={busy}>{busy ? "…" : "Test"}</button></form>
        {res?.error && <p role="alert" className="mt-3 text-sm text-danger">{res.error}</p>}
        {res?.decision && (<div className="mt-4 rounded-2xl bg-cream p-4 text-sm">
          {res.decision.action === "send" ? <><p className="whitespace-pre-wrap text-base">{res.decision.reply}</p><p className="mt-2 text-sage">confidence {Math.round(res.decision.meta.confidence * 100)}% · {res.decision.meta.language} · sources: {res.sources.map((x: any) => x.title).join(", ") || "none"}</p></>
            : <><p><b>Would NOT auto-send</b> — flagged for you: {res.decision.reason}</p>{res.decision.draft && <p className="mt-2 text-sage">Draft: {res.decision.draft}</p>}</>}</div>)}
      </section>

      <section className="card divide-y divide-line p-6">
        <p className="pb-2 font-semibold">Automation scope</p>
        <Toggle k="reply_to_unknown_private" l="Reply to any private chat" d="Off = only chats you allow-list one by one (recommended)." />
        <Toggle k="reply_to_contacts" l="Include my saved contacts" d="Off by default so family and friends are never auto-answered." />
        <Toggle k="reply_to_groups" l="Include groups" d="Off by default. Channels are never answered." />
        <Toggle k="quiet_hours_enabled" l="Quiet hours" d={`No auto-replies between ${v.quiet_start?.slice(0, 5)} and ${v.quiet_end?.slice(0, 5)} (your business time zone).`} />
        <div className="grid grid-cols-2 gap-3 pt-3"><label className="text-sm">Quiet from<input type="time" className="input mt-1" defaultValue={v.quiet_start?.slice(0, 5)} onBlur={(e) => e.target.value && patch({ quiet_start: e.target.value })} /></label>
          <label className="text-sm">Quiet until<input type="time" className="input mt-1" defaultValue={v.quiet_end?.slice(0, 5)} onBlur={(e) => e.target.value && patch({ quiet_end: e.target.value })} /></label></div>
      </section>

      <section className="card space-y-3 p-6">
        <p className="font-semibold">Language, rules & limits</p>
        <select className="input" value={v.language_mode} onChange={(e) => patch({ language_mode: e.target.value })} aria-label="Language">
          <option value="match">Match the customer's language</option><option value="am">Always Amharic</option><option value="en">Always English</option></select>
        <textarea className="input" rows={4} defaultValue={v.response_rules} onBlur={(e) => e.target.value !== v.response_rules && patch({ response_rules: e.target.value })} placeholder="Extra rules, e.g. Always greet with ሰላም. Never discuss competitors." />
        <div className="grid grid-cols-2 gap-3"><label className="text-sm">Max replies / hour<input type="number" min={1} max={300} className="input mt-1" defaultValue={v.max_replies_per_hour} onBlur={(e) => patch({ max_replies_per_hour: Number(e.target.value) })} /></label>
          <label className="text-sm">Typing delay (sec)<input type="number" min={0} max={120} className="input mt-1" defaultValue={v.reply_delay_seconds} onBlur={(e) => patch({ reply_delay_seconds: Number(e.target.value) })} /></label></div>
        <label className="text-sm">Model<input className="input mt-1" defaultValue={v.ai_model} onBlur={(e) => e.target.value !== v.ai_model && patch({ ai_model: e.target.value })} /></label>
      </section>

      <section className="card p-6">
        <p className="font-semibold">Launch checklist — required before live replies</p>
        <ul className="mt-3 space-y-1 text-sm"><li>{setup.telegram ? "✓" : "○"} Telegram connected</li><li>{setup.kb >= 3 ? "✓" : "○"} At least 3 knowledge items ({setup.kb})</li></ul>
        <div className="mt-2 divide-y divide-line">{CHECK.map(([k, l]) => (
          <label key={k} className="flex items-start gap-3 py-2 text-sm"><input type="checkbox" className="mt-1" checked={!!cl[k]} onChange={(e) => patch({ launch_checklist: { ...cl, [k]: e.target.checked } })} />{l}</label>))}</div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button className="btn btn-gold" disabled={v.emergency_stop} onClick={() => patch({ automation_enabled: true, dry_run: false })}>Go live</button>
          <button className="btn btn-ghost" onClick={() => patch({ dry_run: true })}>Back to dry-run</button></div>
      </section>
      {msg && <div role="status" className={`text-sm ${msg.ok ? "text-leaf" : "text-danger"}`}>{msg.t}{msg.list && <ul className="ml-5 list-disc">{msg.list.map((x) => <li key={x}>{x}</li>)}</ul>}</div>}
    </div>
  );
}
