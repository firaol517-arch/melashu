-- Who is this chat? The AI only auto-replies to chats the owner classified as 'customer'.
alter table public.sec_conversations
  add column if not exists contact_kind text check (contact_kind in ('customer','friend','family','ignore')),
  add column if not exists classify_prompted_at timestamptz;
alter table public.sec_settings
  add column if not exists classify_new boolean not null default true;   -- unclassified chats get NO reply until the owner picks a category
