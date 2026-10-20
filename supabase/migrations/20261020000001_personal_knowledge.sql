-- Things the owner teaches the assistant for friend / family chats ("when they say X, I answer Y").
alter table sec_knowledge drop constraint if exists sec_knowledge_kind_check;
alter table sec_knowledge add constraint sec_knowledge_kind_check
  check (kind in ('faq','product','service','price','hours','policy','document','friend','family'));
