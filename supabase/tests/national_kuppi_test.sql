-- Kuppi across universities: requests asked of all universities reach students taking the same
-- national subject elsewhere (anonymously), and a host there answers with an online kuppi open to all.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(34);

insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9893, 'Test Rho University', 'TRU', 'state', 'live'),
  (9894, 'Test Mu University', 'TMU', 'state', 'live'),
  (9895, 'Test Pi University', 'TPU', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('rho.test', 9893), ('mu.test', 9894), ('pi.test', 9895);

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
create function pg_temp.send_file(p_conversation uuid, p_name text) returns uuid language plpgsql as $$
declare
  v_path text := 'chat/' || p_conversation || '/' || gen_random_uuid() || '.pdf';
  v_uid uuid := (current_setting('request.jwt.claims')::jsonb ->> 'sub')::uuid;
begin
  perform set_config('role', 'postgres', true);
  insert into messaging.uploads (path, user_id, conversation_id, kind, mime, size) values (v_path, v_uid, p_conversation, 'file', 'application/pdf', 1000);
  perform set_config('role', 'authenticated', true);
  return (api.send_message(p_conversation, ops.uuid_v7(), '', null, 'file', jsonb_build_object('path', v_path, 'name', p_name)) ->> 'id')::uuid;
end $$;
create function pg_temp.mod(p_inst bigint) returns bigint language sql as $$
  select id from academics.modules where institution_id = p_inst order by id limit 1;
$$;

-- r, s: Rho 2025 batch (CS2012). m: Mu (CO222, the same subject). p: Pi (a different subject).
select pg_temp.make_user('00000000-0000-0000-0000-0000000af101', '2025rr001@rho.test', 'Ruwan R');
select pg_temp.make_user('00000000-0000-0000-0000-0000000af102', '2025rr002@rho.test', 'Sachi S');
select pg_temp.make_user('00000000-0000-0000-0000-0000000af201', '2025mm001@mu.test', 'Malki M');
select pg_temp.make_user('00000000-0000-0000-0000-0000000af301', '2025pp001@pi.test', 'Pasan P');
select pg_temp.act_as('00000000-0000-0000-0000-0000000af101');
select api.join_batch(null, 'BSc in Rho Computing', 2025);
select api.set_batch_term(1, 1);
select api.save_semester(1, 1, '[{"code": "CS2012", "name": "Data Structures and Algorithms"}]');
select pg_temp.act_as('00000000-0000-0000-0000-0000000af102');
select api.join_batch((select id from academics.programmes where institution_id = 9893), null, 2025);
select pg_temp.act_as('00000000-0000-0000-0000-0000000af201');
select api.join_batch(null, 'BSc in Mu Computing', 2025);
select api.set_batch_term(1, 1);
select api.save_semester(1, 1, '[{"code": "CO222", "name": "Data Structures and Algorithms II"}]');
select pg_temp.act_as('00000000-0000-0000-0000-0000000af301');
select api.join_batch(null, 'BSc in Pi Science', 2025);
select api.set_batch_term(1, 1);
select api.save_semester(1, 1, '[{"code": "MA1013", "name": "Calculus I"}]');
select set_config('role', 'postgres', true);

create temp table ids (avl uuid, heaps uuid, graphs uuid, k1 uuid, k2 uuid, chat uuid, slides uuid);
insert into ids default values;
grant all on pg_temp.ids to public;

-- ---------------------------------------------------------------- requests
select pg_temp.act_as('00000000-0000-0000-0000-0000000af201');
update ids set avl = (api.request_kuppi(pg_temp.mod(9894), 'AVL tree rotations', null, 'national') ->> 'id')::uuid;
update ids set heaps = (api.request_kuppi(pg_temp.mod(9894), 'Binary heaps', null, 'university') ->> 'id')::uuid;
update ids set graphs = (api.request_kuppi(pg_temp.mod(9894), 'Graph colouring', null, 'national') ->> 'id')::uuid;
select throws_ok($$ select api.request_kuppi(pg_temp.mod(9894), 'Tries', null, 'everyone') $$, '22023', null, 'the scope is checked');
select is((api.kuppi_requests('module', pg_temp.mod(9894)) -> 0 ->> 'other'), 'false', 'own requests are not from another university');

select pg_temp.act_as('00000000-0000-0000-0000-0000000af101');
select is((select count(*)::int from jsonb_array_elements(api.kuppi_requests('my_modules')) e where e ->> 'id' = (select avl::text from ids)), 1,
          'a request asked of all universities reaches the same subject elsewhere');
select is((select count(*)::int from jsonb_array_elements(api.kuppi_requests('module', pg_temp.mod(9893))) e where e ->> 'id' = (select avl::text from ids)), 1,
          'and shows on the module there');
select is((select e ->> 'institution' from jsonb_array_elements(api.kuppi_requests('my_modules')) e where e ->> 'id' = (select avl::text from ids)), 'TMU',
          'with the university it was asked at');
select is((select (e ->> 'host_module_id')::bigint from jsonb_array_elements(api.kuppi_requests('my_modules')) e where e ->> 'id' = (select avl::text from ids)),
          pg_temp.mod(9893), 'and the module to host an answer under');
select ok(not exists (select 1 from jsonb_array_elements(api.kuppi_requests('my_modules')) e
                      where e ? 'requester_id' or (e ->> 'mine')::boolean), 'never who asked');
select is((select count(*)::int from jsonb_array_elements(api.kuppi_requests('my_modules')) e where e ->> 'id' = (select heaps::text from ids)), 0,
          'a request for one university stays there');
select is(jsonb_array_length(api.kuppi_requests('all')), 0, 'the university list is the university''s own');
select throws_ok($$ select api.vote_kuppi_request((select heaps from ids), true) $$, 'P0002', null, 'nor can it be voted on elsewhere');

select is((api.vote_kuppi_request((select avl from ids), true) ->> 'votes'), '2', 'students elsewhere add their vote');
select is((api.vote_kuppi_request((select avl from ids), true) ->> 'universities'), '2', 'and it counts the universities that want it');
select pg_temp.act_as('00000000-0000-0000-0000-0000000af102');
select is((api.request_kuppi(pg_temp.mod(9893), 'AVL rotations') ->> 'merged'), 'true',
          'asking something similar elsewhere adds a vote instead of a duplicate');
select set_config('role', 'postgres', true);
select is((select votes from kuppi.requests where id = (select avl from ids)), 3, 'votes from every university add up');

select pg_temp.act_as('00000000-0000-0000-0000-0000000af301');
select is((select count(*)::int from jsonb_array_elements(api.kuppi_requests('my_modules')) e where e ->> 'id' = (select avl::text from ids)), 0,
          'students on other subjects do not see it');
select throws_ok($$ select api.vote_kuppi_request((select avl from ids), true) $$, 'P0002', null, 'or vote on it');
select throws_ok($$ select api.report_kuppi_request((select avl from ids), 'scam') $$, 'P0002', null, 'or report it');

select pg_temp.act_as('00000000-0000-0000-0000-0000000af101');
select lives_ok($$ select api.report_kuppi_request((select avl from ids), 'scam') $$, 'students elsewhere can report it');
select set_config('role', 'postgres', true);
select is((select institution_id from safety.reports where target_id = (select avl::text from ids)), 9894::bigint,
          'and the report goes to the university where it was asked');
delete from safety.reports where target_id = (select avl::text from ids);

-- ---------------------------------------------------------------- answering across universities
select pg_temp.act_as('00000000-0000-0000-0000-0000000af101');
select throws_ok($$ select api.create_kuppi(pg_temp.mod(9893), 'AVL trees', now() + interval '2 days', 60, 'in_person', 30,
                   null, 'Lab 3', null, (select avl from ids)) $$, '22023', null, 'an answer for another university is online');
update ids set k1 = (api.create_kuppi(pg_temp.mod(9893), 'AVL trees', now() + interval '2 days', 60, 'online', 30,
                     'https://meet.google.com/abc-defg-hij', null, null, (select avl from ids)) ->> 'id')::uuid;
select is((api.kuppi((select k1 from ids)) ->> 'scope'), 'national', 'and open to all universities');
select throws_ok($$ select api.create_kuppi(pg_temp.mod(9893), 'Hashing', now() + interval '2 days', 60, 'in_person', 30,
                   null, 'Lab 3', null, null, 'national') $$, '22023', null, 'a kuppi open to all universities is online');
update ids set k2 = (api.create_kuppi(pg_temp.mod(9893), 'Hashing', now() + interval '3 days', 60, 'online', 30,
                     'https://meet.google.com/abc-defg-hij') ->> 'id')::uuid;

select pg_temp.act_as('00000000-0000-0000-0000-0000000af201');
select is((select count(*)::int from jsonb_array_elements(api.kuppi_requests('my_modules')) e where e ->> 'id' = (select avl::text from ids)),
          0, 'an answered request leaves the list (the student who asked is notified)');
select is((select count(*)::int from jsonb_array_elements(api.kuppi_list('my_modules')) e where e ->> 'id' = (select k1::text from ids)), 1,
          'it shows with their modules');
select is((select e ->> 'institution' from jsonb_array_elements(api.kuppi_list('module', pg_temp.mod(9894))) e where e ->> 'id' = (select k1::text from ids)), 'TRU',
          'and on the module, with the host''s university');
select is((api.rsvp((select k1 from ids)) ->> 'rsvped'), 'true', 'they can RSVP');
select ok((api.kuppi((select k1 from ids)) ->> 'chat_id') is not null, 'and join its chat');
select throws_ok($$ select api.kuppi((select k2 from ids)) $$, 'P0002', null, 'a kuppi for one university stays there');

-- Slides in its chat go to each student's own module on the subject.
update ids set chat = (api.kuppi((select k1 from ids)) ->> 'chat_id')::uuid;
select pg_temp.act_as('00000000-0000-0000-0000-0000000af101');
update ids set slides = pg_temp.send_file((select chat from ids), 'AVL slides.pdf');
select is(jsonb_array_length(api.library(pg_temp.mod(9893)) -> 'items'), 1, 'the host''s slides go to their module');
select pg_temp.act_as('00000000-0000-0000-0000-0000000af201');
select is(jsonb_array_length(api.library(pg_temp.mod(9894)) -> 'items'), 1, 'and to the module of students from other universities');
select is((select (e ->> 'count')::int from jsonb_array_elements(api.library_overview() -> 'modules') e
           where (e ->> 'module_id')::bigint = pg_temp.mod(9894)), 1, 'counted on their Resources tab');
select is((api.chat_folders((select chat from ids), array[(select slides from ids)]) -> 0 ->> 'code'), 'CO222',
          'and tagged with their own module in the chat');

-- Answered at the asker's own university in person: it leaves the list for everyone.
select api.create_kuppi(pg_temp.mod(9894), 'Graph colouring', now() + interval '2 days', 60, 'in_person', 30,
                        null, 'Hall B', null, (select graphs from ids));
select pg_temp.act_as('00000000-0000-0000-0000-0000000af101');
select is((select count(*)::int from jsonb_array_elements(api.kuppi_requests('my_modules')) e
           where e ->> 'id' = (select graphs::text from ids)), 0, 'others no longer see it either');

select pg_temp.act_as('00000000-0000-0000-0000-0000000af301');
select is((select count(*)::int from jsonb_array_elements(api.kuppi_list('my_modules')) e where e ->> 'id' = (select k1::text from ids)), 0,
          'kuppi on other subjects are not listed');

select * from finish();
rollback;
