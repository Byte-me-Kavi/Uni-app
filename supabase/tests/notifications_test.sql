-- Notifications outside chats: kuppi (new in your module, answered requests, cancelled, starting
-- soon), exam dates (set or moved, the evening before), shared files (checked, comments, replies)
-- and accounts (approved). Only students with a phone registered, never the one acting.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(18);

insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9771, 'Test Mu University', 'TMU2', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('mu.test', 9771);

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
  select id from academics.modules where institution_id = 9771 and code_key = p_code;
$$;
create function pg_temp.pushes(p_user uuid, p_kind text) returns integer language sql security definer as $$
  select count(*)::int from messaging.app_pushes where user_id = p_user and kind = p_kind;
$$;

-- a, b, c: the 2025 batch at Mu, all taking CS2012. All have a phone registered.
select pg_temp.make_user('00000000-0000-0000-0000-0000000e7001', '2025mm001@mu.test', 'Amaya A');
select pg_temp.make_user('00000000-0000-0000-0000-0000000e7002', '2025mm002@mu.test', 'Buddhika B');
select pg_temp.make_user('00000000-0000-0000-0000-0000000e7003', '2025mm003@mu.test', 'Chamod C');
select pg_temp.act_as('00000000-0000-0000-0000-0000000e7001');
select api.join_batch(null, 'BSc in Notice Studies', 2025);
select api.set_batch_term(1, 1);
select api.save_semester(1, 1, '[{"code": "CS2012", "name": "Data Structures"}]');
select pg_temp.act_as('00000000-0000-0000-0000-0000000e7002');
select api.join_batch((select id from academics.programmes where institution_id = 9771), null, 2025);
select pg_temp.act_as('00000000-0000-0000-0000-0000000e7003');
select api.join_batch((select id from academics.programmes where institution_id = 9771), null, 2025);
select set_config('role', 'postgres', true);
select set_config('request.jwt.claims', '', true); -- as the server itself (cron, an admin): nobody to skip
insert into messaging.push_tokens (token, user_id, platform) values
  ('ExponentPushToken[note-a]', '00000000-0000-0000-0000-0000000e7001', 'android'),
  ('ExponentPushToken[note-b]', '00000000-0000-0000-0000-0000000e7002', 'android'),
  ('ExponentPushToken[note-c]', '00000000-0000-0000-0000-0000000e7003', 'android');
create temp table ids (exam uuid, req uuid, k1 uuid, k2 uuid, res uuid, comment uuid);
insert into ids default values;
grant all on pg_temp.ids to public;

-- ---------------------------------------------------------------- exams
select pg_temp.act_as('00000000-0000-0000-0000-0000000e7001');
select api.set_exam(pg_temp.mod('CS2012'), 'final', now() + interval '12 days', 'Hall A');
select is(pg_temp.pushes('00000000-0000-0000-0000-0000000e7002', 'exam_set'), 1, 'batchmates hear an exam date was set');
select is(pg_temp.pushes('00000000-0000-0000-0000-0000000e7001', 'exam_set'), 0, 'not the one who set it');
select api.set_exam(pg_temp.mod('CS2012'), 'final', now() + interval '13 days', 'Hall A');
select is(pg_temp.pushes('00000000-0000-0000-0000-0000000e7002', 'exam_set'), 1, 'moving it again straight away does not buzz twice');
select set_config('role', 'postgres', true);
select set_config('request.jwt.claims', '', true); -- as the server itself (cron, an admin): nobody to skip
update academics.cohort_exams set starts_at = ((now() at time zone 'Asia/Colombo')::date + 1 + time '09:00') at time zone 'Asia/Colombo'
where module_id = pg_temp.mod('CS2012');
select academics.send_exam_reminders();
select academics.send_exam_reminders();
select is(pg_temp.pushes('00000000-0000-0000-0000-0000000e7003', 'exam_tomorrow'), 1, 'the evening before, the batch is reminded once');

-- ---------------------------------------------------------------- kuppi
select pg_temp.act_as('00000000-0000-0000-0000-0000000e7003');
update ids set req = (api.request_kuppi(pg_temp.mod('CS2012'), 'Heaps and priority queues') ->> 'id')::uuid;
select pg_temp.act_as('00000000-0000-0000-0000-0000000e7002');
update ids set k1 = (api.create_kuppi(pg_temp.mod('CS2012'), 'Heaps', now() + interval '2 days', 60, 'online', 30,
  'https://zoom.us/j/1', null, null, (select req from ids)) ->> 'id')::uuid;
set constraints all immediate;
select is(pg_temp.pushes('00000000-0000-0000-0000-0000000e7003', 'kuppi_answered'), 1, 'the student who asked hears it was answered');
select is(pg_temp.pushes('00000000-0000-0000-0000-0000000e7003', 'kuppi_new'), 0, 'and is not told twice');
select is(pg_temp.pushes('00000000-0000-0000-0000-0000000e7001', 'kuppi_new'), 1, 'others taking the module hear about the new kuppi');
select is(pg_temp.pushes('00000000-0000-0000-0000-0000000e7002', 'kuppi_new'), 0, 'not the host');

select pg_temp.act_as('00000000-0000-0000-0000-0000000e7001');
select api.rsvp((select k1 from ids));
select set_config('role', 'postgres', true);
select set_config('request.jwt.claims', '', true); -- as the server itself (cron, an admin): nobody to skip
update kuppi.sessions set starts_at = now() + interval '15 minutes', ends_at = now() + interval '75 minutes' where id = (select k1 from ids);
select kuppi.send_reminders();
select kuppi.send_reminders();
select is(pg_temp.pushes('00000000-0000-0000-0000-0000000e7001', 'kuppi_starting'), 1, 'everyone going is reminded once, 15 minutes before');
select is(pg_temp.pushes('00000000-0000-0000-0000-0000000e7002', 'kuppi_starting'), 1, 'and the host');

select pg_temp.act_as('00000000-0000-0000-0000-0000000e7002');
update ids set k2 = (api.create_kuppi(pg_temp.mod('CS2012'), 'Graphs', now() + interval '3 days', 60, 'in_person', 30,
  null, 'Lab 2') ->> 'id')::uuid;
select pg_temp.act_as('00000000-0000-0000-0000-0000000e7001');
select api.rsvp((select k2 from ids));
select pg_temp.act_as('00000000-0000-0000-0000-0000000e7002');
select api.cancel_kuppi((select k2 from ids), 'I am sick, sorry');
select is(pg_temp.pushes('00000000-0000-0000-0000-0000000e7001', 'kuppi_cancelled'), 1, 'everyone going hears a kuppi was cancelled');
select set_config('role', 'postgres', true);
select set_config('request.jwt.claims', '', true); -- as the server itself (cron, an admin): nobody to skip
select is((select body from messaging.app_pushes where user_id = '00000000-0000-0000-0000-0000000e7001' and kind = 'kuppi_cancelled'),
          (select messaging.when_text(starts_at) from kuppi.sessions where id = (select k2 from ids)) || '. I am sick, sorry',
          'with the reason');

-- ---------------------------------------------------------------- shared files
select set_config('role', 'postgres', true);
select set_config('request.jwt.claims', '', true); -- as the server itself (cron, an admin): nobody to skip
insert into content.resources (module_id, uploader_id, institution_id, title, kind, storage_key, mime_type, size_bytes)
values (pg_temp.mod('CS2012'), '00000000-0000-0000-0000-0000000e7001', 9771, 'CS2012 Past Paper 2023', 'past_papers',
        'resources/test-notify.pdf', 'application/pdf', 1000);
update ids set res = (select id from content.resources where storage_key = 'resources/test-notify.pdf');
update content.resources set status = 'live' where id = (select res from ids);
select is(pg_temp.pushes('00000000-0000-0000-0000-0000000e7001', 'file_checked'), 1, 'the uploader hears the file is live');
insert into content.comments (resource_id, author_id, body) values ((select res from ids), '00000000-0000-0000-0000-0000000e7002', 'Q3 answer?');
insert into content.comments (resource_id, author_id, body) values ((select res from ids), '00000000-0000-0000-0000-0000000e7003', 'Same question');
select is(pg_temp.pushes('00000000-0000-0000-0000-0000000e7001', 'file_comment'), 1, 'the uploader hears about comments, at most once in a while');
update ids set comment = (select id from content.comments where resource_id = (select res from ids) and author_id = '00000000-0000-0000-0000-0000000e7002');
insert into content.comments (resource_id, author_id, parent_id, body)
values ((select res from ids), '00000000-0000-0000-0000-0000000e7003', (select comment from ids), 'It is in the notes');
select is(pg_temp.pushes('00000000-0000-0000-0000-0000000e7002', 'comment_reply'), 1, 'a reply reaches the comment''s author');

-- ---------------------------------------------------------------- accounts
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, aud, role)
values ('00000000-0000-0000-0000-0000000e7004', '2025mm004@mu.test', jsonb_build_object('full_name', 'Dasuni D'), now(), 'authenticated', 'authenticated');
select pg_temp.act_as('00000000-0000-0000-0000-0000000e7004');
select lives_ok($$ select api.register_push_token('ExponentPushToken[note-d]', 'android') $$, 'students waiting for approval can register their phone');
select set_config('role', 'postgres', true);
select set_config('request.jwt.claims', '', true); -- as the server itself (cron, an admin): nobody to skip
update identity.profiles set account_status = 'active' where user_id = '00000000-0000-0000-0000-0000000e7004';
select is(pg_temp.pushes('00000000-0000-0000-0000-0000000e7004', 'account'), 1, 'and hear when they are approved');
select is((select title from messaging.app_pushes where user_id = '00000000-0000-0000-0000-0000000e7004'), 'You are in!', 'in plain words');

select * from finish();
rollback;
