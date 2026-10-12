-- Exam dates (reps set them; a batch with no reps sets its own) and kuppi requests (anonymous asks,
-- votes, similar asks merged, answered by hosting a kuppi, reported, other universities kept out).
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(22);

insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9881, 'Test Eta University', 'TEU', 'state', 'live'),
  (9882, 'Test Theta University', 'TTH', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('eta.test', 9881), ('theta.test', 9882);

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
  select id from academics.modules where institution_id = 9881 and code_key = p_code;
$$;

-- a, b: the 2025 batch at Eta (no reps at first). c: Eta, another batch. z: Theta.
select pg_temp.make_user('00000000-0000-0000-0000-0000000ad101', '2025ee001@eta.test', 'Asha A');
select pg_temp.make_user('00000000-0000-0000-0000-0000000ad102', '2025ee002@eta.test', 'Bhanuka B');
select pg_temp.make_user('00000000-0000-0000-0000-0000000ad103', '2024cc001@eta.test', 'Chathura C');
select pg_temp.make_user('00000000-0000-0000-0000-0000000ad201', '2025ee001@theta.test', 'Zainab Z');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ad101');
select api.join_batch(null, 'BSc in Exam Studies', 2025);
select api.set_batch_term(1, 1);
select api.save_semester(1, 1, '[{"code": "CS2012", "name": "Data Structures"}, {"code": "MA1013", "name": "Calculus"}]');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ad102');
select api.join_batch((select id from academics.programmes where institution_id = 9881), null, 2025);
select pg_temp.act_as('00000000-0000-0000-0000-0000000ad103');
select api.join_batch(null, 'BSc in Other Exams', 2024);
select pg_temp.act_as('00000000-0000-0000-0000-0000000ad201');
select api.join_batch(null, 'BSc in Exam Studies', 2025);
select set_config('role', 'postgres', true);

create temp table ids (req uuid, exam uuid);
insert into ids default values;
grant all on pg_temp.ids to public;

-- ---------------------------------------------------------------- exams
select pg_temp.act_as('00000000-0000-0000-0000-0000000ad101');
select is((api.my_exams() ->> 'can_edit'), 'true', 'a batch with no reps sets its own exam dates');
select is((api.set_exam(pg_temp.mod('CS2012'), 'final', now() + interval '12 days', 'Hall A') -> 'exams' -> 0 ->> 'days'), '12',
  'an exam shows how many days are left');
select api.set_exam(pg_temp.mod('MA1013'), 'final', now() + interval '20 days');
select api.set_exam(pg_temp.mod('CS2012'), 'mid', now() + interval '3 days');
select is((api.my_exams() -> 'exams' -> 0 -> 'module' ->> 'code'), 'CS2012', 'soonest first');
select is((api.set_exam(pg_temp.mod('CS2012'), 'final', now() + interval '14 days') -> 'exams' -> 1 ->> 'days'), '14',
  'setting the same exam again moves it');
select throws_ok($$ select api.set_exam(pg_temp.mod('CS2012'), 'final', now() + interval '3 years') $$, '22023', null,
  'dates are within the next year');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ad102');
select is(jsonb_array_length(api.my_exams() -> 'exams'), 3, 'batchmates see the dates');
select set_config('role', 'postgres', true);
update messaging.conversation_members set role = 'admin'
where user_id = '00000000-0000-0000-0000-0000000ad101'
  and conversation_id = (select c.id from messaging.conversations c join academics.cohort_members m on m.cohort_id = c.cohort_id
                         where m.user_id = '00000000-0000-0000-0000-0000000ad101');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ad102');
select throws_ok($$ select api.set_exam(pg_temp.mod('CS2012'), 'quiz', now() + interval '5 days') $$, '42501', null,
  'once a batch has reps, reps set the dates');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ad103');
select is(jsonb_array_length(api.my_exams() -> 'exams'), 0, 'other batches do not see them');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ad101');
update ids set exam = (api.my_exams() -> 'exams' -> 0 ->> 'id')::uuid;
select is(jsonb_array_length(api.remove_exam((select exam from ids)) -> 'exams'), 2, 'a rep can remove one');
select set_config('role', 'postgres', true);
select ok(exists (select 1 from ops.audit_log where action = 'exams.set'), 'exam changes are audited');

-- ---------------------------------------------------------------- kuppi requests
select pg_temp.act_as('00000000-0000-0000-0000-0000000ad102');
update ids set req = (api.request_kuppi(pg_temp.mod('CS2012'), 'AVL trees and rotations') ->> 'id')::uuid;
select pg_temp.act_as('00000000-0000-0000-0000-0000000ad101');
select is((api.request_kuppi(pg_temp.mod('CS2012'), 'AVL tree rotations') ->> 'merged'), 'true',
  'a similar request gets a vote instead of a duplicate');
select is((api.kuppi_requests('my_modules') -> 0 ->> 'votes'), '2', 'votes add up');
select is((api.kuppi_requests('my_modules') -> 0 ->> 'mine'), 'false', 'other students do not see who asked');
select ok(not (api.kuppi_requests('my_modules') -> 0 ? 'requester_id'), 'the asker is never in the answer');
select is((api.vote_kuppi_request((select req from ids), false) ->> 'votes'), '1', 'a vote can be taken back');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ad103');
select is((api.kuppi_requests('all') -> 0 ->> 'topic'), 'AVL trees and rotations', 'everyone at the university can see requests');
select throws_ok($$ select api.close_kuppi_request((select req from ids)) $$, '42501', null, 'only the asker closes a request');
select lives_ok($$ select api.report_kuppi_request((select req from ids), 'spam') $$, 'requests can be reported');
select lives_ok($$ select api.create_kuppi(pg_temp.mod('CS2012'), 'AVL trees', now() + interval '2 days', 60, 'online', 30,
  'https://zoom.us/j/1', null, null, (select req from ids)) $$, 'hosting a kuppi can answer a request');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ad102');
select is((api.kuppi_requests('my_modules') -> 0 -> 'session' ->> 'title'), 'AVL trees', 'askers see the kuppi that answers them');
select throws_ok($$ select api.vote_kuppi_request((select req from ids), true) $$, 'P0002', null, 'answered requests are closed');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ad201');
select is(jsonb_array_length(api.kuppi_requests('all')), 0, 'another university sees none');

select * from finish();
rollback;
