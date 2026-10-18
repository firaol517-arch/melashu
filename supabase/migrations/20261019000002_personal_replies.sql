-- Optional: let the assistant answer friends / family in a warm, non-committal personal tone. Off by default.
alter table public.sec_settings
  add column if not exists reply_to_friends boolean not null default false,
  add column if not exists reply_to_family boolean not null default false;
