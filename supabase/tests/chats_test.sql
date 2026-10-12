-- Chats: default groups, direct messages and requests, sending, reading, Realtime permissions.
-- Run with: supabase test db

begin;
-- On a linked project the runner logs in as a temporary CLI role; run as postgres, as locally.
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(36);

-- ---------------------------------------------------------------- fixtures
insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9501, 'Test Kappa University', 'TKU', 'state', 'live'),
  (9502, 'Test Lambda University', 'TLU', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('kappa.test', 9501), ('lambda.test', 9502);

create function pg_temp.make_user(p_id uuid, p_email text, p_name text) returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, aud, role)
  values (p_id, p_email, jsonb_build_object('full_name', p_name), now(), 'authenticated', 'authenticated');
  update identity.profiles set account_status = 'active', name_confirmed_at = now() where user_id = p_id;
$$;
create function pg_temp.act_as(p_id uuid, p_email text default null) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'email', p_email)::text, true);
end $$;
-- A version 7 id, as the phone makes them.
create function pg_temp.v7() returns uuid language sql as $$ select ops.uuid_v7() $$;

select pg_temp.make_user('00000000-0000-0000-0000-0000000aa001', '2024cs001@kappa.test', 'Amara Silva');
select pg_temp.make_user('00000000-0000-0000-0000-0000000aa002', '2024cs002@kappa.test', 'Bimal Perera');
select pg_temp.make_user('00000000-0000-0000-0000-0000000bb001', '2024cs001@lambda.test', 'Dilan Fernando');
select pg_temp.make_user('00000000-0000-0000-0000-0000000bb002', '2024cs002@lambda.test', 'Eshan Nobody');
update identity.privacy_settings set who_can_message = 'nobody' where user_id = '00000000-0000-0000-0000-0000000bb002';

select pg_temp.act_as('00000000-0000-0000-0000-0000000aa001', '2024cs001@kappa.test');
select api.join_batch(null, 'BSc in Computer Science', 2024);
select pg_temp.act_as('00000000-0000-0000-0000-0000000aa002', '2024cs002@kappa.test');
select api.join_batch((select id from academics.programmes where institution_id = 9501), null, 2024);
select pg_temp.act_as('00000000-0000-0000-0000-0000000bb001', '2024cs001@lambda.test');
select api.join_batch(null, 'B.Sc. (Hons) in Computer Science', 2024);
select set_config('role', 'postgres', true);

create temp table ids as select
  (select c.id from messaging.conversations c join academics.cohorts co on co.id = c.cohort_id
   join academics.programmes p on p.id = co.programme_id where p.institution_id = 9501) as batch_chat,
  (select c.id from messaging.conversations c join academics.programmes p on p.field_id = c.field_id
   where p.institution_id = 9501) as programme_chat;
grant all on pg_temp.ids to public;

-- ---------------------------------------------------------------- national programme groups
select is(academics.field_name('BSc in Computer Science'), 'Computer Science', 'degree words are dropped');
select is(academics.field_name('B.Sc. (Hons) in Computer Science'), 'Computer Science', 'dotted degrees and (Hons) too');
select is(academics.field_name('BSc Eng in Computer Engineering'), 'Computer Engineering', 'engineering degrees');
select is(academics.field_name('bachelor of science in physical science'), 'Physical Science', 'long form, given capitals');
select is(academics.field_name('MBBS'), 'MBBS', 'a name that is only a degree stays');
select is((select title from messaging.conversations where id = (select programme_chat from ids)), 'Computer Science',
  'the programme group is named for the field');
select is((select member_count from messaging.conversations where id = (select programme_chat from ids)), 3,
  'students from both universities share one national programme group');
select is((select member_count from messaging.conversations where id = (select batch_chat from ids)), 2,
  'the batch group has only that university''s batch');

select pg_temp.act_as('00000000-0000-0000-0000-0000000aa001');
select is((select array_agg(kind order by kind) from api.my_chats()), array['cohort', 'programme'],
  'a new student''s chat list has their batch and programme groups');

-- ---------------------------------------------------------------- direct messages
select is(api.start_direct('00000000-0000-0000-0000-0000000aa002') ->> 'request_status', 'accepted',
  'a student at your university goes straight to chats');
select is(api.start_direct('00000000-0000-0000-0000-0000000aa002') ->> 'conversation_id',
  (select conversation_id::text from messaging.direct_conversations
   where user_low = '00000000-0000-0000-0000-0000000aa001' and user_high = '00000000-0000-0000-0000-0000000aa002'),
  'opening it again finds the same chat');
select is((select count(*)::int from api.my_chats() where kind = 'direct'), 0, 'an empty direct chat is not listed yet');

select pg_temp.act_as('00000000-0000-0000-0000-0000000bb001');
select throws_ok($$ select api.start_direct('00000000-0000-0000-0000-0000000aa001') $$, '42501', null,
  'my_institution (the default): another university cannot start a chat');
select throws_ok($$ select api.start_direct('00000000-0000-0000-0000-0000000bb002') $$, '42501', null,
  'nobody: no one can start a chat');

select set_config('role', 'postgres', true);
update identity.privacy_settings set who_can_message = 'everyone' where user_id = '00000000-0000-0000-0000-0000000aa001';
select pg_temp.act_as('00000000-0000-0000-0000-0000000bb001');
create temp table request as select (api.start_direct('00000000-0000-0000-0000-0000000aa001') ->> 'conversation_id')::uuid as id;
grant all on pg_temp.request to public;
select is((select request_status from messaging.direct_conversations where conversation_id = (select id from request)), 'pending',
  'everyone: a student from another university lands in requests');
select lives_ok($$ select api.send_message((select id from request), pg_temp.v7(), 'Hi! Are you doing the AI kuppi?') $$,
  'the request carries one message');
select throws_ok($$ select api.send_message((select id from request), pg_temp.v7(), 'Hello?') $$, '22023', null,
  'a second message waits until the request is accepted');

select pg_temp.act_as('00000000-0000-0000-0000-0000000aa001');
select is((select request from api.my_chats() where conversation_id = (select id from request)), 'incoming',
  'the recipient sees it as an incoming request');
select lives_ok($$ select api.send_message((select id from request), pg_temp.v7(), 'Yes, see you there') $$, 'replying works');
select is((select request_status from messaging.direct_conversations where conversation_id = (select id from request)), 'accepted',
  'replying accepts the request');

-- ---------------------------------------------------------------- sending
create temp table dm as select conversation_id as id from messaging.direct_conversations
  where user_low = '00000000-0000-0000-0000-0000000aa001' and user_high = '00000000-0000-0000-0000-0000000aa002';
create temp table msg as select pg_temp.v7() as id;
grant all on pg_temp.dm, pg_temp.msg to public;
select is(api.send_message((select id from dm), (select id from msg), 'Lab at 2?') ->> 'duplicate', 'false', 'a message is saved');
select is(api.send_message((select id from dm), (select id from msg), 'Lab at 2?') ->> 'duplicate', 'true',
  'sending the same id again (a retry) does not save it twice');
select lives_ok($$ select api.send_message((select id from dm), pg_temp.v7(), 'Bring the notes') $$, 'a second message');
select throws_ok($$ select api.send_message((select id from dm), gen_random_uuid(), 'x') $$, '22023', null, 'ids must be version 7');
select set_config('role', 'postgres', true);
select is((select count(*)::int from realtime.messages
           where topic = 'user:00000000-0000-0000-0000-0000000aa002' and event = 'message'), 2,
  'each direct message is broadcast to the recipient''s own channel');

select pg_temp.act_as('00000000-0000-0000-0000-0000000bb001');
select throws_ok($$ select api.send_message((select id from dm), pg_temp.v7(), 'sneaky') $$, '42501', null,
  'only members can post in a chat');

-- ---------------------------------------------------------------- reading
select pg_temp.act_as('00000000-0000-0000-0000-0000000aa002');
select is((select unread from api.my_chats() where conversation_id = (select id from dm)), 2, 'two unread messages');
select is((select array_agg(body) from api.chat_messages((select id from dm))), array['Bring the notes', 'Lab at 2?'],
  'history comes newest first');
select api.mark_read((select id from dm), clock_timestamp());
select is((select unread from api.my_chats() where conversation_id = (select id from dm)), 0, 'reading clears the count');

-- ---------------------------------------------------------------- Realtime channels
select pg_temp.act_as('00000000-0000-0000-0000-0000000aa001');
select is(messaging.can_use_topic('user:00000000-0000-0000-0000-0000000aa001', false), true, 'I can listen to my own channel');
select is(messaging.can_use_topic('user:00000000-0000-0000-0000-0000000aa002', false), false, 'but not to someone else''s');
select is(messaging.can_use_topic('typing:' || (select id from dm), true), true, 'typing is allowed in my direct chat (on its own channel)');
select is(messaging.can_use_topic('typing:' || (select programme_chat from ids), true), false, 'but not in groups (direct chats only)');
select is(messaging.can_use_topic('chat:' || (select id from request), false), true, 'I can listen to a chat I am in');

-- ---------------------------------------------------------------- limits and leaving
select set_config('role', 'postgres', true);
insert into safety.blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-0000000aa002', '00000000-0000-0000-0000-0000000aa001');
select pg_temp.act_as('00000000-0000-0000-0000-0000000aa001');
select throws_ok($$ select api.send_message((select id from dm), pg_temp.v7(), 'hello?') $$, '42501', null,
  'a blocked student cannot send');

select set_config('role', 'postgres', true);
delete from academics.cohort_members where user_id = '00000000-0000-0000-0000-0000000bb001';
select is((select member_count from messaging.conversations where id = (select programme_chat from ids)), 2,
  'leaving a batch leaves its programme group');

select * from finish();
rollback;
