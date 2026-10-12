-- Semester modules: one module per code, batch lists confirmed by reps or by batchmates' votes,
-- suggestions from the senior batch, the batch's semester, electives and choices, course chats,
-- renames, merges, and other universities kept out.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(52);

-- ---------------------------------------------------------------- fixtures
insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9831, 'Test Upsilon University', 'TUU', 'state', 'live'),
  (9832, 'Test Phi University', 'TPU', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('upsilon.test', 9831), ('phi.test', 9832);

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
-- The id of a module at Upsilon by its code, however it is typed.
create function pg_temp.mod(p_code text) returns bigint language sql as $$
  select id from academics.modules where institution_id = 9831 and code_key = upper(regexp_replace(p_code, '[^[:alnum:]]+', '', 'g'));
$$;
-- How many students of the 2024 batch are in course chats, and how many of those are archived.
create function pg_temp.course_members(p_code text, p_intake int) returns int language sql as $$
  select count(*)::int from messaging.conversation_members cm
  join messaging.conversations c on c.id = cm.conversation_id
  where c.kind = 'module' and c.module_id = pg_temp.mod(p_code) and c.module_intake = p_intake;
$$;

-- j1: the 2023 batch (alone). s1 (rep), s2, s3, s4: the 2024 batch. mod: Upsilon moderator.
-- t1: Phi student. p1: pending Upsilon student.
select pg_temp.make_user('00000000-0000-0000-0000-00000000d101', '2023mm001@upsilon.test', 'Janith Senior');
select pg_temp.make_user('00000000-0000-0000-0000-00000000d111', '2024mm001@upsilon.test', 'Sanduni Rep');
select pg_temp.make_user('00000000-0000-0000-0000-00000000d112', '2024mm002@upsilon.test', 'Supun Two');
select pg_temp.make_user('00000000-0000-0000-0000-00000000d113', '2024mm003@upsilon.test', 'Sachini Three');
select pg_temp.make_user('00000000-0000-0000-0000-00000000d114', '2024mm004@upsilon.test', 'Sahan Four');
select pg_temp.make_user('00000000-0000-0000-0000-00000000d121', 'moderator@upsilon.test', 'Mala Moderator');
select pg_temp.make_user('00000000-0000-0000-0000-00000000d201', '2024mm001@phi.test', 'Tharindu Phi');
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, aud, role)
values ('00000000-0000-0000-0000-00000000d131', '2024mm009@upsilon.test', '{"full_name": "Pending Person"}', now(), 'authenticated', 'authenticated');
insert into identity.staff_roles (user_id, role, institution_id) values ('00000000-0000-0000-0000-00000000d121', 'moderator', 9831);

select pg_temp.act_as('00000000-0000-0000-0000-00000000d101');
select api.join_batch(null, 'BSc in Module Studies', 2023);
select pg_temp.act_as('00000000-0000-0000-0000-00000000d111');
select api.join_batch((select id from academics.programmes where institution_id = 9831), null, 2024);
select pg_temp.act_as('00000000-0000-0000-0000-00000000d112');
select api.join_batch((select id from academics.programmes where institution_id = 9831), null, 2024);
select pg_temp.act_as('00000000-0000-0000-0000-00000000d113');
select api.join_batch((select id from academics.programmes where institution_id = 9831), null, 2024);
select pg_temp.act_as('00000000-0000-0000-0000-00000000d114');
select api.join_batch((select id from academics.programmes where institution_id = 9831), null, 2024);
select pg_temp.act_as('00000000-0000-0000-0000-00000000d201');
select api.join_batch(null, 'BSc in Module Studies', 2024);
select set_config('role', 'postgres', true);

-- ---------------------------------------------------------------- the senior batch sets itself up
-- A batch of one: one student's choice is the batch's.
select pg_temp.act_as('00000000-0000-0000-0000-00000000d101');
select is((api.set_batch_term(1, 1) -> 'term' ->> 'confirmed'), 'true', 'a batch of one confirms its semester alone');
select api.save_semester(1, 1, '[
  {"code": "cs 1012", "name": "Data Structures", "kind": "core"},
  {"code": "MA-1013", "name": "Calculus", "kind": "core"},
  {"code": "CS1099", "name": "Graphics", "kind": "elective"}]');
select is(jsonb_array_length(api.semester_plan(1, 1) -> 'modules'), 3, 'its list is confirmed at once');
select is((select code from academics.modules where id = pg_temp.mod('CS1012')), 'CS 1012', 'the code is kept as typed (upper case)');
select is(jsonb_array_length(api.my_modules() -> 'current'), 2, 'core modules are current; the elective is not chosen yet');
select set_config('role', 'postgres', true);
select is(pg_temp.course_members('CS1012', 2023), 1, 'taking a module opens its course chat');
select pg_temp.act_as('00000000-0000-0000-0000-00000000d101');
select is(pg_temp.course_members('CS1099', 2023), 0, 'no course chat for an elective not taken');

-- ---------------------------------------------------------------- one module per code
select pg_temp.act_as('00000000-0000-0000-0000-00000000d112');
select is((api.set_batch_term(1, 1) -> 'term' ->> 'confirmed'), 'false', 'in a batch of four, one student cannot set the semester');
select is((api.my_modules() -> 'term' ->> 'year'), '1', 'but they already see the semester they asked for');
select api.save_semester(1, 1, '[{"code": "CS-1012", "name": "Something Else"}]');
select is((select count(*)::int from academics.modules where institution_id = 9831 and code_key = 'CS1012'), 1,
  'the same code typed differently is the same module');
select is((select name from academics.modules where id = pg_temp.mod('CS1012')), 'Data Structures', 'adding a known code never renames it');
select is((api.my_modules() -> 'current' -> 0 ->> 'pending'), 'true', 'a module one student added shows for them, pending');
select throws_ok($$ select api.save_semester(1, 1, '[{"code": "hello", "name": "Not a code"}]') $$, '22023', null,
  'a code needs letters and digits');
select throws_ok($$ select api.save_semester(1, 1, '[{"code": "ZZ9999"}]') $$, '22023', null,
  'a new code needs a name');

-- ---------------------------------------------------------------- suggestions and votes
select pg_temp.act_as('00000000-0000-0000-0000-00000000d113');
select is((select count(*)::int from jsonb_array_elements(api.semester_plan(1, 1) -> 'suggestions') s
           where s ->> 'from' = '2023 batch'), 2, 'the senior batch''s list is suggested (minus what is already added)');
select is((api.semester_plan(1, 1) -> 'proposals' -> 0 ->> 'votes'), '1', 'batchmates see additions waiting, with votes');
select api.save_semester(1, 1, jsonb_build_array(jsonb_build_object('module_id', pg_temp.mod('CS1012'))));
select is(jsonb_array_length(api.semester_plan(1, 1) -> 'modules'), 1, 'a second batchmate puts it on the list (2 needed in a batch of 4)');
select api.save_semester(1, 1, '[]');
select is(jsonb_array_length(api.semester_plan(1, 1) -> 'modules'), 1, 'students cannot remove what is on the list');

-- ---------------------------------------------------------------- the rep
select set_config('role', 'postgres', true);
update messaging.conversation_members set role = 'admin'
where user_id = '00000000-0000-0000-0000-00000000d111'
  and conversation_id = (select c.id from messaging.conversations c join academics.cohort_members m on m.cohort_id = c.cohort_id
                         where m.user_id = '00000000-0000-0000-0000-00000000d111');
select pg_temp.act_as('00000000-0000-0000-0000-00000000d111');
select is((api.my_modules() ->> 'can_edit'), 'true', 'a batch rep can edit the lists');
select throws_ok($$ select api.set_batch_term(5, 1) $$, '22023', null, 'degrees are 4 years, even for reps');
select throws_ok($$ select api.set_batch_term(1, 3) $$, '22023', null, 'with 2 semesters a year');
select throws_ok($$ select api.save_semester(5, 1, '[]') $$, '22023', null, 'lists exist only for those semesters');
select api.save_semester(1, 1, jsonb_build_array(
  jsonb_build_object('module_id', pg_temp.mod('CS1012'), 'kind', 'core'),
  jsonb_build_object('module_id', pg_temp.mod('MA1013'), 'kind', 'core'),
  jsonb_build_object('module_id', pg_temp.mod('CS1099'), 'kind', 'elective')));
select is(jsonb_array_length(api.semester_plan(1, 1) -> 'modules'), 3, 'the rep''s list applies at once');
select set_config('role', 'postgres', true);
select ok(exists (select 1 from ops.audit_log where action = 'modules.save_semester'
                  and actor_id = '00000000-0000-0000-0000-00000000d111'), 'the rep''s change is audited');

-- ---------------------------------------------------------------- the semester and course chats
select pg_temp.act_as('00000000-0000-0000-0000-00000000d113');
select is((api.set_batch_term(1, 1) -> 'term' ->> 'confirmed'), 'true', 'a second batchmate confirms the semester');
-- Counted as postgres: students only see the chats they are in.
select set_config('role', 'postgres', true);
select is(pg_temp.course_members('CS1012', 2024), 4, 'the whole batch joins the course chat');
select is((select count(*)::int from messaging.conversations where module_id = pg_temp.mod('CS1012')), 2,
  'each intake year has its own course chat');
select is(pg_temp.course_members('CS1099', 2024), 0, 'nobody is in an elective''s chat until they take it');

select pg_temp.act_as('00000000-0000-0000-0000-00000000d112');
select is(jsonb_array_length(api.set_module_choice(pg_temp.mod('CS1099'), 'taking') -> 'current'), 3, 'taking an elective adds it');
select set_config('role', 'postgres', true);
select is(pg_temp.course_members('CS1099', 2024), 1, 'and opens its course chat');
select pg_temp.act_as('00000000-0000-0000-0000-00000000d114');
select is(jsonb_array_length(api.set_module_choice(pg_temp.mod('MA1013'), 'not_taking') -> 'not_taking'), 1,
  'a core module can be marked as not taken');
select set_config('role', 'postgres', true);
select is(pg_temp.course_members('MA1013', 2024), 3, 'which leaves its course chat');

-- Moving on: students may only ask for the next semester.
select pg_temp.act_as('00000000-0000-0000-0000-00000000d112');
select throws_ok($$ select api.set_batch_term(3, 1) $$, '22023', null, 'students cannot jump to any semester');
select is((api.set_batch_term(1, 2) -> 'my_term_vote' ->> 'votes'), '1', 'asking to move on is a vote');
select pg_temp.act_as('00000000-0000-0000-0000-00000000d113');
select is((api.set_batch_term(1, 2) -> 'term' ->> 'semester'), '2', 'enough votes move the batch on');
select pg_temp.act_as('00000000-0000-0000-0000-00000000d112');
select is(jsonb_array_length(api.my_modules() -> 'past'), 1, 'the last semester is now in the past');
select set_config('role', 'postgres', true);
select is((select (cm.archived_at is not null)::text from messaging.conversation_members cm
           join messaging.conversations c on c.id = cm.conversation_id
           where c.module_id = pg_temp.mod('CS1012') and c.module_intake = 2024
             and cm.user_id = '00000000-0000-0000-0000-00000000d112'), 'true',
  'last semester''s course chats are archived, not left');

-- ---------------------------------------------------------------- renaming
select pg_temp.act_as('00000000-0000-0000-0000-00000000d112');
select throws_ok($$ select api.rename_module(pg_temp.mod('CS1012'), 'Data Structures and Algorithms') $$, '42501', null,
  'students cannot rename modules');
select pg_temp.act_as('00000000-0000-0000-0000-00000000d111');
select api.rename_module(pg_temp.mod('CS1012'), 'Data Structures and Algorithms');
select set_config('role', 'postgres', true);
select is((select count(*)::int from messaging.conversations
           where module_id = pg_temp.mod('CS1012') and title = 'CS 1012 · Data Structures and Algorithms'), 2,
  'a rename changes the module and its course chats, not the number of modules');

-- ---------------------------------------------------------------- merging
select pg_temp.act_as('00000000-0000-0000-0000-00000000d111');
select api.save_semester(1, 2, '[{"code": "CS1013", "name": "Data Structures II (old code)"}]');
select pg_temp.act_as('00000000-0000-0000-0000-00000000d112');
select throws_ok($$ select api.merge_modules(pg_temp.mod('CS1013'), pg_temp.mod('CS1012')) $$, '42501', null,
  'students cannot merge modules');
select pg_temp.act_as('00000000-0000-0000-0000-00000000d121');
select lives_ok($$ select api.merge_modules(pg_temp.mod('CS1013'), pg_temp.mod('CS1012')) $$, 'a moderator merges a duplicate');
select pg_temp.act_as('00000000-0000-0000-0000-00000000d112');
select is((api.semester_plan(1, 2) -> 'modules' -> 0 ->> 'code'), 'CS 1012', 'the batch''s list follows the merge');
select is((select count(*)::int from api.find_modules('CS1013')), 0, 'the merged code is not offered again');
select set_config('role', 'postgres', true);
select is(pg_temp.course_members('CS1012', 2024), 4, 'the batch stays in the remaining module''s course chat');
select is(pg_temp.course_members('CS1013', 2024), 0, 'and leaves the duplicate''s');

-- ---------------------------------------------------------------- other universities and direct access
select pg_temp.act_as('00000000-0000-0000-0000-00000000d201');
select is((select count(*)::int from api.find_modules('CS10')), 0, 'another university''s modules are not found');
select throws_ok(format($$ select api.save_semester(1, 1, '[{"module_id": %s}]') $$, pg_temp.mod('CS1012')), '22023', null,
  'another university''s module cannot be added');
select throws_ok(format($$ select api.set_module_choice(%s, 'repeat') $$, pg_temp.mod('CS1012')), '22023', null,
  'nor chosen');
select throws_ok($$ select count(*) from academics.cohort_modules $$, '42501', null, 'batch lists are not readable directly');
select throws_ok($$ select count(*) from academics.module_choices $$, '42501', null, 'nor are students'' choices');
select pg_temp.act_as('00000000-0000-0000-0000-00000000d131');
select throws_ok($$ select api.my_modules() $$, '42501', null, 'a pending account sees no modules');

-- ---------------------------------------------------------------- home and leaving the batch
select pg_temp.act_as('00000000-0000-0000-0000-00000000d112');
select ok((api.my_home() ->> 'module_count')::int > 0, 'home counts this semester''s modules');
select set_config('role', 'postgres', true);
delete from academics.cohort_members where user_id = '00000000-0000-0000-0000-00000000d114';
select is((select count(*)::int from messaging.conversation_members cm join messaging.conversations c on c.id = cm.conversation_id
           where c.kind = 'module' and cm.user_id = '00000000-0000-0000-0000-00000000d114'), 0,
  'leaving the batch leaves its course chats');

select * from finish();
rollback;
