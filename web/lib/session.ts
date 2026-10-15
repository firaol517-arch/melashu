import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export type Business = {
  id: string; name: string; business_type: string; languages: string[]; timezone: string;
  business_hours: Record<string, string>; tone: string; onboarding_completed: boolean; tour_completed: boolean;
};

export async function requireUser() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

/** Returns the signed-in user's business, or redirects to onboarding. */
export async function requireBusiness() {
  const { supabase, user } = await requireUser();
  const { data } = await supabase.from("sec_businesses").select("*").eq("owner_id", user.id).maybeSingle();
  if (!data || !data.onboarding_completed) redirect("/onboarding");
  return { supabase, user, business: data as Business };
}

/** For API routes: resolves user + business id or returns null. */
export async function apiBusiness() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("sec_businesses").select("id").eq("owner_id", user.id).maybeSingle();
  return data ? { supabase, user, businessId: data.id as string } : null;
}
