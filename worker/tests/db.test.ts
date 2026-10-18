import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222";
let db: PGlite; let bizA: string, bizB: string, convA: string, custA: string;
const as = async (uid: string | null, sql: string, params: any[] = []) => {
  await db.exec(`set role ${uid ? "authenticated" : "anon"}; select set_config('request.jwt.claim.sub','${uid ?? ""}',false)`);
  try { return await db.query(sql, params); } finally { await db.exec("reset role"); }
};

beforeAll(async () => {
  db = new PGlite();
  // Minimal Supabase auth stub
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    insert into auth.users values ('${A}'),('${B}');`);
  await db.exec(readFileSync(new URL("../../supabase/migrations/20261014000001_secretary_core.sql", import.meta.url), "utf8"));
  for (const m of ["20261017000001_bot_mode.sql", "20261018000001_platform_bot.sql", "20261019000001_contact_kind.sql", "20261019000002_personal_replies.sql", "20261019000003_learn_style.sql", "20261019000004_auto_classify.sql"])
    await db.exec(readFileSync(new URL(`../../supabase/migrations/${m}`, import.meta.url), "utf8"));
  bizA = (await db.query<any>(`insert into sec_businesses(owner_id,name) values ('${A}','A Shop') returning id`)).rows[0].id;
  bizB = (await db.query<any>(`insert into sec_businesses(owner_id,name) values ('${B}','B Shop') returning id`)).rows[0].id;
  await db.exec(`insert into sec_settings(business_id) values ('${bizA}'),('${bizB}'); insert into sec_telegram_connections(business_id) values ('${bizA}');`);
  custA = (await db.query<any>(`insert into sec_customers(business_id,tg_user_id,display_name) values ('${bizA}',1,'Abebe') returning id`)).rows[0].id;
  convA = (await db.query<any>(`insert into sec_conversations(business_id,customer_id,tg_chat_id) values ('${bizA}','${custA}',1) returning id`)).rows[0].id;
  await db.exec(`insert into sec_telegram_secrets(business_id,session_enc) values ('${bizA}','v1.secret.secret.secret')`);
});

describe("migration + safe defaults", () => {
  it("creates settings with automation OFF and dry-run ON", async () => {
    const r = (await db.query<any>(`select automation_enabled,dry_run,emergency_stop,reply_to_unknown_private,reply_to_groups from sec_settings where business_id='${bizA}'`)).rows[0];
    expect(r).toEqual({ automation_enabled: false, dry_run: true, emergency_stop: false, reply_to_unknown_private: false, reply_to_groups: false });
  });
});

describe("row-level security / permissions", () => {
  it("owner sees own business data only", async () => {
    expect((await as(A, "select id from sec_conversations")).rows).toHaveLength(1);
    expect((await as(B, "select id from sec_conversations")).rows).toHaveLength(0);
    expect((await as(B, "select id from sec_customers")).rows).toHaveLength(0);
    expect((await as(B, "select id from sec_businesses")).rows.map((r: any) => r.id)).toEqual([bizB]);
  });
  it("anonymous users see nothing (empty or denied)", async () => {
    const rows = await as(null, "select id from sec_businesses").then((r) => r.rows, () => []);
    expect(rows).toHaveLength(0);
  });
  it("another user cannot modify my conversation", async () => {
    await as(B, `update sec_conversations set ai_paused=true where id='${convA}'`);
    expect((await db.query<any>(`select ai_paused from sec_conversations where id='${convA}'`)).rows[0].ai_paused).toBe(false);
  });
  it("owner CAN pause own conversation", async () => {
    await as(A, `update sec_conversations set ai_paused=true where id='${convA}'`);
    expect((await db.query<any>(`select ai_paused from sec_conversations where id='${convA}'`)).rows[0].ai_paused).toBe(true);
  });
  it("Telegram session secrets are unreachable from the browser", async () => {
    await expect(as(A, "select session_enc from sec_telegram_secrets")).rejects.toThrow();
    await expect(as(null, "select * from sec_telegram_secrets")).rejects.toThrow();
  });
  it("auth-request payloads cannot be read by users", async () => {
    await expect(as(A, "select payload_enc from sec_telegram_auth_requests")).rejects.toThrow();
  });
  it("users cannot forge messages, logs, connection state or settings", async () => {
    await expect(as(A, `insert into sec_messages(business_id,conversation_id,direction,sender,body,status) values ('${bizA}','${convA}','out','ai','x','sent')`)).rejects.toThrow();
    await expect(as(A, `insert into sec_activity_logs(business_id,actor,event) values ('${bizA}','worker','fake')`)).rejects.toThrow();
    await expect(as(A, `update sec_telegram_connections set status='connected' where business_id='${bizA}'`)).rejects.toThrow();
    await expect(as(A, `update sec_settings set automation_enabled=true, dry_run=false where business_id='${bizA}'`)).rejects.toThrow();
  });
  it("users cannot rewrite protected conversation/customer columns", async () => {
    await expect(as(A, `update sec_conversations set tg_chat_id=999 where id='${convA}'`)).rejects.toThrow();
    await expect(as(A, `update sec_customers set tg_user_id=999 where id='${custA}'`)).rejects.toThrow();
  });
  it("cannot create a business owned by someone else", async () => {
    await expect(as(B, `insert into sec_businesses(owner_id,name) values ('${A}','hijack')`)).rejects.toThrow();
  });
});

describe("deduplication + never-reply-twice", () => {
  it("rejects a duplicate Telegram message id in the same conversation", async () => {
    await db.exec(`insert into sec_messages(business_id,conversation_id,tg_message_id,direction,sender,body) values ('${bizA}','${convA}',100,'in','customer','hi')`);
    await expect(db.exec(`insert into sec_messages(business_id,conversation_id,tg_message_id,direction,sender,body) values ('${bizA}','${convA}',100,'in','customer','hi')`)).rejects.toThrow(/unique|duplicate/i);
  });
  it("allows only one outgoing reply per incoming message", async () => {
    const inc = (await db.query<any>(`select id from sec_messages where tg_message_id=100`)).rows[0].id;
    await db.exec(`insert into sec_messages(business_id,conversation_id,direction,sender,body,status,reply_to_message_id) values ('${bizA}','${convA}','out','ai','a','dry_run','${inc}')`);
    await expect(db.exec(`insert into sec_messages(business_id,conversation_id,direction,sender,body,status,reply_to_message_id) values ('${bizA}','${convA}','out','ai','b','sending','${inc}')`)).rejects.toThrow(/unique|duplicate/i);
  });
  it("a failed reply can be retried (failed rows don't block)", async () => {
    const inc = (await db.query<any>(`insert into sec_messages(business_id,conversation_id,tg_message_id,direction,sender,body) values ('${bizA}','${convA}',101,'in','customer','q') returning id`)).rows[0].id;
    await db.exec(`insert into sec_messages(business_id,conversation_id,direction,sender,body,status,reply_to_message_id) values ('${bizA}','${convA}','out','ai','a','failed','${inc}')`);
    await db.exec(`insert into sec_messages(business_id,conversation_id,direction,sender,body,status,reply_to_message_id) values ('${bizA}','${convA}','out','ai','a2','sent','${inc}')`);
  });
  it("persists across queries (database persistence)", async () => {
    expect(Number((await db.query<any>(`select count(*)::int c from sec_messages where conversation_id='${convA}'`)).rows[0].c)).toBeGreaterThanOrEqual(4);
  });
});

describe("platform tables (Mini App owners / business connections)", () => {
  it("are not readable or writable by authenticated or anonymous users", async () => {
    for (const t of ["sec_owners", "sec_business_connections"])
      for (const uid of [A, null]) await expect(as(uid, `select * from ${t}`)).rejects.toThrow();
  });
  it("a business may be owned by a Telegram user instead of an auth user, but must have one owner", async () => {
    await db.exec(`insert into sec_businesses(tg_owner_id,name) values (777,'TG Shop')`);
    await expect(db.exec(`insert into sec_businesses(name) values ('Ownerless')`)).rejects.toThrow();
    await expect(db.exec(`insert into sec_businesses(tg_owner_id,name) values (777,'Dup')`)).rejects.toThrow();
  });
  it("a normal signed-in user cannot read a Telegram-owned business", async () => {
    const r = await as(A, `select name from sec_businesses where name='TG Shop'`); expect(r.rows.length).toBe(0);
  });
});

