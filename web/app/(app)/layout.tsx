import { Suspense } from "react";
import { requireBusiness } from "@/lib/session";
import Nav from "@/components/Nav";
import Tour from "@/components/Tour";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, business } = await requireBusiness();
  const { data: s } = await supabase.from("sec_settings").select("automation_enabled,dry_run,emergency_stop").eq("business_id", business.id).maybeSingle();
  const state = s?.emergency_stop ? { t: "Stopped", c: "text-danger" } : !s?.automation_enabled ? { t: "Paused", c: "text-sage" }
    : s.dry_run ? { t: "Dry-run", c: "text-gold" } : { t: "Live", c: "text-leaf" };
  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-5 pb-32">
      <header className="flex items-center justify-between border-b border-line py-4">
        <h1 className="font-display text-2xl font-medium">{business.name}</h1>
        <span className={`rounded-full border border-line bg-white px-4 py-1.5 text-sm font-semibold ${state.c}`}>● {state.t}</span>
      </header>
      <main className="pt-6">{children}</main>
      <Suspense><Tour businessName={business.name} /></Suspense>
      <Nav />
    </div>
  );
}
