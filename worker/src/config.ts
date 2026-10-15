const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`Missing required env var ${k}`); return v; };
export const config = {
  supabaseUrl: need("SUPABASE_URL"),
  serviceKey: need("SUPABASE_SERVICE_ROLE_KEY"),
  encKey: need("SESSION_ENC_KEY"),
  openaiKey: process.env.OPENAI_API_KEY ?? "",
  port: Number(process.env.PORT ?? 8080),
  heartbeatMs: Number(process.env.HEARTBEAT_MS ?? 30_000),
  pollMs: Number(process.env.POLL_MS ?? 2_000),
};
