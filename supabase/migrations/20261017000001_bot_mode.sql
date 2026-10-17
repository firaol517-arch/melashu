-- Bot mode: connect with a BotFather token (Bot API) instead of logging in as a personal account.
alter table sec_telegram_connections add column if not exists mode text not null default 'account' check (mode in ('account','bot'));
alter table sec_telegram_secrets add column if not exists bot_token_enc text;
alter table sec_telegram_auth_requests drop constraint if exists sec_telegram_auth_requests_action_check;
alter table sec_telegram_auth_requests add constraint sec_telegram_auth_requests_action_check
  check (action in ('send_code','verify_code','verify_password','disconnect','connect_bot'));
