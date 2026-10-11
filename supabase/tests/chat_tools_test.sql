-- Chat tools: reporting, reps and group admins, chat settings, own groups, list pins and archive,
-- quiet hours.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(41);

-- ---------------------------------------------------------------- fixtures
insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9821, 'Test Sigma University', 'TSU', 'state', 'live'),
  (9822, 'Test Tau University', 'TTU', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('sigma.test', 9821), ('tau.test', 9822);

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
create function pg_temp.say(p_conversation uuid, p_body text) returns uuid language sql as $$
  select (api.send_message(p_conversation, ops.uuid_v7(), p_body) ->> 'id')::uuid;
$$;

-- a1, a2, a3: Sigma batch. mod: Sigma moderator (also in the batch). t1: Tau student.
select pg_temp.make_user('00000000-0000-0000-0000-00000000c101', '2024ct001@sigma.test', 'Anjana Perera');
select pg_temp.make_user('00000000-0000-0000-0000-00000000c102', '2024ct002@sigma.test', 'Binara Silva');
select pg_temp.make_user('00000000-0000-0000-0000-00000000c103', '2024ct003@sigma.test', 'Chathu Dias');
select pg_temp.make_user('00000000-0000-0000-0000-00000000c104', '2024ct004@sigma.test', 'Dasun Mod');
select pg_temp.make_user('00000000-0000-0000-0000-00000000c201', '2024ct001@tau.test', 'Tharu Gunawardena');
insert into identity.staff_roles (user_id, role, institution_id) values ('00000000-0000-0000-0000-00000000c104', 'moderator', 9821);

select pg_temp.act_as('00000000-0000-0000-0000-00000000c101');
select api.join_batch(null, 'BSc in Tools Studies', 2024);
select pg_temp.act_as('00000000-0000-0000-0000-00000000c102');
select api.join_batch((select id from academics.programmes where institution_id = 9821), null, 2024);
select pg_temp.act_as('00000000-0000-0000-0000-00000000c103');
select api.join_batch((select id from academics.programmes where institution_id = 9821), null, 2024);
select pg_temp.act_as('00000000-0000-0000-0000-00000000c104');
select api.join_batch((select id from academics.programmes where institution_id = 9821), null, 2024);
select set_config('role', 'postgres', true);

create temp table ids (batch uuid, msg uuid, own uuid, report uuid, grp uuid, grp2 uuid);
insert into ids (batch) select c.id from messaging.conversations c join academics.cohorts co on co.id = c.cohort_id
  join academics.programmes p on p.id = co.programme_id where p.institution_id = 9821;
grant all on pg_temp.ids to public;

-- ---------------------------------------------------------------- reporting
select pg_temp.act_as('00000000-0000-0000-0000-00000000c102');
update ids set msg = pg_temp.say((select batch from ids), 'before');
update ids set msg = pg_temp.say((select batch from ids), 'the bad one');
select pg_temp.say((select batch from ids), 'after');
select pg_temp.act_as('00000000-0000-0000-0000-00000000c101');
update ids set own = pg_temp.say((select batch from ids), 'mine');

update ids set report = api.report('message', (select msg from ids)::text, 'harassment', 'Not okay', (select batch from ids));
select isnt((select report from ids), null, 'a member can report a message');
select is(api.report('message', (select msg from ids)::text, 'harassment', null, (select batch from ids)), (select report from ids),
  'reporting the same thing again is the same report');
select throws_ok($$ select api.report('message', (select own from ids)::text, 'spam', null, (select batch from ids)) $$,
  '22023', null, 'your own message cannot be reported');
select throws_ok($$ select api.report('message', (select msg from ids)::text, 'not_a_category', null, (select batch from ids)) $$,
  '22023', null, 'the category must be a real one');
select ok((select count(*) from api.report_categories()) >= 10, 'the categories are listed');
select ok(api.report('profile', '00000000-0000-0000-0000-00000000c102', 'impersonation') is not null, 'a student can be reported');

select set_config('role', 'postgres', true);
select is((select r.snapshot -> 'message' ->> 'body' from safety.reports r where r.id = (select report from ids)), 'the bad one',
  'the report keeps a copy of the message');
select ok((select jsonb_array_length(r.snapshot -> 'context') from safety.reports r where r.id = (select report from ids)) >= 2,
  'and the messages around it');
select is((select r.institution_id from safety.reports r where r.id = (select report from ids)), 9821::bigint,
  'it goes to the moderators of the sender''s university');

select pg_temp.act_as('00000000-0000-0000-0000-00000000c201');
select throws_ok($$ select api.report('message', (select msg from ids)::text, 'spam', null, (select batch from ids)) $$,
  'P0002', null, 'someone outside the chat cannot report its messages');

-- ---------------------------------------------------------------- reps
select pg_temp.act_as('00000000-0000-0000-0000-00000000c101');
select throws_ok($$ select api.set_member_role((select batch from ids), '00000000-0000-0000-0000-00000000c101', 'admin') $$,
  '42501', null, 'students cannot make themselves reps');
select throws_ok($$ select api.update_chat_settings((select batch from ids), 30) $$,
  '42501', null, 'members cannot change chat settings');
select is((api.chat_settings((select batch from ids)) ->> 'can_appoint')::boolean, false, 'members are not offered appointing');

select pg_temp.act_as('00000000-0000-0000-0000-00000000c104');
select is((api.chat_settings((select batch from ids)) ->> 'can_appoint')::boolean, true, 'the university''s moderator can appoint reps');
select lives_ok($$ select api.set_member_role((select batch from ids), '00000000-0000-0000-0000-00000000c101', 'admin') $$,
  'the moderator makes a student a rep');
select set_config('role', 'postgres', true);
select is((select count(*)::int from ops.audit_log a where a.action = 'chat.set_role' and a.target_id = (select batch from ids)::text), 1,
  'appointing a rep is audited');

select pg_temp.act_as('00000000-0000-0000-0000-00000000c101');
select is((api.chat_settings((select batch from ids)) ->> 'can_manage')::boolean, true, 'the rep can manage the batch chat');
select is((api.update_chat_settings((select batch from ids), 30, true) ->> 'announcement_only')::boolean, true,
  'the rep turns on announcement-only and slow mode');

select pg_temp.act_as('00000000-0000-0000-0000-00000000c102');
select throws_ok($$ select pg_temp.say((select batch from ids), 'can I talk?') $$, '42501', null, 'members cannot send in announcement-only');
select throws_ok($$ select api.pin_message((select batch from ids), (select msg from ids)) $$, '42501', null, 'members cannot pin in groups');
select pg_temp.act_as('00000000-0000-0000-0000-00000000c101');
select lives_ok($$ select pg_temp.say((select batch from ids), 'Exam moved to Friday') $$, 'the rep can still send');
select lives_ok($$ select pg_temp.say((select batch from ids), 'And bring your ID') $$, 'slow mode does not hold reps back');
select lives_ok($$ select api.pin_message((select batch from ids), (select msg from ids)) $$, 'the rep can pin');
select throws_ok($$ select api.update_chat_settings((select batch from ids), null, null, 'New name') $$,
  '22023', null, 'batch chats cannot be renamed');

-- ---------------------------------------------------------------- own groups
select pg_temp.act_as('00000000-0000-0000-0000-00000000c101');
select api.block_user('00000000-0000-0000-0000-00000000c103');
update ids set grp = (api.create_group('Lab group 4', array[
  '00000000-0000-0000-0000-00000000c102',  -- same university: added
  '00000000-0000-0000-0000-00000000c103',  -- blocked: skipped
  '00000000-0000-0000-0000-00000000c201'   -- other university, no accepted chat: skipped
]::uuid[]) ->> 'conversation_id')::uuid;
select set_config('role', 'postgres', true);
select is((select member_count from messaging.conversations where id = (select grp from ids)), 2,
  'a new group has its creator and the students who may be added');
select is((select role from messaging.conversation_members where conversation_id = (select grp from ids)
  and user_id = '00000000-0000-0000-0000-00000000c101'), 'admin', 'the creator is its admin');
select is((select kind from messaging.conversations where id = (select grp from ids)), 'group', 'it is a group');

select pg_temp.act_as('00000000-0000-0000-0000-00000000c102');
select ok(exists (select 1 from api.my_chats() where conversation_id = (select grp from ids)), 'an added student sees the group at once');
select throws_ok($$ select api.add_group_members((select grp from ids), array['00000000-0000-0000-0000-00000000c104']::uuid[]) $$,
  '42501', null, 'only admins add people');
select pg_temp.act_as('00000000-0000-0000-0000-00000000c101');
select is(jsonb_array_length(api.add_group_members((select grp from ids), array['00000000-0000-0000-0000-00000000c104']::uuid[]) -> 'added'), 1,
  'the admin adds a classmate');
select lives_ok($$ select api.update_chat_settings((select grp from ids), null, null, 'Lab group 4 (Tue)') $$, 'the admin renames the group');
select lives_ok($$ select api.remove_group_member((select grp from ids), '00000000-0000-0000-0000-00000000c104') $$, 'the admin removes someone');
select lives_ok($$ select api.leave_group((select grp from ids)) $$, 'the admin leaves');
select set_config('role', 'postgres', true);
select is((select role from messaging.conversation_members where conversation_id = (select grp from ids)
  and user_id = '00000000-0000-0000-0000-00000000c102'), 'admin', 'the remaining member becomes admin');
select throws_ok($$ select api.leave_group((select batch from ids)) $$, '22023', null, 'batch chats are not left this way');

-- ---------------------------------------------------------------- list pins and archive
select pg_temp.act_as('00000000-0000-0000-0000-00000000c102');
update ids set grp2 = (api.create_group('Study circle', array['00000000-0000-0000-0000-00000000c104']::uuid[]) ->> 'conversation_id')::uuid;
select api.set_chat_state((select batch from ids), true);
select api.set_chat_state((select grp from ids), true);
select api.set_chat_state((select grp2 from ids), true);
select is((select count(*)::int from api.my_chats() where list_pinned_at is not null), 3, 'three chats can be pinned');
select lives_ok($$ select api.set_chat_state((select grp2 from ids), null, true) $$, 'a chat can be archived');
select is((select archived::text || ',' || (list_pinned_at is null)::text from api.my_chats() where conversation_id = (select grp2 from ids)),
  'true,true', 'archiving also unpins it');
select is((select conversation_id from api.my_chats() limit 1) in ((select batch from ids), (select grp from ids)), true,
  'pinned chats come first');

-- ---------------------------------------------------------------- quiet hours
select pg_temp.act_as('00000000-0000-0000-0000-00000000c102');
select api.set_quiet_hours(true,
  ((extract(hour from now() at time zone 'Asia/Colombo') * 60 + extract(minute from now() at time zone 'Asia/Colombo'))::int + 1439) % 1440,
  ((extract(hour from now() at time zone 'Asia/Colombo') * 60 + extract(minute from now() at time zone 'Asia/Colombo'))::int + 2) % 1440);
select set_config('role', 'postgres', true);
insert into messaging.push_tokens (user_id, token, platform) values ('00000000-0000-0000-0000-00000000c102', 'ExponentPushToken[quiet-test]', 'android');
select is(messaging.in_quiet_hours('00000000-0000-0000-0000-00000000c102'), true, 'quiet hours are on right now');
select ok(not exists (select 1 from messaging.push_recipients((select grp from ids), '00000000-0000-0000-0000-00000000c104',
  array['00000000-0000-0000-0000-00000000c102']::uuid[])), 'nobody is notified during their quiet hours, even when mentioned');

select * from finish();
rollback;
