"use client";
import { useActionState } from "react";
import { completeOnboarding } from "./actions";

export default function Onboarding() {
  const [state, action, pending] = useActionState(completeOnboarding, null);
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <p className="eyebrow">Step 1 of 2 · Business setup</p>
      <h1 className="font-display mt-2 text-4xl">Tell your secretary about your business.</h1>
      <p className="mt-3 text-sage">This is what it uses to answer customers. You can edit everything later. Telegram is connected in the next step.</p>
      <form action={action} className="card mt-8 space-y-5 p-6">
        <label className="block text-sm font-medium">Business name
          <input name="name" required className="input mt-1" placeholder="Addis Electronics" /></label>
        <label className="block text-sm font-medium">What do you sell or do?
          <input name="business_type" className="input mt-1" placeholder="Electronics retail" /></label>
        <fieldset><legend className="text-sm font-medium">Languages customers use</legend>
          <div className="mt-2 flex gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="languages" value="am" defaultChecked /> አማርኛ</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="languages" value="en" defaultChecked /> English</label>
          </div></fieldset>
        <label className="block text-sm font-medium">Tone
          <input name="tone" required defaultValue="friendly, polite, concise" className="input mt-1" /></label>
        <label className="block text-sm font-medium">Business hours
          <input name="hours" className="input mt-1" placeholder="Mon–Sat 8:30–18:00" /></label>
        <div className="space-y-2 rounded-2xl bg-cream p-4">
          <p className="text-sm font-medium">First FAQ (optional)</p>
          <input name="faq_q" className="input" placeholder="Where are you located?" />
          <textarea name="faq_a" className="input" rows={3} placeholder="Answer, exactly as the AI may say it" />
        </div>
        {state?.error && <p role="alert" className="text-danger text-sm">{state.error}</p>}
        <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Saving…" : "Continue"}</button>
      </form>
    </main>
  );
}
