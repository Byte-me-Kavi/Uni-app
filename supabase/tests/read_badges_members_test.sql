-- Read positions after sending, unread badges, group members and muting.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(13);

-- ---------------------------------------------------------------- fixtures
insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9701, 'Test Nu University', 'TNU', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('nu.test', 9701);

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
create function pg_temp.send(p_from uuid, p_conversation uuid, p_body text) returns timestamptz language plpgsql as $$
begin
  perform pg_temp.act_as(p_from);
  return (api.send_message(p_conversation, ops.uuid_v7(), p_body) ->> 'created_at')::timestamptz;
end $$;
create function pg_temp.unread(p_user uuid, p_conversation uuid) returns integer language plpgsql as $$
declare v integer;
begin
  perform pg_temp.act_as(p_user);
  select c.unread into v from api.my_chats() c where c.conversation_id = p_conversation;
  return v;
end $$;

select pg_temp.make_user('00000000-0000-0000-0000-0000000dd001', '2024ee001@nu.test', 'Asha Bandara');
select pg_temp.make_user('00000000-0000-0000-0000-0000000dd002', '2024ee002@nu.test', 'Chamath Wijesinghe');
select pg_temp.make_user('00000000-0000-0000-0000-0000000dd003', '2024ee003@nu.test', 'Zara Ismail');

select pg_temp.act_as('00000000-0000-0000-0000-0000000dd001');
select api.join_batch(null, 'BSc in Testing Arts', 2024);
select pg_temp.act_as('00000000-0000-0000-0000-0000000dd002');
select api.join_batch((select id from academics.programmes where institution_id = 9701), null, 2024);
select pg_temp.act_as('00000000-0000-0000-0000-0000000dd003');
select api.join_batch((select id from academics.programmes where institution_id = 9701), null, 2024);

select pg_temp.act_as('00000000-0000-0000-0000-0000000dd001');
create temp table ids as select
  (api.start_direct('00000000-0000-0000-0000-0000000dd002') ->> 'conversation_id')::uuid as dm,
  (select c.id from messaging.conversations c join academics.cohorts co on co.id = c.cohort_id
   join academics.programmes p on p.id = co.programme_id where p.institution_id = 9701) as batch_chat;
grant all on pg_temp.ids to public;

-- ---------------------------------------------------------------- replying reads the chat
select pg_temp.send('00000000-0000-0000-0000-0000000dd002', (select dm from ids), 'Are you at the lab?');
select is(pg_temp.unread('00000000-0000-0000-0000-0000000dd001', (select dm from ids)), 1, 'a new message is unread');
select pg_temp.send('00000000-0000-0000-0000-0000000dd001', (select dm from ids), 'Ow');
select is(pg_temp.unread('00000000-0000-0000-0000-0000000dd001', (select dm from ids)), 0,
  'replying reads everything before your reply');
select pg_temp.act_as('00000000-0000-0000-0000-0000000dd002');
select ok((select c.other_last_read_at from api.my_chats() c where c.conversation_id = (select dm from ids))
          >= (select min(created_at) from messaging.messages where conversation_id = (select dm from ids)),
  'the other student sees their message as read (✓✓) once you reply');
select is(pg_temp.unread('00000000-0000-0000-0000-0000000dd002', (select dm from ids)), 1, 'and your reply is unread for them');

-- ---------------------------------------------------------------- badge totals
select pg_temp.send('00000000-0000-0000-0000-0000000dd001', (select batch_chat from ids), 'Lecture cancelled');
select pg_temp.send('00000000-0000-0000-0000-0000000dd003', (select batch_chat from ids), 'Thanks');
select set_config('role', 'postgres', true);
select is(messaging.unread_total('00000000-0000-0000-0000-0000000dd002'), 3,
  'the badge counts unread messages across chats (1 direct, 2 group)');
update messaging.conversation_members set muted_until = 'infinity'
where user_id = '00000000-0000-0000-0000-0000000dd002' and conversation_id = (select batch_chat from ids);
select is(messaging.unread_total('00000000-0000-0000-0000-0000000dd002'), 1, 'muted chats do not count');
select is(messaging.unread_total('00000000-0000-0000-0000-0000000dd001'), 1, 'your own messages never count');

-- ---------------------------------------------------------------- members
select pg_temp.act_as('00000000-0000-0000-0000-0000000dd001');
select is((select array_agg(full_name order by full_name) from api.chat_members((select batch_chat from ids))),
  array['Asha Bandara', 'Chamath Wijesinghe', 'Zara Ismail'], 'a group lists its students by name');
select is((select array_agg(full_name) from api.chat_members((select batch_chat from ids), 'Asha Bandara',
           '00000000-0000-0000-0000-0000000dd001', 1)), array['Chamath Wijesinghe'], 'pages continue after the last name');
select api.block_user('00000000-0000-0000-0000-0000000dd003');
select is((select count(*)::int from api.chat_members((select batch_chat from ids))), 2, 'blocked students are left out');
select pg_temp.act_as('00000000-0000-0000-0000-0000000dd003');
select throws_ok($$ select * from api.chat_members((select dm from ids)) $$, '42501', null, 'only members see who is in a chat');

-- ---------------------------------------------------------------- muting
select pg_temp.act_as('00000000-0000-0000-0000-0000000dd001');
select is(api.set_muted((select batch_chat from ids), true), 'infinity'::timestamptz, 'mute until unmuted');
select is(api.set_muted((select batch_chat from ids), false), null, 'unmute');

select * from finish();
rollback;
