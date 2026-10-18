alter table public.sec_settings add column if not exists auto_classify boolean not null default true;  -- AI guesses customer/friend/family for new chats (owner can correct)
