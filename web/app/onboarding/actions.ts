"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  business_type: z.string().trim().max(120),
  languages: z.array(z.enum(["am", "en"])).min(1),
  tone: z.string().trim().min(2).max(300),
  hours: z.string().trim().max(300),
  faq_q: z.string().trim().max(200).optional(),
  faq_a: z.string().trim().max(2000).optional(),
});

export async function completeOnboarding(_: unknown, form: FormData) {
  const { user } = await requireUser();
  const parsed = schema.safeParse({
    name: form.get("name"), business_type: form.get("business_type"),
    languages: form.getAll("languages"), tone: form.get("tone"), hours: form.get("hours"),
    faq_q: form.get("faq_q") || undefined, faq_a: form.get("faq_a") || undefined,
  });
  if (!parsed.success) return { error: "Please fill in the business name, at least one language, and a tone." };
  const v = parsed.data;
  const admin = supabaseAdmin();

  const { data: existing } = await admin.from("sec_businesses").select("id").eq("owner_id", user.id).maybeSingle();
  let id = existing?.id as string | undefined;
  if (id) {
    await admin.from("sec_businesses").update({ name: v.name, business_type: v.business_type, languages: v.languages,
      tone: v.tone, business_hours: { text: v.hours }, onboarding_completed: true }).eq("id", id);
  } else {
    const { data, error } = await admin.from("sec_businesses").insert({ owner_id: user.id, name: v.name,
      business_type: v.business_type, languages: v.languages, tone: v.tone, business_hours: { text: v.hours },
      onboarding_completed: true }).select("id").single();
    if (error || !data) return { error: "Could not create your business. Please try again." };
    id = data.id;
    await admin.from("sec_settings").insert({ business_id: id });          // safe defaults: automation OFF, dry-run ON
    await admin.from("sec_telegram_connections").insert({ business_id: id });
  }
  if (v.hours) await admin.from("sec_knowledge").insert({ business_id: id, kind: "hours", title: "Business hours", content: v.hours });
  if (v.faq_q && v.faq_a) await admin.from("sec_knowledge").insert({ business_id: id, kind: "faq", title: v.faq_q, content: v.faq_a });
  await admin.from("sec_activity_logs").insert({ business_id: id, actor: "user", event: "onboarding.completed" });
  redirect("/");
}
