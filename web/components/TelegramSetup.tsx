"use client";
import { useEffect, useState } from "react";
import { api } from "./ui";

type Status = { connection: { status: string; mode?: string; phone_hint: string | null; tg_username: string | null; last_error: string | null; last_heartbeat_at: string | null } | null;
  lastRequest: { action: string; status: string; error: string | null } | null; workerOnline: boolean };

export default function TelegramSetup() {
  const [st, setSt] = useState<Status | null>(null);
  const [f, setF] = useState({ api_id: "", api_hash: "", phone: "" });
  const [mode, setMode] = useState<"bot" | "account">("bot"); const [token, setToken] = useState("");
  const [code, setCode] = useState(""); const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  const load = async () => { const r = await api("/api/telegram/status", "GET"); if (r.ok) setSt(r.data); };
  useEffect(() => { load(); const i = setInterval(load, 2500); return () => clearInterval(i); }, []);

  const status = st?.connection?.status ?? "disconnected";
  async function call(path: string, body?: unknown) {
    setBusy(true); setMsg(null);
    const r = await api(path, "POST", body); setBusy(false);
    if (!r.ok) setMsg({ ok: false, t: r.data?.error ?? "Something went wrong" }); else { setMsg({ ok: true, t: "Sent. Waiting for the worker…" }); load(); }
    return r;
  }
  const failed = st?.lastRequest?.status === "failed" ? st.lastRequest.error : null;

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <p className="eyebrow">Connection diagnostics</p>
        <ul className="mt-3 space-y-2 text-sm">
          <li>Worker: <b className={st?.workerOnline ? "text-leaf" : "text-danger"}>{st?.workerOnline ? "online" : "offline or not deployed"}</b></li>
          <li>Telegram: <b>{status.replace("_", " ")}</b>{st?.connection?.tg_username ? ` · @${st.connection.tg_username}` : ""}</li>
          {(st?.connection?.last_error || failed) && <li className="text-danger">Last error: {failed ?? st?.connection?.last_error}</li>}
        </ul>
        {!st?.workerOnline && <p className="mt-3 text-sm text-sage">The worker is the always-on service that holds your Telegram login. Deploy it first (see docs/DEPLOYMENT.md); sign-in steps below need it.</p>}
      </section>

      <section className="card space-y-2 p-6 text-sm">
        <p className="font-semibold">How this works</p>
        <p className="text-sage">This signs in to <b>your own Telegram account</b> using Telegram's official MTProto client login (the same login Telegram apps use). It is different from the <b>Bot API</b>: a bot only answers people who message the bot, while this lets your secretary answer messages sent to <i>you</i>. Only use an account you own or are authorized to manage. Your session is encrypted on the server and never shown here.</p>
        <p className="text-sage">Get your API ID and hash at <b>my.telegram.org → API development tools</b>. Never share them or your login code with anyone else.</p>
      </section>

      {["disconnected", "revoked", "error"].includes(status) && (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={`btn ${mode === "bot" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("bot")}>Telegram bot (easy)</button>
          <button type="button" className={`btn ${mode === "account" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("account")}>My own account</button>
        </div>
      )}
      {["disconnected", "revoked", "error"].includes(status) && mode === "bot" && (
        <form className="card space-y-4 p-6" onSubmit={(e) => { e.preventDefault(); call("/api/telegram/bot", { token }); setToken(""); }}>
          <p className="font-semibold">Connect your Telegram bot</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-sage">
            <li>In Telegram open <b>@BotFather</b> → send <code>/newbot</code> → choose a name and a username ending in <code>bot</code>.</li>
            <li>BotFather replies with a <b>token</b> (like <code>123456789:AA…</code>). Paste it below — only here, never in chats.</li>
            <li>Customers must press <b>Start</b> / message your bot first (Telegram rule). Share the bot link (t.me/yourbot).</li>
          </ol>
          <input className="input" type="password" placeholder="Bot token from BotFather" required autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
          <button className="btn btn-primary w-full" disabled={busy}>Connect bot</button>
        </form>
      )}
      {["disconnected", "revoked", "error"].includes(status) && mode === "account" && (
        <form className="card space-y-4 p-6" onSubmit={(e) => { e.preventDefault(); call("/api/telegram/start", { api_id: f.api_id, api_hash: f.api_hash, phone: f.phone }); }}>
          <p className="font-semibold">1 · Enter your Telegram API details</p>
          <input className="input" inputMode="numeric" placeholder="API ID" required value={f.api_id} onChange={(e) => setF({ ...f, api_id: e.target.value })} />
          <input className="input" placeholder="API hash (32 characters)" required autoComplete="off" value={f.api_hash} onChange={(e) => setF({ ...f, api_hash: e.target.value })} />
          <input className="input" placeholder="+2519XXXXXXXX" required autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <button className="btn btn-primary w-full" disabled={busy}>Send login code</button>
        </form>
      )}
      {status === "connecting" && (
        <div className="card space-y-3 p-6 text-sm">
          <p>Connecting to Telegram… (if this takes more than a minute, the worker may be asleep or offline)</p>
          <button className="btn btn-ghost" disabled={busy} onClick={() => call("/api/telegram/disconnect")}>Cancel and start over</button>
        </div>
      )}
      {status === "awaiting_code" && (
        <form className="card space-y-4 p-6" onSubmit={(e) => { e.preventDefault(); call("/api/telegram/code", { code }); setCode(""); }}>
          <p className="font-semibold">2 · Enter the code Telegram sent you</p>
          <p className="text-sm text-sage">Check your Telegram app (a message from “Telegram”) for the numeric code{st?.connection?.phone_hint ? ` for ${st.connection.phone_hint}` : ""}.</p>
          <input className="input" inputMode="numeric" autoComplete="one-time-code" placeholder="12345" required value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn btn-primary w-full" disabled={busy}>Verify code</button>
        </form>
      )}
      {status === "awaiting_password" && (
        <form className="card space-y-4 p-6" onSubmit={(e) => { e.preventDefault(); call("/api/telegram/password", { password: pw }); setPw(""); }}>
          <p className="font-semibold">3 · Two-step verification password</p>
          <input className="input" type="password" autoComplete="off" required value={pw} onChange={(e) => setPw(e.target.value)} />
          <button className="btn btn-primary w-full" disabled={busy}>Verify password</button>
        </form>
      )}
      {status === "connected" && (
        <section className="card space-y-3 p-6">
          <p className="font-semibold text-leaf">Connected{st?.connection?.tg_username ? ` as @${st.connection.tg_username}` : ""}{st?.connection?.mode === "bot" ? " (bot)" : ""}.</p>
          <p className="text-sm text-sage">Nothing is auto-replied until you finish the launch checklist in AI Secretary. New chats are NOT auto-answered unless you allow-list them.</p>
          <button className="btn btn-ghost !border-danger text-danger" disabled={busy} onClick={() => confirm("Disconnect and revoke this Telegram session?") && call("/api/telegram/disconnect")}>Disconnect</button>
        </section>
      )}
      {msg && <p role="status" className={`text-sm ${msg.ok ? "text-leaf" : "text-danger"}`}>{msg.t}</p>}
    </div>
  );
}
