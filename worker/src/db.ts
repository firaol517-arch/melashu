import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
export const db = createClient(config.supabaseUrl, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
export const audit = (business_id: string, event: string, detail: Record<string, unknown> = {}) =>
  db.from("sec_activity_logs").insert({ business_id, actor: "worker", event, detail }).then(() => {}, () => {});
