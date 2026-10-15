"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const appName = process.env.NEXT_PUBLIC_APP_NAME || "Tsehafi AI";

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const sb = supabaseBrowser();
    const { data, error } = mode === "in"
      ? await sb.auth.signInWithPassword({ email, password })
      : await sb.auth.signUp({ email, password });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: /invalid api key/i.test(error.message) ? "Server setup problem: the public Supabase key is wrong or outdated. Open /api/health for the exact cause." : error.message });
    if (mode === "up" && !data.session) return setMsg({ ok: true, text: "Check your email to confirm your account, then sign in." });
    router.replace("/"); router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <p className="eyebrow">{appName}</p>
      <h1 className="font-display mt-2 text-4xl leading-tight">{mode === "in" ? "Welcome back." : "Create your account."}</h1>
      <p className="mt-3 text-sage">Your AI secretary for Telegram customer conversations.</p>
      <form onSubmit={submit} className="card mt-8 space-y-4 p-6">
        <label className="block text-sm font-medium">Email
          <input className="input mt-1" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="block text-sm font-medium">Password
          <input className="input mt-1" type="password" required minLength={8} autoComplete={mode === "in" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {msg && <p role="status" className={msg.ok ? "text-leaf text-sm" : "text-danger text-sm"}>{msg.text}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Please wait…" : mode === "in" ? "Sign in" : "Sign up"}</button>
      </form>
      <button className="mt-4 text-sm text-sage underline" onClick={() => { setMode(mode === "in" ? "up" : "in"); setMsg(null); }}>
        {mode === "in" ? "New here? Create an account" : "Already have an account? Sign in"}
      </button>
    </main>
  );
}
