-- Push notifications: tokens, who is notified, the group throttle, previews.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(17);

-- ---------------------------------------------------------------- fixtures
insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9601, 'Test Mu University', 'TMU', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('mu.test', 9601);

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
create function pg_temp.send(p_from uuid, p_conversation uuid, p_body text) returns jsonb language plpgsql as $$
declare v_id uuid := ops.uuid_v7(); v_at timestamptz;
begin
  perform pg_temp.act_as(p_from);
  v_at := (api.send_message(p_conversation, v_id, p_body) ->> 'created_at')::timestamptz;
  perform set_config('role', 'service_role', true);
  return api.push_batch(v_id, v_at);
end $$;

select pg_temp.make_user('00000000-0000-0000-0000-0000000cc001', '2024it001@mu.test', 'Nimal Jayasuriya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000cc002', '2024it002@mu.test', 'Ruwan Dias');
select pg_temp.make_user('00000000-0000-0000-0000-0000000cc003', '2024it003@mu.test', 'Sunil Gamage');

select pg_temp.act_as('00000000-0000-0000-0000-0000000cc001');
select api.join_batch(null, 'BSc in Testology', 2024);
select pg_temp.act_as('00000000-0000-0000-0000-0000000cc002');
select api.join_batch((select id from academics.programmes where institution_id = 9601), null, 2024);
select pg_temp.act_as('00000000-0000-0000-0000-0000000cc003');
select api.join_batch((select id from academics.programmes where institution_id = 9601), null, 2024);
select set_config('role', 'postgres', true);

create temp table ids as select
  (select c.id from messaging.conversations c join academics.cohorts co on co.id = c.cohort_id
   join academics.programmes p on p.id = co.programme_id where p.institution_id = 9601) as batch_chat;
grant all on pg_temp.ids to public;

-- ---------------------------------------------------------------- tokens
select pg_temp.act_as('00000000-0000-0000-0000-0000000cc002');
select throws_ok($$ select api.register_push_token('not-a-token', 'android') $$, '22023', null, 'only Expo push tokens are accepted');
select lives_ok($$ select api.register_push_token('ExponentPushToken[ruwan-phone]', 'android') $$, 'a student registers their phone');
select pg_temp.act_as('00000000-0000-0000-0000-0000000cc003');
select lives_ok($$ select api.register_push_token('ExponentPushToken[sunil-phone]', 'ios') $$, 'another student registers theirs');
select throws_ok($$ select * from messaging.push_tokens $$, '42501', null, 'students cannot read the token table');
select throws_ok($$ select api.push_batch(ops.uuid_v7(), now()) $$, '42501', null, 'students cannot build notifications');

-- ---------------------------------------------------------------- groups
select is(jsonb_array_length(pg_temp.send('00000000-0000-0000-0000-0000000cc001', (select batch_chat from ids), 'Lab is moved to 2pm')), 2,
  'a group message notifies both batchmates with phones');
select is((pg_temp.send('00000000-0000-0000-0000-0000000cc001', (select batch_chat from ids), 'Room B2')), '[]'::jsonb,
  'the next message within 15 minutes does not buzz them again');

select set_config('role', 'postgres', true);
update messaging.conversation_members set last_read_at = now()
where user_id = '00000000-0000-0000-0000-0000000cc002' and conversation_id = (select batch_chat from ids);
select is((select jsonb_agg(n ->> 'to') from jsonb_array_elements(
    pg_temp.send('00000000-0000-0000-0000-0000000cc001', (select batch_chat from ids), 'See you there')) n),
  '["ExponentPushToken[ruwan-phone]"]'::jsonb, 'after reading the chat, the next message notifies again');

select set_config('role', 'postgres', true);
update messaging.conversation_members set notified_at = null where conversation_id = (select batch_chat from ids);
update messaging.conversation_members set muted_until = now() + interval '1 day'
where user_id = '00000000-0000-0000-0000-0000000cc003' and conversation_id = (select batch_chat from ids);
select is(jsonb_array_length(pg_temp.send('00000000-0000-0000-0000-0000000cc001', (select batch_chat from ids), 'Muted test')), 1,
  'a muted chat is silent');

select set_config('role', 'postgres', true);
update messaging.conversation_members set notified_at = null, muted_until = null where conversation_id = (select batch_chat from ids);
select is((select n from jsonb_array_elements(pg_temp.send('00000000-0000-0000-0000-0000000cc001', (select batch_chat from ids), 'Hello all')) n
           where n ->> 'to' = 'ExponentPushToken[ruwan-phone]') ->> 'body', 'Nimal: Hello all',
  'a group notification starts with the sender''s first name');
select set_config('role', 'postgres', true);
update messaging.conversation_members set notified_at = null where conversation_id = (select batch_chat from ids);
select is(jsonb_array_length(pg_temp.send('00000000-0000-0000-0000-0000000cc002', (select batch_chat from ids), 'Thanks')), 1,
  'the sender is never notified about their own message (Nimal has no phone, Sunil does)');

-- ---------------------------------------------------------------- direct chats and blocks
select pg_temp.act_as('00000000-0000-0000-0000-0000000cc001');
create temp table dm as select (api.start_direct('00000000-0000-0000-0000-0000000cc002') ->> 'conversation_id')::uuid as id;
grant all on pg_temp.dm to public;
select is((pg_temp.send('00000000-0000-0000-0000-0000000cc001', (select id from dm), 'Hi Ruwan') -> 0) ->> 'title', 'Nimal Jayasuriya',
  'a direct message is titled with the sender''s name');
select is(jsonb_array_length(pg_temp.send('00000000-0000-0000-0000-0000000cc001', (select id from dm), 'Are you coming?')), 1,
  'every direct message notifies');

select pg_temp.act_as('00000000-0000-0000-0000-0000000cc002');
select api.set_message_previews(false);
select is((pg_temp.send('00000000-0000-0000-0000-0000000cc001', (select id from dm), 'Secret plan') -> 0) ->> 'body', 'New message',
  'with previews off the text stays off the lock screen');

select pg_temp.act_as('00000000-0000-0000-0000-0000000cc002');
select api.block_user('00000000-0000-0000-0000-0000000cc001');
select set_config('role', 'postgres', true);
update messaging.conversation_members set notified_at = null where conversation_id = (select batch_chat from ids);
select is((select jsonb_agg(n ->> 'to') from jsonb_array_elements(
    pg_temp.send('00000000-0000-0000-0000-0000000cc001', (select batch_chat from ids), 'Anyone?')) n),
  '["ExponentPushToken[sunil-phone]"]'::jsonb, 'a student who blocked the sender is not notified in groups');

-- ---------------------------------------------------------------- sign out, uninstall
select pg_temp.act_as('00000000-0000-0000-0000-0000000cc003');
select api.unregister_push_token('ExponentPushToken[sunil-phone]');
select set_config('role', 'postgres', true);
select is((select count(*)::int from messaging.push_tokens where user_id = '00000000-0000-0000-0000-0000000cc003'), 0,
  'signing out removes the phone');
select set_config('role', 'service_role', true);
select api.drop_push_tokens(array['ExponentPushToken[ruwan-phone]']);
select set_config('role', 'postgres', true);
select is((select count(*)::int from messaging.push_tokens where user_id = '00000000-0000-0000-0000-0000000cc002'), 0,
  'tokens of uninstalled apps are dropped');

select * from finish();
rollback;
