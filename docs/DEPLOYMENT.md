# Deployment

Two deployables share one Supabase database:

| Part | Host | Why |
|---|---|---|
| `web/` Next.js app | **Vercel** | UI + API routes (short-lived functions) |
| `worker/` Telegram worker | **Render** (or Fly.io / Railway / any VPS) | Needs a *persistent* process to hold the MTProto connection. Vercel serverless functions cannot. |

## 1. Database (Supabase)
1. Apply `supabase/migrations/20261014000001_secretary_core.sql` (Supabase SQL editor, or `supabase db push`).
   All objects are prefixed `sec_` so they do not collide with other apps in the same project.
2. Auth → Providers: keep Email enabled. Optionally disable "Confirm email" while testing.
3. Verify in the SQL editor: `select relname, relrowsecurity from pg_class where relname like 'sec_%' and relkind='r';` → every row should be `true`.

## 2. Secrets
Generate one encryption key and use the **same value** in web and worker:
```
openssl rand -base64 32
```
Never commit `.env` files. Templates: `web/.env.example`, `worker/.env.example`.

## 3. Web on Vercel
- Root directory: `web`. Framework: Next.js. Build command `next build`.
- Environment variables: everything in `web/.env.example`. Only `NEXT_PUBLIC_*` values are exposed to browsers.
  `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_ENC_KEY`, `AI_API_KEY` are server-only.
  AI provider: any OpenAI-compatible API. Default Gemini (free key at https://aistudio.google.com/apikey) with `AI_BASE_URL`, `AI_MODEL` as in `.env.example`.
  **Privacy:** Google's free tier may use content to improve products and allows human review. For real customer data use a paid/billed key or another provider.
- After deploy open `https://<your-app>/api/health` → expect `{"ok":true,...}` (HTTP 503 and a list of what is missing otherwise).

## 4. Worker on Render
- New → Blueprint → select this repo (uses `render.yaml`), or create a Docker worker with root dir `worker`.
- Use a plan that never sleeps. A sleeping worker means no replies.
- Set the env vars from `worker/.env.example` (same `SESSION_ENC_KEY` and AI settings as the web app).
- Health: `GET /healthz` (port 8080) returns 200 while the polling loop is alive. Logs: Render dashboard → Logs
  (message text, phone numbers, codes and sessions are never logged).
- Run **one** worker instance only for a given Telegram account.

## 5. Connect Telegram
1. Open `my.telegram.org` → *API development tools* → create an app → note **API ID** and **API hash**.
2. In the app: Settings → Telegram connection. Enter API ID, hash, phone → enter the code Telegram sends → enter your
   2-step password if asked. Diagnostics show worker/Telegram status live.
3. Disconnect at any time from the same screen. This logs the session out at Telegram and wipes it from the database.
   If the worker is offline, also remove the session in Telegram → Settings → Devices.

## 6. Go live
Follow `docs/LAUNCH_CHECKLIST.md`. The server refuses to enable live replies until it is satisfied.

## Operations
- **Emergency stop**: AI Secretary → Emergency stop (takes effect on the next incoming message, and re-checked right before every send).
- **Rotating `SESSION_ENC_KEY`** invalidates stored sessions: disconnect and reconnect Telegram afterwards.
- **Backups**: use Supabase backups. Messages contain customer data; treat exports accordingly.

## Platform mode (Mini App + Telegram Business)

One shared bot serves many businesses. Owners open the bot → Mini App (`/tg`) → answer onboarding questions → agree →
connect via **Telegram → Settings → Telegram Business → Chatbots** (requires the owner to have Telegram Premium).
Customer messages arrive as `business_message` updates and are answered *as the owner*.

1. @BotFather → your bot → **Bot Settings → Business Mode → Enable**. (The Mini App menu button is set automatically by the worker.)
2. Set `PLATFORM_BOT_TOKEN` on **both** Render (worker) and Vercel (web, used to verify Mini App logins). Optionally `PLATFORM_BOT_USERNAME` on Vercel.
3. Only ONE process may poll a bot token. If this bot was previously connected in "single-business bot mode" (Settings → Telegram), disconnect it first.
4. Redeploy. Worker logs `platform bot running`; message the bot `/start`.
