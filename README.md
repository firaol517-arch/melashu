# AI Secretary SaaS (MiniMe-style, own brand)

Premium mobile-first dashboard + always-on Telegram worker that answers eligible customer chats from your own account
using your business knowledge. Product name is configurable via `NEXT_PUBLIC_APP_NAME`.

```
web/       Next.js 15 (Vercel): auth, onboarding, dashboard, chats, customers, secretary, knowledge, follow-ups, analytics, settings
worker/    Node + gramjs (Render/VPS): MTProto login, listener, AI pipeline, outbox, heartbeat, /healthz
shared/    ai-core.ts — eligibility, retrieval, validation (copied to web+worker: `node scripts/sync-shared.mjs`)
supabase/  migrations (RLS on every table, least-privilege grants)
docs/      DEPLOYMENT.md, LAUNCH_CHECKLIST.md
```

**MTProto vs Bot API:** a bot only talks to people who open the bot. This app signs in to *your own* Telegram account via
Telegram's official client protocol, so it can answer messages sent to you. Use only accounts you own/are authorized to manage.

## Safety model (defaults)
Automation OFF · dry-run ON · only allow-listed private chats · no groups/channels/contacts · never replies to own messages ·
one reply per incoming message (DB-enforced) · "sent" only after Telegram returns a message id · numbers/links not in the
knowledge base are blocked · quiet hours, hourly cap, per-chat pause/manual takeover, global pause, emergency stop.

## Develop
```
cd web    && cp .env.example .env.local && npm i && npm run dev
cd worker && cp .env.example .env && npm i && npm run dev
npm test  # in worker/: unit + migration/RLS tests (in-process Postgres)
```
