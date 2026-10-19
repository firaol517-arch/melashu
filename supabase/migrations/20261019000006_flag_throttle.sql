alter table public.sec_conversations add column if not exists last_flag_notified_at timestamptz;  -- throttle repeated 'needs your attention' DMs per chat
