-- Shared files, second round: subjects across universities, duplicates by fingerprint, search inside
-- files, national sharing only when chosen, and past-paper discussions.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(32);

select is(academics.subject_name('Data Structures and Algorithms II'), 'Data Structures and Algorithms', 'levels are not part of a subject');
select is(academics.subject_name('Calculus I (Engineering)'), 'Calculus', 'nor notes in brackets');

insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9891, 'Test Iota University', 'TIU', 'state', 'live'),
  (9892, 'Test Nu University', 'TNU', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('iota.test', 9891), ('nu.test', 9892);

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
create function pg_temp.mod(p_inst bigint) returns bigint language sql as $$
  select id from academics.modules where institution_id = p_inst order by id limit 1;
$$;
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

-- a (rep), b: Iota 2025 batch. n: Nu student taking a module of the same subject.
select pg_temp.make_user('00000000-0000-0000-0000-0000000ae101', '2025ii001@iota.test', 'Amaya A');
select pg_temp.make_user('00000000-0000-0000-0000-0000000ae102', '2025ii002@iota.test', 'Binu B');
select pg_temp.make_user('00000000-0000-0000-0000-0000000ae201', '2025nn001@nu.test', 'Nimesh N');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ae101');
select api.join_batch(null, 'BSc in Iota Computing', 2025);
select api.set_batch_term(1, 1);
select api.save_semester(1, 1, '[{"code": "CS2012", "name": "Data Structures and Algorithms"}]');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ae102');
select api.join_batch((select id from academics.programmes where institution_id = 9891), null, 2025);
select pg_temp.act_as('00000000-0000-0000-0000-0000000ae201');
select api.join_batch(null, 'BSc in Nu Computing', 2025);
select api.set_batch_term(1, 1);
select api.save_semester(1, 1, '[{"code": "CO222", "name": "Data Structures and Algorithms II"}]');
select set_config('role', 'postgres', true);

create temp table ids (batch uuid, a1 uuid, a2 uuid, r1 uuid, r2 uuid, r3 uuid, c1 uuid, key1 text, key3 text, sha text);
insert into ids default values;
grant all on pg_temp.ids to public;
update ids set batch = (select c.id from messaging.conversations c join academics.cohort_members m on m.cohort_id = c.cohort_id
                        where m.user_id = '00000000-0000-0000-0000-0000000ae101'),
  sha = repeat('ab', 32);

select is((select subject_id from academics.modules where id = pg_temp.mod(9891)),
          (select subject_id from academics.modules where id = pg_temp.mod(9892)), 'the same subject at two universities is one subject');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ae201');
select is((api.module_subject(pg_temp.mod(9892)) ->> 'universities'), '2', 'a module knows how many universities teach its subject');

-- ---------------------------------------------------------------- duplicates and text
select pg_temp.act_as('00000000-0000-0000-0000-0000000ae101');
update ids set a1 = pg_temp.send_file((select batch from ids), 'CS2012 notes.pdf');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ae102');
update ids set a2 = pg_temp.send_file((select batch from ids), 'CS2012 notes (1).pdf');
select set_config('role', 'postgres', true);
select api.chat_file_checked((select a1 from ids), true, null, (select sha from ids));
select api.chat_file_checked((select a2 from ids), true, null, (select sha from ids));
select api.store_file_text((select sha from ids), 'Lecture 7. Dijkstra shortest path algorithm with a priority queue.');
select is(api.needs_text((select sha from ids)), false, 'text is stored once per fingerprint');

select pg_temp.act_as('00000000-0000-0000-0000-0000000ae102');
select is(jsonb_array_length(api.library(pg_temp.mod(9891)) -> 'items'), 1, 'the same file posted twice shows once');
select is(jsonb_array_length(api.library_search('dijkstra')), 1, 'search finds words inside files');
select ok((api.library_search('dijkstra') -> 0 ->> 'snippet') like '%«Dijkstra»%', 'and shows the matching line');

-- ---------------------------------------------------------------- publishing, duplicates, national
select pg_temp.act_as('00000000-0000-0000-0000-0000000ae101');
update ids set r1 = (api.begin_publish((select a1 from ids), pg_temp.mod(9891), 'notes') ->> 'resource_id')::uuid;
select set_config('role', 'postgres', true);
select api.finish_resource((select r1 from ids), true, null, 1000, (select sha from ids));
update ids set key1 = (select storage_key from content.resources where id = ids.r1);
select pg_temp.act_as('00000000-0000-0000-0000-0000000ae102');
select throws_ok($$ select api.begin_publish((select a2 from ids), pg_temp.mod(9891), 'notes') $$, '22023', null,
  'the same content cannot be shared again from another copy');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ae101');
update ids set r2 = (api.begin_resource_upload(pg_temp.mod(9891), 'notes', 'Same notes again', 'application/pdf', 1000) ->> 'resource_id')::uuid;
select set_config('role', 'postgres', true);
select is((api.finish_resource((select r2 from ids), true, null, 1000, (select sha from ids)) ->> 'status'), 'duplicate',
  'a file already shared at the university is a duplicate');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ae101');
select ok((api.explore_overview() -> 'mine' -> 0 ->> 'check_reason') like 'Already shared as%', 'the uploader is told which one to use');
select is(jsonb_array_length(api.explore(null, null, 'dijkstra')), 1, 'Explore searches inside files too');
select is((api.explore(pg_temp.mod(9891)) -> 0 ->> 'scope'), 'university', 'files are shared with the university by default');

select pg_temp.act_as('00000000-0000-0000-0000-0000000ae201');
select is(jsonb_array_length(api.explore(pg_temp.mod(9892), null, null, null, 40, true)), 0,
  'other universities do not see files shared only with a university');
select is((select count(*)::int from api.media_access(array[(select key1 from ids)])), 0, 'nor open them');
select throws_ok($$ select api.resource((select r1 from ids)) $$, 'P0002', null, 'nor read their discussion');

select pg_temp.act_as('00000000-0000-0000-0000-0000000ae101');
update ids set r3 = (api.begin_resource_upload(pg_temp.mod(9891), 'past_papers', 'CS2012 Paper 2024', 'application/pdf', 2000, 2024, 'national')
                     ->> 'resource_id')::uuid;
select set_config('role', 'postgres', true);
select api.finish_resource((select r3 from ids), true, null, 2000, repeat('cd', 32));
update ids set key3 = (select storage_key from content.resources where id = ids.r3);
select pg_temp.act_as('00000000-0000-0000-0000-0000000ae201');
select is((api.explore(pg_temp.mod(9892), null, null, null, 40, true) -> 0 ->> 'institution'), 'TIU',
  'a file shared with all universities reaches the same subject elsewhere, with its university');
select is((select count(*)::int from api.media_access(array[(select key3 from ids)])), 1, 'and opens');
select is(jsonb_array_length(api.explore(pg_temp.mod(9892))), 0, 'it is not listed as the other university''s own');
select is((api.module_subject(pg_temp.mod(9892)) ->> 'national_files'), '1', 'the module counts files from other universities');

-- ---------------------------------------------------------------- discussions
select pg_temp.act_as('00000000-0000-0000-0000-0000000ae102');
update ids set c1 = (api.add_comment((select r1 from ids), 'Q3 is about heaps: use a min-heap.', 'q3') ->> 'id')::uuid;
select is((api.resource((select r1 from ids)) -> 'questions' -> 0 ->> 'question'), 'Q3', 'answers are grouped by question');
select throws_ok($$ select api.vote_comment((select c1 from ids), true) $$, '22023', null, 'students cannot vote for their own answers');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ae101');
select is((api.vote_comment((select c1 from ids), true) ->> 'votes'), '1', 'helpful votes count');
select api.add_comment((select r1 from ids), 'Thanks, that helped.', null, (select c1 from ids));
select is((api.comments((select r1 from ids), 'Q3') -> 0 -> 'replies' -> 0 ->> 'body'), 'Thanks, that helped.', 'replies sit under the answer');
select is((api.resource((select r1 from ids)) ->> 'comment_count'), '2', 'files count their comments');
select throws_ok($$ select api.delete_comment((select c1 from ids)) $$, '42501', null, 'only the author (or a moderator) deletes');
select lives_ok($$ select api.report_comment((select c1 from ids), 'harassment') $$, 'comments can be reported');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ae201');
select throws_ok($$ select api.add_comment((select r1 from ids), 'hello') $$, 'P0002', null,
  'students elsewhere cannot comment on a university-only file');
select lives_ok($$ select api.add_comment((select r3 from ids), 'Q1 answer from Nu', 'Q1') $$, 'but can discuss a file shared with everyone');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ae101');
select api.block_user('00000000-0000-0000-0000-0000000ae201');
select is(jsonb_array_length(api.comments((select r3 from ids))), 0, 'comments by blocked students are hidden');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ae102');
select api.delete_comment((select c1 from ids));
select is((api.comments((select r1 from ids), 'Q3') -> 0 ->> 'deleted'), 'true', 'deleted answers keep their replies, without the text');
select throws_ok($$ select count(*) from content.comments $$, '42501', null, 'comments are not readable directly');

select * from finish();
rollback;
