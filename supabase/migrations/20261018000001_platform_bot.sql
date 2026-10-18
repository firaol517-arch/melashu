-- Platform mode: one shared Telegram bot + Mini App; many businesses; owners connect via Telegram Business (Chatbots).
alter table sec_businesses alter column owner_id drop not null;
alter table sec_businesses add column if not exists tg_owner_id bigint;
create unique index if not exists sec_businesses_tg_owner_idx on sec_businesses(tg_owner_id) where tg_owner_id is not null;
alter table sec_businesses add constraint sec_businesses_has_owner check (owner_id is not null or tg_owner_id is not null);

-- Telegram users who opened the bot (owners). Service-role only.
create table if not exists sec_owners (
  tg_user_id bigint primary key,
  business_id uuid references sec_businesses(id) on delete set null,
  bot_chat_id bigint,                -- private chat with the platform bot (for alerts)
  first_name text, username text, language_code text,
  agreed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table sec_owners enable row level security;

-- Telegram Business connections (owner added the bot under Settings → Business → Chatbots).
create table if not exists sec_business_connections (
  bc_id text primary key,            -- business_connection_id
  business_id uuid not null references sec_businesses(id) on delete cascade,
  tg_user_id bigint not null,
  can_reply boolean not null default false,
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
create index if not exists sec_bc_business_idx on sec_business_connections(business_id);
alter table sec_business_connections enable row level security;

alter table sec_telegram_connections drop constraint if exists sec_telegram_connections_mode_check;
alter table sec_telegram_connections add constraint sec_telegram_connections_mode_check check (mode in ('account','bot','business'));

revoke all on sec_owners, sec_business_connections from anon, authenticated;
