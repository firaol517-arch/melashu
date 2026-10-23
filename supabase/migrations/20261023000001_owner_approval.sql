-- The platform operator approves who may switch the assistant on.
alter table sec_owners add column if not exists approved boolean not null default false;
alter table sec_owners add column if not exists approved_at timestamptz;
-- Accounts already live before this migration keep working.
update sec_owners set approved = true, approved_at = now() where agreed_at is not null and approved = false;
