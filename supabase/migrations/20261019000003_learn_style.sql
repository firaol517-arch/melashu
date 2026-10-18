alter table public.sec_settings add column if not exists learn_style boolean not null default true;  -- use the owner's own past replies as tone examples
