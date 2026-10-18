"use client";
// Telegram Mini App: onboarding wizard (teach → test → agree → connect) and a small dashboard.
import { useCallback, useEffect, useRef, useState } from "react";

type KB = { id: string; kind: string; title: string; content: string };
type Me = { business: { name: string; business_type: string; tone: string; languages: string[]; hours: string };
  settings: { automation_enabled: boolean; dry_run: boolean; emergency_stop: boolean } | null; connection: { status: string } | null;
  knowledge: KB[]; agreed: boolean; tested: boolean; botUsername: string; workerOnline: boolean };
type Chat = { id: string; name: string; preview: string | null; at: string | null; attention: boolean; reason: string | null };

const tg = () => (typeof window !== "undefined" ? (window as any).Telegram?.WebApp : null);

export default function MiniApp() {
  const token = useRef<string>(""); const [me, setMe] = useState<Me | null>(null); const [error, setError] = useState(""); const [step, setStep] = useState(0);
  const [tab, setTab] = useState<"home" | "teach" | "chats">("home"); const [busy, setBusy] = useState(false);

  const call = useCallback(async (path: string, method = "GET", body?: unknown) => {
    const r = await fetch(`/api/tg/${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token.current}` }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({})); return { ok: r.ok, data: j as any };
  }, []);
  const load = useCallback(async () => { const r = await call("me"); if (r.ok) setMe(r.data); return r.data as Me; }, [call]);

  useEffect(() => {
    (async () => {
      const w = tg(); if (!w?.initData) { setError("ይህን አፕ በ Telegram ውስጥ ከ bot ክፈት።"); return; }
      w.ready(); w.expand();
      const r = await fetch("/api/tg/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: w.initData }) });
      const j = await r.json().catch(() => ({})); if (!r.ok) { setError(j.error === "invalid_telegram_data" ? "ማረጋገጥ አልተሳካም። አፑን ዘግተህ እንደገና ክፈት።" : (j.error ?? "ስህተት ተፈጥሯል")); return; }
      token.current = j.token; const m = await load();
      setStep(m.agreed ? 4 : m.knowledge.length >= 3 && m.tested ? 3 : m.knowledge.length >= 3 ? 2 : m.business.name && !m.business.name.endsWith("'s business") && m.business.name !== "My business" ? 1 : 0);
    })();
  }, [load]);

  if (error) return <Shell><p className="card p-6 text-center">{error}</p></Shell>;
  if (!me) return <Shell><p className="p-10 text-center text-sage">በመጫን ላይ…</p></Shell>;
  const connected = me.connection?.status === "connected";
  const done = me.agreed;

  return (
    <Shell>
      <header className="flex items-center justify-between px-1 pb-4">
        <div><p className="eyebrow">AI ጸሐፊ</p><h1 className="font-display text-2xl">{me.business.name}</h1></div>
        {done && <span className={`rounded-full px-3 py-1 text-xs font-semibold ${connected && me.settings?.automation_enabled ? "bg-leaf/15 text-leaf" : "bg-sand text-sage"}`}>{connected ? (me.settings?.automation_enabled ? "● በርቷል" : "⏸ ቆሟል") : "ያልተገናኘ"}</span>}
      </header>
      {!done ? <Wizard me={me} step={step} setStep={setStep} call={call} reload={load} busy={busy} setBusy={setBusy} />
        : <Dashboard me={me} tab={tab} setTab={setTab} call={call} reload={load} />}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto min-h-dvh max-w-md px-4 pb-24 pt-5">{children}</main>;
}
type P = { me: Me; call: (p: string, m?: string, b?: unknown) => Promise<{ ok: boolean; data: any }>; reload: () => Promise<Me> };

function Wizard({ me, step, setStep, call, reload, busy, setBusy }: P & { step: number; setStep: (n: number) => void; busy: boolean; setBusy: (b: boolean) => void }) {
  const [f, setF] = useState({ name: me.business.name.endsWith("'s business") || me.business.name === "My business" ? "" : me.business.name, business_type: me.business.business_type, hours: me.business.hours, location: "", tone: me.business.tone });
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState({ disclosure: false, reviewed: false, can_pause: false });
  const titles = ["ስለ ንግድህ", "አስተምረኝ", "ሞክረኝ", "ስምምነት", "አገናኝ"];
  const tryStep = async (fn: () => Promise<{ ok: boolean; data: any }>, next: number) => { setBusy(true); setMsg(""); const r = await fn(); setBusy(false);
    if (!r.ok) { setMsg(({ add_at_least_3_knowledge_items: "ቢያንስ 3 መረጃ ጨምር።", run_at_least_one_test: "መጀመሪያ አንድ ሙከራ አድርግ።", invalid_input: "መረጃውን በትክክል ሙላ።" } as any)[r.data?.error] ?? "ስህተት ተፈጥሯል"); return; }
    await reload(); setStep(next); };
  return (
    <>
      <ol className="mb-5 flex gap-1">{titles.map((t, i) => <li key={t} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-gold" : "bg-sand"}`} title={t} />)}</ol>
      <p className="eyebrow mb-2">ደረጃ {step + 1} / 5 · {titles[step]}</p>
      {step === 0 && (
        <form className="card space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); tryStep(() => call("business", "POST", { ...f, languages: ["am", "en"] }), 1); }}>
          <p className="font-display text-xl">ሰላም! ስለ ንግድህ ጥቂት ጠይቅህ።</p>
          <input className="input" required placeholder="የንግዱ ስም" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className="input" placeholder="የንግድ አይነት (ለምሳሌ፦ ኤሌክትሮኒክስ ሱቅ)" value={f.business_type} onChange={(e) => setF({ ...f, business_type: e.target.value })} />
          <input className="input" placeholder="የስራ ሰዓት (ሰኞ–ቅዳሜ 2:00–12:00)" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} />
          <input className="input" placeholder="አድራሻ (ለምሳሌ፦ ቦሌ መድኃኔዓለም)" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
          <input className="input" placeholder="የአነጋገር ቃና" value={f.tone} onChange={(e) => setF({ ...f, tone: e.target.value })} />
          <button className="btn btn-primary w-full" disabled={busy}>ቀጥል</button>
        </form>)}
      {step === 1 && (<div className="space-y-3">
        <p className="text-sm text-sage">ደንበኞች የሚጠይቁትን ዋና ነገሮች ጻፍ፦ ምርቶች፣ ዋጋ፣ አገልግሎት፣ ተደጋጋሚ ጥያቄዎች። ረዳቱ ከዚህ ብቻ ይመልሳል፤ የሌለውን አይፈጥርም። <b>ቢያንስ 3</b> (አሁን {me.knowledge.length})።</p>
        <KnowledgeEditor me={me} call={call} reload={reload} />
        {msg && <p className="text-sm text-danger">{msg}</p>}
        <button className="btn btn-primary w-full" disabled={busy || me.knowledge.length < 3} onClick={() => setStep(2)}>ቀጥል</button></div>)}
      {step === 2 && (<div className="space-y-3"><TestBox call={call} reload={reload} />
        <button className="btn btn-primary w-full" disabled={!me.tested} onClick={() => setStep(3)}>ቀጥል</button></div>)}
      {step === 3 && (
        <div className="card space-y-3 p-5">
          <p className="font-display text-xl">ከመጀመራችን በፊት ተስማማ</p>
          {([["reviewed", "የሰጠሁት መረጃ ትክክል መሆኑን አረጋግጫለሁ።"], ["disclosure", "ደንበኞች ከ AI ረዳት ጋር እየተነጋገሩ ሊሆን እንደሚችል ተረድቻለሁ፤ ለእነሱ የማሳወቅ ሃላፊነት የእኔ ነው።"], ["can_pause", "ረዳቱን በማንኛውም ጊዜ በ /pause ማቆም እንደምችል አውቃለሁ።"]] as const).map(([k, t]) => (
            <label key={k} className="flex gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 accent-[#0f2a20]" checked={(ok as any)[k]} onChange={(e) => setOk({ ...ok, [k]: e.target.checked })} />{t}</label>))}
          <p className="text-xs text-sage">ከተስማማህ በኋላ፣ ከ Telegram ሲያገናኙ ደንበኞችህን በራሱ ይመልሳል። ምላሹ በኮድ የተገደበ ነው፤ የማያውቀውን ወደ አንተ ያስተላልፋል።</p>
          {msg && <p className="text-sm text-danger">{msg}</p>}
          <button className="btn btn-primary w-full" disabled={busy || !ok.disclosure || !ok.reviewed || !ok.can_pause} onClick={() => tryStep(() => call("agree", "POST", ok), 4)}>እስማማለሁ</button>
        </div>)}
      {step === 4 && <ConnectCard me={me} reload={reload} />}
      {step > 0 && step < 4 && <button className="mt-3 w-full text-sm text-sage" onClick={() => setStep(step - 1)}>← ተመለስ</button>}
    </>);
}

function ConnectCard({ me, reload }: { me: Me; reload: () => Promise<Me> }) {
  useEffect(() => { const i = setInterval(reload, 3000); return () => clearInterval(i); }, [reload]);
  const ok = me.connection?.status === "connected";
  return (
    <div className="card space-y-3 p-5">
      <p className="font-display text-xl">{ok ? "✅ ተገናኝቷል!" : "ከ Telegram አካውንትህ አገናኝ"}</p>
      {!ok && (<>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Telegram → <b>Settings</b> → <b>Telegram Business</b> → <b>Chatbots</b></li>
          <li><b>@{me.botUsername}</b> ን ጨምር</li>
          <li><b>Reply to messages</b> ን አብራ፤ የትኞቹን ቻቶች እንደሚያይ ምረጥ (የግል ጓደኞችን አታካትት)።</li>
        </ol>
        <p className="text-xs text-sage">ማሳሰቢያ፦ Telegram Business የ <b>Telegram Premium</b> ደንበኝነት ይፈልጋል (የ Telegram ህግ)። እዚህ ገጽ ራሱ ሲገናኝ ያሳውቃል።</p></>)}
      {ok && <p className="text-sm text-sage">ደንበኞችህ ሲጽፉልህ ረዳቱ በስምህ ይመልሳል። ሁኔታውን ከዚህ ተከታተል።</p>}
      <button className="btn btn-primary w-full" onClick={() => tg()?.close?.()}>{ok ? "ዝጋ" : "አፑን ዝጋ"}</button>
    </div>);
}

function Dashboard({ me, tab, setTab, call, reload }: P & { tab: "home" | "teach" | "chats"; setTab: (t: "home" | "teach" | "chats") => void }) {
  const [chats, setChats] = useState<Chat[]>([]);
  useEffect(() => { if (tab === "chats") call("chats").then((r) => r.ok && setChats(r.data.chats)); const i = setInterval(reload, 5000); return () => clearInterval(i); }, [tab, call, reload]);
  const connected = me.connection?.status === "connected"; const on = !!me.settings?.automation_enabled;
  return (<>
    <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-md border-t border-line bg-ivory">
      {([["home", "ቤት"], ["teach", "አስተምር"], ["chats", "ቻቶች"]] as const).map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`flex-1 py-4 text-sm font-semibold ${tab === k ? "text-forest" : "text-sage"}`}>{l}</button>)}
    </nav>
    {tab === "home" && (<div className="space-y-3">
      <div className="card space-y-2 p-5">
        <p className="eyebrow">ሁኔታ</p>
        <p>ግንኙነት: <b className={connected ? "text-leaf" : "text-danger"}>{connected ? "ተገናኝቷል" : "አልተገናኘም"}</b></p>
        <p>ረዳት: <b>{on ? "በርቷል — ይመልሳል" : "ቆሟል"}</b></p>
        <button className="btn btn-primary w-full" onClick={async () => { await call("pause", "POST", { on: !on }); reload(); }}>{on ? "⏸ አቁም" : "▶️ ቀጥል"}</button>
      </div>
      {!connected && <ConnectCard me={me} reload={reload} />}
      <TestBox call={call} reload={reload} />
    </div>)}
    {tab === "teach" && <div className="space-y-3"><p className="text-sm text-sage">ረዳቱ የሚያውቀው ይህን ብቻ ነው። ትክክል ያልሆነውን ሰርዝ።</p><KnowledgeEditor me={me} call={call} reload={reload} /></div>}
    {tab === "chats" && (<div className="space-y-2">{chats.length === 0 && <p className="card p-6 text-center text-sage">ገና ቻት የለም።</p>}
      {chats.map((c) => <div key={c.id} className="card p-4"><p className="flex items-center gap-2 font-semibold">{c.name || "ደንበኛ"}{c.attention && <span className="rounded-full bg-gold-soft px-2 py-0.5 text-xs">ትኩረት</span>}</p><p className="truncate text-sm text-sage">{c.preview}</p></div>)}</div>)}
  </>);
}

function KnowledgeEditor({ me, call, reload }: P) {
  const [k, setK] = useState({ kind: "faq", title: "", content: "" }); const [busy, setBusy] = useState(false);
  const kinds: [string, string][] = [["faq", "ጥያቄ"], ["product", "ምርት"], ["price", "ዋጋ"], ["service", "አገልግሎት"], ["policy", "ህግ/ፖሊሲ"]];
  return (<div className="space-y-3">
    <div className="space-y-2">{me.knowledge.map((i) => (
      <div key={i.id} className="card flex items-start gap-3 p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{i.title}</p><p className="line-clamp-2 text-xs text-sage">{i.content}</p></div>
        <button aria-label="ሰርዝ" className="text-sage" onClick={async () => { await call(`knowledge?id=${i.id}`, "DELETE"); reload(); }}>✕</button></div>))}</div>
    <form className="card space-y-2 p-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); const r = await call("knowledge", "POST", k); setBusy(false); if (r.ok) { setK({ ...k, title: "", content: "" }); reload(); } }}>
      <select className="input" value={k.kind} onChange={(e) => setK({ ...k, kind: e.target.value })}>{kinds.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <input className="input" required placeholder="ርዕስ (ለምሳሌ፦ የ iPhone 15 ዋጋ)" value={k.title} onChange={(e) => setK({ ...k, title: e.target.value })} />
      <textarea className="input min-h-24" required placeholder="መልሱ / ዝርዝሩ (ለምሳሌ፦ 85,000 ብር፣ ዋስትና 1 አመት)" value={k.content} onChange={(e) => setK({ ...k, content: e.target.value })} />
      <button className="btn btn-gold w-full" disabled={busy}>+ ጨምር</button></form></div>);
}

function TestBox({ call, reload }: Pick<P, "call" | "reload">) {
  const [q, setQ] = useState(""); const [out, setOut] = useState<string>(""); const [busy, setBusy] = useState(false);
  return (<div className="card space-y-2 p-4"><p className="eyebrow">ሞክረኝ (አይላክም)</p>
    <div className="flex gap-2"><input className="input" placeholder="እንደ ደንበኛ ጻፍ፦ ዋጋው ስንት ነው?" value={q} onChange={(e) => setQ(e.target.value)} />
      <button className="btn btn-primary" disabled={busy || !q.trim()} onClick={async () => { setBusy(true); setOut(""); const r = await call("test", "POST", { message: q }); setBusy(false);
        const d = r.data?.decision; setOut(!r.ok ? (r.data?.error ?? "ስህተት") : d?.action === "send" ? d.reply : `አያውቅም — ወደ አንተ ያስተላልፋል (${d?.reason})`); reload(); }}>ሞክር</button></div>
    {out && <p className="rounded-2xl bg-cream p-3 text-sm">{out}</p>}</div>);
}
