-- AI Secretary SaaS core schema. All objects are prefixed sec_ so they never
-- collide with other apps sharing this Supabase project.


-- ───────────── helpers ─────────────
create or replace function sec_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ───────────── businesses ─────────────
create table if not exists sec_businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  business_type text not null default '',
  languages text[] not null default array['am','en'],
  timezone text not null default 'Africa/Addis_Ababa',
  business_hours jsonb not null default '{}'::jsonb,
  tone text not null default 'friendly, polite, concise',
  onboarding_completed boolean not null default false,
  tour_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sec_businesses_owner_idx on sec_businesses(owner_id);
create trigger sec_businesses_touch before update on sec_businesses
  for each row execute function sec_touch();

create or replace function sec_owns(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from sec_businesses where id = b and owner_id = auth.uid());
$$;

-- ───────────── automation settings (safe defaults) ─────────────
create table if not exists sec_settings (
  business_id uuid primary key references sec_businesses(id) on delete cascade,
  automation_enabled boolean not null default false,   -- live replies OFF by default
  dry_run boolean not null default true,               -- generate, never send
  emergency_stop boolean not null default false,
  quiet_hours_enabled boolean not null default false,
  quiet_start time not null default '22:00',
  quiet_end time not null default '07:00',
  reply_to_unknown_private boolean not null default false, -- only allow-listed chats unless true
  reply_to_groups boolean not null default false,
  reply_to_contacts boolean not null default false,
  language_mode text not null default 'match' check (language_mode in ('match','am','en')),
  response_rules text not null default '',
  ai_provider text not null default 'openai',
  ai_model text not null default 'gpt-4o-mini',
  max_replies_per_hour int not null default 30 check (max_replies_per_hour between 1 and 300),
  reply_delay_seconds int not null default 4 check (reply_delay_seconds between 0 and 120),
  launch_checklist jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create trigger sec_settings_touch before update on sec_settings
  for each row execute function sec_touch();

-- ───────────── telegram connection ─────────────
create table if not exists sec_telegram_connections (
  business_id uuid primary key references sec_businesses(id) on delete cascade,
  status text not null default 'disconnected'
    check (status in ('disconnected','awaiting_code','awaiting_password','connecting','connected','error','revoked')),
  phone_hint text,                 -- e.g. +2519****12 (masked)
  tg_user_id bigint,
  tg_username text,
  last_error text,
  last_heartbeat_at timestamptz,
  connected_at timestamptz,
  updated_at timestamptz not null default now()
);
create trigger sec_tgconn_touch before update on sec_telegram_connections
  for each row execute function sec_touch();

-- Secrets: RLS on, NO policies => unreachable from browser/anon/authenticated.
-- Only the service-role key (web server routes + worker) can read/write.
create table if not exists sec_telegram_secrets (
  business_id uuid primary key references sec_businesses(id) on delete cascade,
  api_id_enc text,
  api_hash_enc text,
  session_enc text,
  updated_at timestamptz not null default now()
);
alter table sec_telegram_secrets enable row level security;

-- Login handshake queue (web -> worker). Payload is AES-GCM encrypted, cleared once processed.
create table if not exists sec_telegram_auth_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references sec_businesses(id) on delete cascade,
  action text not null check (action in ('send_code','verify_code','verify_password','disconnect')),
  payload_enc text,
  status text not null default 'pending' check (status in ('pending','processing','done','failed')),
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists sec_auth_req_pending_idx on sec_telegram_auth_requests(status, created_at);
alter table sec_telegram_auth_requests enable row level security;
create policy sec_auth_req_select on sec_telegram_auth_requests
  for select using (sec_owns(business_id));   -- owner may see status, not the payload (column revoked below)
revoke select (payload_enc) on sec_telegram_auth_requests from authenticated, anon;

-- ───────────── customers / conversations / messages ─────────────
create table if not exists sec_customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references sec_businesses(id) on delete cascade,
  tg_user_id bigint not null,
  display_name text not null default '',
  username text,
  interests text[] not null default '{}',
  notes text not null default '',
  is_contact boolean not null default false,
  is_blocked boolean not null default false,
  first_contact_at timestamptz not null default now(),
  last_contact_at timestamptz,
  followup_status text not null default 'none' check (followup_status in ('none','pending','done')),
  unique (business_id, tg_user_id)
);
create index if not exists sec_customers_biz_idx on sec_customers(business_id, last_contact_at desc);

create table if not exists sec_conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references sec_businesses(id) on delete cascade,
  customer_id uuid not null references sec_customers(id) on delete cascade,
  tg_chat_id bigint not null,
  tg_access_hash text,                         -- needed to address the peer after a worker restart
  chat_kind text not null default 'private' check (chat_kind in ('private','group','channel')),
  auto_reply_allowed boolean not null default false,  -- per-conversation allow-list
  ai_paused boolean not null default false,
  manual_takeover boolean not null default false,
  sensitive boolean not null default false,
  needs_attention boolean not null default false,
  attention_reason text,
  unread_count int not null default 0,
  last_message_at timestamptz,
  last_message_preview text,
  unique (business_id, tg_chat_id)
);
create index if not exists sec_conv_biz_idx on sec_conversations(business_id, last_message_at desc);

create table if not exists sec_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references sec_businesses(id) on delete cascade,
  conversation_id uuid not null references sec_conversations(id) on delete cascade,
  tg_message_id bigint,                      -- null until Telegram confirms an outgoing send
  direction text not null check (direction in ('in','out')),
  sender text not null check (sender in ('customer','ai','owner')),
  body text not null default '',
  status text not null default 'received'
    check (status in ('received','queued','sending','dry_run','sent','failed')),
  reply_to_message_id uuid references sec_messages(id) on delete set null,
  ai_meta jsonb,                            -- confidence, language, sources (no secrets)
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
-- Message deduplication: one row per Telegram message per conversation.
create unique index if not exists sec_messages_tg_uniq
  on sec_messages(conversation_id, tg_message_id) where tg_message_id is not null;
-- Never reply twice: at most one AI/owner outgoing message per incoming message.
create unique index if not exists sec_messages_one_reply
  on sec_messages(reply_to_message_id) where reply_to_message_id is not null and direction = 'out' and status <> 'failed';
create index if not exists sec_messages_conv_idx on sec_messages(conversation_id, created_at);

-- Manual composer outbox: owner's message is saved as 'queued'; worker sends and confirms.
-- (Queued rows are simply sec_messages with sender='owner', status='queued'.)

-- ───────────── knowledge / follow-ups / logs ─────────────
create table if not exists sec_knowledge (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references sec_businesses(id) on delete cascade,
  kind text not null check (kind in ('faq','product','service','price','hours','policy','document')),
  title text not null check (char_length(title) between 1 and 200),
  content text not null check (char_length(content) <= 8000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(content,''))) stored
);
create index if not exists sec_knowledge_search_idx on sec_knowledge using gin(search);
create trigger sec_knowledge_touch before update on sec_knowledge
  for each row execute function sec_touch();

create table if not exists sec_followups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references sec_businesses(id) on delete cascade,
  customer_id uuid references sec_customers(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  due_at timestamptz,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists sec_activity_logs (
  id bigint generated always as identity primary key,
  business_id uuid references sec_businesses(id) on delete cascade,
  actor text not null,                       -- 'user' | 'worker' | 'system'
  event text not null,
  detail jsonb not null default '{}'::jsonb, -- never message bodies or secrets
  created_at timestamptz not null default now()
);
create index if not exists sec_logs_biz_idx on sec_activity_logs(business_id, created_at desc);

-- ───────────── Row Level Security ─────────────
alter table sec_businesses enable row level security;
create policy sec_biz_all on sec_businesses for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['sec_settings','sec_telegram_connections','sec_customers','sec_conversations',
                           'sec_messages','sec_knowledge','sec_followups']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all using (sec_owns(business_id)) with check (sec_owns(business_id))',
                   t || '_owner', t);
  end loop;
end $$;

alter table sec_activity_logs enable row level security;
create policy sec_logs_select on sec_activity_logs for select using (sec_owns(business_id));

-- ───────────── Least-privilege grants ─────────────
-- Browser clients (role authenticated) may read their data but may NOT forge
-- Telegram state, message status, logs or secrets. Writes that must be trusted
-- (sending, queueing, connection state) go through server routes / the worker
-- using the service-role key.
revoke all on sec_telegram_secrets, sec_telegram_auth_requests from anon, authenticated;
grant select (id, business_id, action, status, error, created_at, processed_at)
  on sec_telegram_auth_requests to authenticated;

revoke insert, update, delete on sec_activity_logs, sec_telegram_connections, sec_messages from authenticated, anon;

-- conversations: owner may only flip control flags
revoke insert, update, delete on sec_conversations from authenticated, anon;
grant update (auto_reply_allowed, ai_paused, manual_takeover, sensitive, needs_attention, attention_reason, unread_count)
  on sec_conversations to authenticated;

-- customers: owner may only edit CRM fields
revoke insert, update, delete on sec_customers from authenticated, anon;
grant update (notes, interests, followup_status, is_blocked) on sec_customers to authenticated;

-- settings: read-only from the browser. Changes go through /api/settings so that going live
-- is gated by the launch checklist and emergency stop is always honoured.
revoke insert, update, delete on sec_settings from authenticated, anon;

-- ───────────── function hardening ─────────────
alter function sec_touch() set search_path = public;
revoke execute on function sec_owns(uuid) from public, anon;
grant execute on function sec_owns(uuid) to authenticated;
