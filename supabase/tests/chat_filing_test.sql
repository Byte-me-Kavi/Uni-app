-- Filing from chats: choosing a module while sending (before and after the message is saved), who
-- may, and the folder tags the chat screen shows (including blocked files).
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(10);

insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9871, 'Test Sigma Two University', 'TS2', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('sigma2.test', 9871);

create function pg_temp.make_user(p_id uuid, p_email text, p_name text) returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, aud, role)
  values (p_id, p_email, jsonb_build_object('full_name', p_name), now(), 'authenticated', 'authenticated');
  update identity.profiles set account_status = 'active', name_confirmed_at = now() where user_id = p_id;
$$;
create function pg_temp.act_as(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.mod(p_code text) returns bigint language sql as $$
  select id from academics.modules where institution_id = 9871 and code_key = p_code;
$$;
create function pg_temp.send_file(p_conversation uuid, p_id uuid, p_name text) returns uuid language plpgsql as $$
declare
  v_path text := 'chat/' || p_conversation || '/' || gen_random_uuid() || '.pdf';
  v_uid uuid := (current_setting('request.jwt.claims')::jsonb ->> 'sub')::uuid;
begin
  perform set_config('role', 'postgres', true);
  insert into messaging.uploads (path, user_id, conversation_id, kind, mime, size) values (v_path, v_uid, p_conversation, 'file', 'application/pdf', 1000);
  perform set_config('role', 'authenticated', true);
  return (api.send_message(p_conversation, p_id, '', null, 'file', jsonb_build_object('path', v_path, 'name', p_name)) ->> 'id')::uuid;
end $$;
create function pg_temp.folder_of(p_conversation uuid, p_message uuid) returns jsonb language sql as $$
  select x from jsonb_array_elements(api.chat_folders(p_conversation, array[p_message])) x;
$$;

select pg_temp.make_user('00000000-0000-0000-0000-0000000ac101', '2025ff001@sigma2.test', 'Fathima One');
select pg_temp.make_user('00000000-0000-0000-0000-0000000ac102', '2025ff002@sigma2.test', 'Fazal Two');
select pg_temp.make_user('00000000-0000-0000-0000-0000000ac103', '2024gg001@sigma2.test', 'Gihan Other');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ac101');
select api.join_batch(null, 'BSc in Filing Studies', 2025);
select api.set_batch_term(1, 1);
select api.save_semester(1, 1, '[{"code": "CS2012", "name": "Data Structures"}, {"code": "MA1013", "name": "Calculus"}]');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ac102');
select api.join_batch((select id from academics.programmes where institution_id = 9871), null, 2025);
select api.set_batch_term(1, 1);
select pg_temp.act_as('00000000-0000-0000-0000-0000000ac103');
select api.join_batch(null, 'BSc in Other Filing', 2024);
select set_config('role', 'postgres', true);

create temp table ids (batch uuid, early uuid, late uuid, plain uuid, coded uuid);
insert into ids default values;
grant all on pg_temp.ids to public;
update ids set batch = (select c.id from messaging.conversations c join academics.cohort_members m on m.cohort_id = c.cohort_id
                        where m.user_id = '00000000-0000-0000-0000-0000000ac101'),
  early = ops.uuid_v7(), late = ops.uuid_v7(), plain = ops.uuid_v7(), coded = ops.uuid_v7();

-- Chosen while sending: recorded before the message exists, applied when it is saved.
select pg_temp.act_as('00000000-0000-0000-0000-0000000ac101');
select lives_ok($$ select api.tag_message((select batch from ids), (select early from ids), pg_temp.mod('MA1013'), 'notes') $$,
  'a module can be chosen before the message is saved');
select pg_temp.send_file((select batch from ids), (select early from ids), 'week 3.pdf');
select pg_temp.send_file((select batch from ids), (select late from ids), 'week 4.pdf');
select pg_temp.send_file((select batch from ids), (select plain from ids), 'random.pdf');
select pg_temp.send_file((select batch from ids), (select coded from ids), 'CS2012 Lec 2.pdf');
select lives_ok($$ select api.tag_message((select batch from ids), (select late from ids), pg_temp.mod('MA1013')) $$,
  'or after it is saved');

select pg_temp.act_as('00000000-0000-0000-0000-0000000ac102');
select is(pg_temp.folder_of((select batch from ids), (select early from ids)) ->> 'code', 'MA1013',
  'batchmates find it in the chosen module');
select is(pg_temp.folder_of((select batch from ids), (select early from ids)) ->> 'category', 'notes', 'and folder');
select is(pg_temp.folder_of((select batch from ids), (select late from ids)) ->> 'code', 'MA1013', 'a later choice applies too');
select is(pg_temp.folder_of((select batch from ids), (select coded from ids)) ->> 'code', 'CS2012', 'coded files show their module');
select is(pg_temp.folder_of((select batch from ids), (select plain from ids)), null, 'files in To sort show no folder tag');
select throws_ok($$ select api.tag_message((select batch from ids), (select plain from ids), pg_temp.mod('CS2012')) $$, '42501', null,
  'only the sender files while sending');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ac103');
select throws_ok($$ select api.chat_folders((select batch from ids), array[(select coded from ids)]) $$, '42501', null,
  'outsiders cannot look into a chat');

select set_config('role', 'postgres', true);
select api.chat_file_checked((select coded from ids), false, 'This PDF runs scripts.');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ac102');
select is(pg_temp.folder_of((select batch from ids), (select coded from ids)) ->> 'reason', 'This PDF runs scripts.',
  'a blocked file says why in the chat');

select * from finish();
rollback;
