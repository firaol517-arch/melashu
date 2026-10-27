"use client";
// Telegram Mini App: onboarding wizard (teach → test → agree → connect) and a small dashboard.
import { useCallback, useEffect, useRef, useState } from "react";

type KB = { id: string; kind: string; title: string; content: string };
type Me = { business: { name: string; business_type: string; tone: string; languages: string[]; hours: string };
  settings: { automation_enabled: boolean; dry_run: boolean; emergency_stop: boolean; reply_to_friends?: boolean; reply_to_family?: boolean; learn_style?: boolean; tone_friend?: string; tone_family?: string } | null; connection: { status: string } | null;
  knowledge: KB[]; personal?: KB[]; approved?: boolean; isAdmin?: boolean; agreed: boolean; tested: boolean; botUsername: string; workerOnline: boolean };
type Chat = { id: string; name: string; preview: string | null; at: string | null; attention: boolean; reason: string | null; kind: "customer" | "friend" | "family" | "ignore" | null };

const tg = () => (typeof window !== "undefined" ? (window as any).Telegram?.WebApp : null);

export default function MiniApp() {
  const token = useRef<string>(""); const [me, setMe] = useState<Me | null>(null); const [error, setError] = useState(""); const [step, setStep] = useState(0);
  const [editProfile, setEditProfile] = useState(false); const [tab, setTab] = useState<"home" | "teach" | "chats" | "profile" | "users">("home"); const [busy, setBusy] = useState(false);

  const call = useCallback(async (path: string, method = "GET", body?: unknown) => {
    try {
      const r = await fetch(`/api/tg/${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token.current}` }, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({})); return { ok: r.ok, data: j as any };
    } catch { return { ok: false, data: { error: "network" } as any }; }          // a dropped connection must never leave a button disabled forever
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
        <div className="flex items-center gap-2"><button onClick={() => setEditProfile((v) => !v)} className="rounded-full border border-sand px-3 py-1 text-xs font-semibold text-forest">{editProfile ? "✕ ዝጋ" : "✏️ መገለጫ"}</button>
        {done && <span className={`rounded-full px-3 py-1 text-xs font-semibold ${connected && me.settings?.automation_enabled ? "bg-leaf/15 text-leaf" : "bg-sand text-sage"}`}>{connected ? (me.settings?.automation_enabled ? "● በርቷል" : "⏸ ቆሟል") : "ያልተገናኘ"}</span>}</div>
      </header>
      {editProfile ? <ProfileEditor me={me} call={call} reload={load} />
        : !done ? <Wizard me={me} step={step} setStep={setStep} call={call} reload={load} busy={busy} setBusy={setBusy} />
        : <Dashboard me={me} tab={tab} setTab={setTab} call={call} reload={load} />}
      <p className="pt-4 text-center text-[10px] text-sage">ስሪት 10.23-b</p>
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
  const [testedNow, setTestedNow] = useState(false);
  const titles = ["ስለ ንግድህ", "አስተምረኝ", "ሞክረኝ", "ስምምነት", "አገናኝ"];
  const tryStep = async (fn: () => Promise<{ ok: boolean; data: any }>, next: number) => { setBusy(true); setMsg(""); let r: { ok: boolean; data: any }; try { r = await fn(); } catch { r = { ok: false, data: { error: "network" } }; } finally { setBusy(false); }
    if (!r.ok) { setMsg(({ add_at_least_3_knowledge_items: "ቢያንስ 3 መረጃ ጨምር።", run_at_least_one_test: "መጀመሪያ አንድ ሙከራ አድርግ።", invalid_input: "መረጃውን በትክክል ሙላ።" } as any)[r.data?.error] ?? `ስህተት ተፈጥሯል (${r.data?.error ?? "network"})። እንደገና ሞክር።`); return; }
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
        <button className="btn btn-primary w-full" disabled={me.knowledge.length < 3} onClick={() => setStep(2)}>ቀጥል</button></div>)}
      {step === 2 && (<div className="space-y-3"><TestBox call={call} reload={reload} onTested={() => setTestedNow(true)} />
        <p className="text-xs text-sage">አንድ ጥያቄ ሞክረህ መልስ ሲመጣ "ቀጥል" ይበራል። ረዳቱ "አያውቅም" ካለ ችግር የለም፤ ጥያቄው ከጻፍከው መረጃ ውጭ ነው ማለት ነው።</p>
        <button className="btn btn-primary w-full" disabled={!me.tested && !testedNow} onClick={() => setStep(3)}>ቀጥል</button></div>)}
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

function Dashboard({ me, tab, setTab, call, reload }: P & { tab: "home" | "teach" | "chats" | "profile" | "users"; setTab: (t: "home" | "teach" | "chats" | "profile" | "users") => void }) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [st, setSt] = useState<{ customers: number; unclassified: number; attention: number; replies24: number; incoming24: number } | null>(null);
  useEffect(() => { if (tab === "home") call("stats").then((r) => r.ok && setSt(r.data)); }, [tab, call, me]);
  useEffect(() => { if (tab === "chats") call("chats").then((r) => r.ok && setChats(r.data.chats)); const i = setInterval(reload, 5000); return () => clearInterval(i); }, [tab, call, reload]);
  const connected = me.connection?.status === "connected"; const on = !!me.settings?.automation_enabled;
  return (<>
    <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-md border-t border-line bg-ivory">
      {([["home", "ቤት"], ["teach", "አስተምር"], ["chats", "ቻቶች"], ["profile", "መገለጫ"], ...(me.isAdmin ? [["users", "ተጠቃሚዎች"] as const] : [])] as const).map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`flex-1 py-4 text-sm font-semibold ${tab === k ? "text-forest" : "text-sage"}`}>{l}</button>)}
    </nav>
    {me.approved === false && <p className="card p-4 text-sm font-semibold text-forest">⏳ ስምምነትህ ተመዝግቧል። ረዳቱ እንዲበራ የአስተዳዳሪ ፈቃድ እየተጠበቀ ነው፤ ሲፈቀድ ራሱ ይበራል።</p>}
    {tab === "home" && (<div className="space-y-3">
      <Leads call={call} />
      <div className="card space-y-2 p-5">
        <p className="eyebrow">ሁኔታ</p>
        <p>ግንኙነት: <b className={connected ? "text-leaf" : "text-danger"}>{connected ? "ተገናኝቷል" : "አልተገናኘም"}</b></p>
        <p>ረዳት: <b>{on ? "በርቷል — ይመልሳል" : "ቆሟል"}</b></p>
        <button className="btn btn-primary w-full" onClick={async () => { await call("pause", "POST", { on: !on }); reload(); }}>{on ? "⏸ አቁም" : "▶️ ቀጥል"}</button>
      </div>
      {st && <div className="grid grid-cols-2 gap-3">{([["ደንበኞች", st.customers], ["ያልተለዩ ቻቶች", st.unclassified], ["ትኩረት የሚሹ", st.attention], ["ዛሬ የመጡ መልእክቶች", st.incoming24], ["ዛሬ የመለሰው", st.replies24]] as const).map(([l, n]) =>
        <div key={l} className="card p-4"><p className="text-2xl font-bold text-forest">{n}</p><p className="text-xs text-sage">{l}</p></div>)}</div>}
      {!connected && <ConnectCard me={me} reload={reload} />}
      <TestBox call={call} reload={reload} />
    </div>)}
    {tab === "teach" && <div className="space-y-3"><p className="text-sm text-sage">ረዳቱ የሚያውቀው ይህን ብቻ ነው። ትክክል ያልሆነውን ሰርዝ።</p><KnowledgeEditor me={me} call={call} reload={reload} /></div>}
    {tab === "chats" && (<div className="card space-y-3 p-4"><p className="text-sm font-semibold text-forest">ለግል ሰዎች ረዳቱ ይመልስ?</p><p className="text-xs text-sage">ሞቅ ያለ አጭር መልስ ብቻ፤ ስለ አንተ ምንም አይገምትም፣ ለውሳኔ ወይም ገንዘብ ጥያቄ ላንተ ያስተላልፋል።</p>
      {([["reply_to_friends", "🤝 ጓደኞች"], ["reply_to_family", "👨‍👩‍👧 ቤተሰብ"], ["learn_style", "✍️ ከመልሶቼ አጻጻፍ ተማር"]] as const).map(([k, l]) => { const on = k === "learn_style" ? (me.settings as any)?.learn_style !== false : !!(me.settings as any)?.[k];
        return <button key={k} onClick={async () => { await call("prefs", "POST", { [k]: !on }); await reload(); }} className="flex w-full items-center justify-between rounded-2xl border border-sand px-4 py-3 text-sm font-semibold"><span>{l}</span><span className={on ? "text-leaf" : "text-sage"}>{k === "learn_style" ? (on ? "በርቷል ✓" : "ጠፍቷል") : (on ? "ይመልሳል ✓" : "አይመልስም")}</span></button>; })}
      {([["tone_friend", "🤝 ለጓደኞች ቃና / መመሪያ", "ለምሳሌ፦ ተጫዋች፣ አጭር፣ በአማርኛ፣ ኢሞጂ ተጠቀም"], ["tone_family", "👨‍👩‍👧 ለቤተሰብ ቃና / መመሪያ", "ለምሳሌ፦ አክብሮት ያለው፣ ሞቅ ያለ፣ አጭር"]] as const).map(([k, l, ph]) =>
        <label key={k} className="block text-sm font-semibold text-forest">{l}<textarea defaultValue={(me.settings as any)?.[k] ?? ""} maxLength={500} rows={2} placeholder={ph}
          onBlur={async (e) => { if (e.target.value !== ((me.settings as any)?.[k] ?? "")) { await call("prefs", "POST", { [k]: e.target.value }); await reload(); } }}
          className="mt-1 w-full rounded-2xl border border-sand bg-ivory p-3 text-sm font-normal" /></label>)}
      <PersonalTeach me={me} call={call} reload={reload} />
    </div>)}
    {tab === "chats" && <Replies call={call} reload={reload} />}
    {tab === "users" && <AdminUsers call={call} />}
    {tab === "profile" && <ProfileEditor me={me} call={call} reload={reload} />}
    {tab === "chats" && (<div className="space-y-2">{chats.length === 0 && <p className="card p-6 text-center text-sage">ገና ቻት የለም።</p>}
      {chats.map((c) => <div key={c.id} className="card p-4"><p className="flex items-center gap-2 font-semibold">{c.name || "ደንበኛ"}{c.attention && <span className="rounded-full bg-gold-soft px-2 py-0.5 text-xs">ትኩረት</span>}{!c.kind && <span className="rounded-full bg-gold-soft px-2 py-0.5 text-xs">ያልተለየ</span>}</p><p className="truncate text-sm text-sage">{c.preview}</p>
        <div className="mt-3 flex flex-wrap gap-2">{([["customer", "💼 ደንበኛ"], ["friend", "🤝 ጓደኛ"], ["family", "👨‍👩‍👧 ቤተሰብ"], ["ignore", "🚫 ችላ"]] as const).map(([k, l]) =>
          <button key={k} onClick={async () => { const r = await call("classify", "POST", { id: c.id, kind: k }); if (r.ok) setChats((all) => all.map((x) => x.id === c.id ? { ...x, kind: k } : x)); }}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${c.kind === k ? "border-forest bg-forest text-ivory" : "border-sand text-forest"}`}>{l}</button>)}</div></div>)}</div>)}
  </>);
}

function AdminUsers({ call }: Pick<P, "call">) {
  type U = { tg: string; name: string; username: string; business: string; type: string; agreed: boolean; approved: boolean; connection: string; on: boolean; stats: { inc: number; sent: number; flagged: number; errors: number; cust: number; fr: number; fam: number } | null; at: string };
  const [us, setUs] = useState<U[]>([]); const [err, setErr] = useState("");
  const load = useCallback(() => { call("admin_users").then((r) => r.ok ? setUs(r.data.users) : setErr("መዳረሻ የለህም")); }, [call]);
  useEffect(() => { load(); }, [load]);
  if (err) return <p className="card p-4 text-sm">{err}</p>;
  return (<div className="space-y-2"><p className="text-xs text-sage">የተመዘገቡ ሰዎች መረጃ (የንግድ መረጃ ብቻ፤ የቻት ይዘት አይታይም)።</p>
    {us.map((u) => <div key={u.tg} className="card space-y-1 p-4 text-sm">
      <p className="font-semibold">{u.business || "(ንግድ ገና አልተሞላም)"} <span className="font-normal text-sage">· {u.name}{u.username ? ` @${u.username}` : ""}</span></p>
      <p className="text-xs text-sage">{u.type || "—"} · ተመዝግቧል {new Date(u.at).toLocaleDateString()} · ስምምነት {u.agreed ? "✅" : "—"} · ግንኙነት {u.connection} · ረዳት {u.on ? "በርቷል" : "ቆሟል"} </p>
      {u.stats && <p className="text-xs">📊 ባለፉት 7 ቀን፦ የገቡ {u.stats.inc} · የተመለሱ {u.stats.sent} · ማስጠንቀቂያ {u.stats.flagged}{u.stats.errors ? ` · ⚠️ ስህተት ${u.stats.errors}` : ""} · ቻቶች፦ ደንበኛ {u.stats.cust} / ጓደኛ {u.stats.fr} / ቤተሰብ {u.stats.fam}</p>}
      <button className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${u.approved ? "border-sand text-forest" : "border-forest bg-forest text-ivory"}`}
        onClick={async () => { await call("admin_set", "POST", { tg: u.tg, approved: !u.approved }); load(); }}>{u.approved ? "⏸ አቁም / ፈቃድ ሰርዝ" : "✅ ፍቀድ"}</button></div>)}
  </div>);
}

function ProfileEditor({ me, call, reload }: P) {
  const [f, setF] = useState({ name: me.business.name === "My business" ? "" : me.business.name, business_type: me.business.business_type ?? "", hours: me.business.hours ?? "",
    location: me.knowledge.find((k) => k.title === "Location")?.content ?? "", tone: me.business.tone ?? "" });
  const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(""); const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setSaved(""); };
  return (<form className="card space-y-3 p-5" onSubmit={async (e) => { e.preventDefault(); setBusy(true); const r = await call("business", "POST", { ...f, tone: f.tone.trim().length >= 2 ? f.tone : "friendly, polite, concise", languages: me.business.languages?.length ? me.business.languages : ["am", "en"] }); setBusy(false);
      if (r.ok) { setSaved("✅ ተቀምጧል"); await reload(); } else setSaved("ስህተት ተፈጥሯል፤ እንደገና ሞክር።"); }}>
    <p className="font-display text-xl">የንግድህ መገለጫ</p>
    <p className="text-xs text-sage">እዚህ የምትቀይረው ረዳቱ ደንበኞችን ሲመልስ ወዲያው ይጠቀማል።</p>
    <label className="block text-sm font-semibold text-forest">የንግዱ ስም<input className="input mt-1 font-normal" required maxLength={120} value={f.name} onChange={(e) => set("name", e.target.value)} /></label>
    <label className="block text-sm font-semibold text-forest">የንግድ አይነት<input className="input mt-1 font-normal" maxLength={120} placeholder="ለምሳሌ፦ ኤሌክትሮኒክስ ሱቅ" value={f.business_type} onChange={(e) => set("business_type", e.target.value)} /></label>
    <label className="block text-sm font-semibold text-forest">የስራ ሰዓት<input className="input mt-1 font-normal" maxLength={300} placeholder="ሰኞ–ቅዳሜ 2:00–12:00" value={f.hours} onChange={(e) => set("hours", e.target.value)} /></label>
    <label className="block text-sm font-semibold text-forest">አድራሻ<input className="input mt-1 font-normal" maxLength={300} placeholder="ቦሌ መድኃኔዓለም" value={f.location} onChange={(e) => set("location", e.target.value)} /></label>
    <label className="block text-sm font-semibold text-forest">የአነጋገር ቃና<input className="input mt-1 font-normal" maxLength={300} placeholder="ለምሳሌ፦ ትህትና ያለው፣ አጭር" value={f.tone} onChange={(e) => set("tone", e.target.value)} /></label>
    {saved && <p className="text-sm font-semibold text-forest">{saved}</p>}
    <button className="btn btn-primary w-full" disabled={busy}>አስቀምጥ</button></form>);
}

function Leads({ call }: Pick<P, "call">) {
  type L = { id: string; title: string; done: boolean; who: string };
  const [ls, setLs] = useState<L[]>([]);
  const load = useCallback(() => { call("leads").then((r) => r.ok && setLs(r.data.leads)); }, [call]);
  useEffect(() => { load(); }, [load]);
  const open = ls.filter((l) => !l.done);
  if (!ls.length) return null;
  return (<div className="card space-y-2 p-4">
    <p className="text-sm font-semibold text-forest">📋 ትዕዛዝ እና ቀጠሮዎች {open.length > 0 && <span className="ml-1 rounded-full bg-gold-soft px-2 py-0.5 text-xs">{open.length} አዲስ</span>}</p>
    {ls.map((l) => <label key={l.id} className="flex items-start gap-3 rounded-2xl border border-sand p-3 text-sm">
      <input type="checkbox" checked={l.done} onChange={async (e) => { setLs((all) => all.map((x) => x.id === l.id ? { ...x, done: e.target.checked } : x)); await call("lead_done", "POST", { id: l.id, done: e.target.checked }); }} className="mt-1" />
      <span className={l.done ? "text-sage line-through" : ""}>{l.title}{l.who && <span className="block text-xs text-sage">{l.who}</span>}</span></label>)}
  </div>);
}

function Replies({ call, reload }: Pick<P, "call" | "reload">) {
  type R = { id: string; question: string; answer: string; kind: string | null };
  const [rs, setRs] = useState<R[]>([]); const [open, setOpen] = useState<string | null>(null); const [fix, setFix] = useState(""); const [done, setDone] = useState<Record<string, boolean>>({});
  useEffect(() => { call("replies").then((r) => r.ok && setRs(r.data.replies)); }, [call]);
  if (!rs.length) return null;
  return (<div className="card space-y-3 p-4">
    <p className="text-sm font-semibold text-forest">🛠 የረዳቱ የቅርብ መልሶች</p>
    <p className="text-xs text-sage">መልሱ ካልተመቸህ "አስተካክል" ን ጠቅ አድርገህ ትክክለኛውን ጻፍ፤ ረዳቱ ቀጣይ ጊዜ እንዲሁ ይመልሳል።</p>
    {rs.map((r) => <div key={r.id} className="rounded-2xl border border-sand p-3 text-sm">
      <p className="text-xs text-sage">ሲሉ፦ {r.question}</p><p className="mt-1">🤖 {r.answer}</p>
      {done[r.id] ? <p className="mt-2 text-xs font-semibold text-forest">✅ ተምሯል</p> : open === r.id ? (
        <form className="mt-2 space-y-2" onSubmit={async (e) => { e.preventDefault(); const x = await call("correct", "POST", { id: r.id, answer: fix }); if (x.ok) { setDone({ ...done, [r.id]: true }); setOpen(null); setFix(""); await reload(); } }}>
          <textarea className="input min-h-16" required maxLength={1000} placeholder="ትክክለኛው መልስ…" value={fix} onChange={(e) => setFix(e.target.value)} />
          <div className="flex gap-2"><button className="btn btn-gold flex-1">አስተምር</button><button type="button" className="btn flex-1" onClick={() => setOpen(null)}>ተው</button></div></form>
      ) : <button className="mt-2 rounded-full border border-sand px-3 py-1 text-xs font-semibold text-forest" onClick={() => { setOpen(r.id); setFix(""); }}>✏️ አስተካክል</button>}</div>)}
  </div>);
}

function PersonalTeach({ me, call, reload }: P) {
  const [aud, setAud] = useState<"friend" | "family">("friend"); const [q, setQ] = useState(""); const [a, setA] = useState(""); const [busy, setBusy] = useState(false);
  const items = (me.personal ?? []).filter((i) => i.kind === aud);
  return (<div className="space-y-2 border-t border-sand pt-3">
    <p className="text-sm font-semibold text-forest">🎓 አስተምረው፦ ሲሉ → እኔ የምመልሰው</p>
    <p className="text-xs text-sage">ጓደኛ ወይም ቤተሰብ አንድ ነገር ሲል እንዴት እንደምትመልስ ጻፍ፤ ረዳቱ በዚያው መንገድ ይመልሳል። ያልጻፍከውን ስለ አንተ አይፈጥርም።</p>
    <div className="flex gap-2">{([["friend", "🤝 ጓደኛ"], ["family", "👨‍👩‍👧 ቤተሰብ"]] as const).map(([k, l]) => <button key={k} onClick={() => setAud(k)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${aud === k ? "border-forest bg-forest text-ivory" : "border-sand text-forest"}`}>{l}</button>)}</div>
    {items.map((i) => <div key={i.id} className="flex items-start gap-3 rounded-2xl border border-sand p-3"><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{i.title}</p><p className="text-xs text-sage">→ {i.content}</p></div>
      <button aria-label="ሰርዝ" className="text-sage" onClick={async () => { await call(`knowledge?id=${i.id}`, "DELETE"); await reload(); }}>✕</button></div>)}
    <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); const r = await call("knowledge", "POST", { kind: aud, title: q, content: a }); setBusy(false); if (r.ok) { setQ(""); setA(""); await reload(); } }}>
      <input className="input" required maxLength={200} placeholder="ሲሉ፦ ለምሳሌ፦ ዛሬ ትገናኛለህ?" value={q} onChange={(e) => setQ(e.target.value)} />
      <textarea className="input min-h-16" required maxLength={500} placeholder="እኔ የምመልሰው፦ ለምሳሌ፦ ዛሬ ስራ ላይ ነኝ፣ ማታ እደውልልሃለሁ" value={a} onChange={(e) => setA(e.target.value)} />
      <button className="btn btn-gold w-full" disabled={busy}>+ አስተምር</button></form></div>);
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

function TestBox({ call, reload, onTested }: Pick<P, "call" | "reload"> & { onTested?: () => void }) {
  const [q, setQ] = useState(""); const [out, setOut] = useState<string>(""); const [busy, setBusy] = useState(false);
  return (<div className="card space-y-2 p-4"><p className="eyebrow">ሞክረኝ (አይላክም)</p>
    <div className="flex gap-2"><input className="input" placeholder="እንደ ደንበኛ ጻፍ፦ ዋጋው ስንት ነው?" value={q} onChange={(e) => setQ(e.target.value)} />
      <button className="btn btn-primary" disabled={busy || !q.trim()} onClick={async () => { setBusy(true); setOut(""); const r = await call("test", "POST", { message: q }); setBusy(false);
        if (r.ok) onTested?.(); const d = r.data?.decision; setOut(!r.ok ? (r.data?.error ?? "ስህተት") : d?.action === "send" ? d.reply : d?.reason === "ai_provider_error" || d?.reason === "ai_empty_response" ? "AI ለጊዜው አልመለሰም (ጭነት ወይም quota)። እንደገና ሞክር፤ ወይም ቀጥል ተጫን — ሙከራው ተቆጥሯል።" : `አያውቅም — ወደ አንተ ያስተላልፋል (${d?.reason})`); reload(); }}>ሞክር</button></div>
    {out && <p className="rounded-2xl bg-cream p-3 text-sm">{out}</p>}</div>);
}
