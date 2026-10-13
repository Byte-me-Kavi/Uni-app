-- Freshers' questions: who asks, who sees what (answered for every fresher, waiting only for the
-- asker and ambassadors), who answers, the asker's name hidden from ambassadors, appointing
-- ambassadors, reports and deleting.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(22);

insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9797, 'Test Phi University', 'TPU', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('phi.test', 9797);

create function pg_temp.make_student(p_id uuid, p_email text, p_name text) returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, aud, role)
  values (p_id, p_email, '{}', now(), 'authenticated', 'authenticated');
  update identity.profiles set account_status = 'active', name_confirmed_at = now(), full_name = p_name where user_id = p_id;
$$;
create function pg_temp.make_fresher(p_id uuid, p_email text, p_name text) returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, aud, role)
  values (p_id, p_email, '{"fresher": true}', now(), 'authenticated', 'authenticated');
  update identity.profiles set account_status = 'active', institution_id = 9797, fresher_until = now() + interval '120 days',
    name_confirmed_at = now(), full_name = p_name where user_id = p_id;
  select academics.place_in_batch(p_id, 9797, null, 'BSc in Questions', 2026, null);
$$;
create function pg_temp.act_as(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;

-- f, g: freshers. s: a senior. a: becomes an ambassador. m: a moderator.
select pg_temp.make_fresher('00000000-0000-0000-0000-0000000fa001', 'fq.one@gmail.test', 'Fara Fresher');
select pg_temp.make_fresher('00000000-0000-0000-0000-0000000fa002', 'fq.two@gmail.test', 'Gayan Fresher');
select pg_temp.make_student('00000000-0000-0000-0000-0000000fa003', '2022pp003@phi.test', 'Sunil Senior');
select pg_temp.make_student('00000000-0000-0000-0000-0000000fa004', '2022pp004@phi.test', 'Anoma Ambassador');
select pg_temp.make_student('00000000-0000-0000-0000-0000000fa005', '2020pp005@phi.test', 'Mihiri Moderator');
insert into identity.staff_roles (user_id, role, institution_id) values ('00000000-0000-0000-0000-0000000fa005', 'moderator', 9797);

create temp table ids (q bigint, a bigint);
insert into ids default values;
grant all on pg_temp.ids to public;

-- ---------------------------------------------------------------- appointing ambassadors
select pg_temp.act_as('00000000-0000-0000-0000-0000000fa003');
select throws_ok($$ select api.fresher_questions() $$, '42501', null, 'other students do not see freshers'' questions');
select throws_ok($$ select api.set_ambassador('00000000-0000-0000-0000-0000000fa004', true) $$, '42501', null,
  'students cannot appoint ambassadors');
select pg_temp.act_as('00000000-0000-0000-0000-0000000fa005');
select throws_ok($$ select api.set_ambassador('00000000-0000-0000-0000-0000000fa001', true) $$, '22023', null,
  'a fresher cannot be an ambassador');
select ok(api.set_ambassador('00000000-0000-0000-0000-0000000fa004', true), 'a moderator appoints an ambassador');
select is(api.person('00000000-0000-0000-0000-0000000fa004') ->> 'ambassador', 'true', 'their card says so');

-- ---------------------------------------------------------------- asking
select pg_temp.act_as('00000000-0000-0000-0000-0000000fa001');
select throws_ok($$ select api.ask_freshers('Hostel?') $$, '22023', null, 'a question needs at least 10 characters');
update ids set q = (api.ask_freshers('What should I bring on registration day?') ->> 'id')::bigint;
select is(api.fresher_questions() -> 'waiting' -> 0 ->> 'mine', 'true', 'the asker sees their question waiting');
select pg_temp.act_as('00000000-0000-0000-0000-0000000fa003');
select throws_ok($$ select api.ask_freshers('Is the canteen open on Sundays?') $$, '42501', null, 'only freshers ask');

select pg_temp.act_as('00000000-0000-0000-0000-0000000fa002');
select is(jsonb_array_length(api.fresher_questions() -> 'waiting'), 0, 'other freshers do not see unanswered questions');
select throws_ok($$ select api.fresher_question((select q from ids)) $$, '42501', null, 'or open them');

select pg_temp.act_as('00000000-0000-0000-0000-0000000fa004');
select is(api.fresher_questions() -> 'waiting' -> 0 ->> 'programme', 'BSc in Questions', 'ambassadors see the asker''s programme');
select is(api.fresher_questions() -> 'waiting' -> 0 ->> 'asker', null, 'but not their name');
select is(api.freshers_badge() ->> 'waiting', '1', 'and how many wait');
select pg_temp.act_as('00000000-0000-0000-0000-0000000fa005');
select is(api.fresher_questions() -> 'waiting' -> 0 ->> 'asker', 'Fara Fresher', 'moderators see who asked');

-- ---------------------------------------------------------------- answering
select pg_temp.act_as('00000000-0000-0000-0000-0000000fa002');
select throws_ok($$ select api.answer_fresher((select q from ids), 'Your NIC and the letter') $$, '42501', null, 'freshers do not answer');
select pg_temp.act_as('00000000-0000-0000-0000-0000000fa004');
update ids set a = api.answer_fresher((select q from ids), 'Your NIC, the selection letter and two photos.');

select pg_temp.act_as('00000000-0000-0000-0000-0000000fa002');
select is(jsonb_array_length(api.fresher_questions() -> 'answered'), 1, 'answered questions are seen by every fresher');
select is(api.fresher_question((select q from ids)) -> 'answers' -> 0 -> 'author' ->> 'role', 'Ambassador',
  'answers carry the ambassador badge');

-- ---------------------------------------------------------------- reports and deleting
select ok(api.report_fresher_item('answer', (select a from ids), 'spam') is not null, 'freshers can report an answer');
select pg_temp.act_as('00000000-0000-0000-0000-0000000fa001');
select throws_ok($$ select api.report_fresher_item('question', (select q from ids), 'spam') $$, '22023', null,
  'but not their own question');
select throws_ok($$ select api.delete_fresher_item('answer', (select a from ids)) $$, '42501', null,
  'or delete someone else''s answer');
select pg_temp.act_as('00000000-0000-0000-0000-0000000fa004');
select api.delete_fresher_item('answer', (select a from ids));
select is(api.fresher_question((select q from ids)) ->> 'answer_count', '0', 'authors delete their own answers');
select pg_temp.act_as('00000000-0000-0000-0000-0000000fa005');
select api.set_ambassador('00000000-0000-0000-0000-0000000fa004', false);
select pg_temp.act_as('00000000-0000-0000-0000-0000000fa004');
select throws_ok($$ select api.fresher_questions() $$, '42501', null, 'a former ambassador no longer sees questions');

select * from finish();
rollback;
