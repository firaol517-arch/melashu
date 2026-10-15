"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const steps = [
  { t: "Your whole shop, one tap away", d: "Home, Chats, Secretary, Progress and Settings live in the bar below." },
  { t: "Start in dry-run", d: "Your secretary drafts replies without sending anything until you pass the launch checklist." },
  { t: "You stay in control", d: "Pause everything, pause one chat, or take over manually at any time." },
];

export default function Tour({ businessName }: { businessName: string }) {
  const params = useSearchParams();
  const [i, setI] = useState<number | null>(null);
  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem("tour_done") === "1"; } catch {}
    if (params.get("tour") === "1" || !seen) setI(0);
  }, [params]);
  const close = () => { try { localStorage.setItem("tour_done", "1"); } catch {} setI(null); };
  if (i === null) return null;
  const s = steps[i];
  return (
    <div role="dialog" aria-modal="true" aria-label="Quick tour" className="fixed inset-0 z-50 grid place-items-end bg-forest/60 p-4 sm:place-items-center">
      <div className="w-full max-w-sm rounded-[28px] bg-cream p-6 shadow-2xl">
        <p className="eyebrow">{i === 0 ? `Welcome, ${businessName}` : "Quick tour"}</p>
        <h2 className="font-display mt-2 text-2xl">{s.t}</h2>
        <p className="mt-2 text-sage">{s.d}</p>
        <div className="mt-6 flex items-center justify-between">
          <span className="text-sm text-sage">{i + 1} of {steps.length}</span>
          <div className="flex gap-2">
            <button className="btn btn-ghost" onClick={close}>Skip</button>
            <button className="btn btn-primary" onClick={() => (i + 1 < steps.length ? setI(i + 1) : close())}>{i + 1 < steps.length ? "Next" : "Got it"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
