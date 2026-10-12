-- Library: files and links from chats filed into each student's module folders. Guessing,
-- folders by code and by chat, To sort, moving, tagging, hiding, deleting, blocking, keeping saved
-- files after leaving a chat, and nobody outside the chat seeing anything.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(50);

-- ---------------------------------------------------------------- guessing
select is(content.module_codes('CS2012_Lec03 and ma-1013.pdf'), array['CS2012', 'MA1013'], 'module codes are found and normalised');
select is(content.module_codes('Week 10 notes.pdf'), '{}'::text[], 'week numbers are not codes');
select is(content.guess_category('file', 'application/pdf', 'Week 2 notes.pdf', null), 'notes', 'notes beat weak signs of slides');
select is(content.guess_category('file', 'application/pdf', 'CS2012 Past Paper 2021.pdf', null), 'past_papers', 'past papers');
select is(content.guess_category('file', 'application/pdf', 'CS2012_Lec05_Trees.pdf', null), 'slides', 'lecture slides');
select is(content.guess_category('file', 'application/pdf', 'Tutorial 3 answers.pdf', null), 'tutorials', 'tutorials');
select is(content.guess_category('file', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'Trees.pptx', null),
  'slides', 'PowerPoint is slides');
select is(content.guess_category('link', null, 'AVL trees', 'https://youtu.be/abc'), 'videos', 'YouTube is videos');
select is(content.guess_category('file', 'application/pdf', 'random.pdf', null), 'other', 'nothing to go on: other');
select ok(content.is_study_link('https://lms.cmb.ac.lk/course/view.php?id=4'), 'university sites are study links');
select ok(not content.is_study_link('https://www.instagram.com/p/xyz'), 'social media is not');

-- ---------------------------------------------------------------- fixtures
insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9841, 'Test Chi University', 'TCU', 'state', 'live'),
  (9842, 'Test Psi University', 'TPS', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('chi.test', 9841), ('psi.test', 9842);

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
  select id from academics.modules where institution_id = 9841 and code_key = p_code;
$$;
-- Sends a document as the current student (the upload is recorded first, as the media function does).
create function pg_temp.send_file(p_conversation uuid, p_name text, p_mime text default 'application/pdf') returns uuid language plpgsql as $$
declare
  v_path text := 'chat/' || p_conversation || '/' || gen_random_uuid() || '.pdf';
  v_uid uuid := (current_setting('request.jwt.claims')::jsonb ->> 'sub')::uuid;
begin
  perform set_config('role', 'postgres', true);
  insert into messaging.uploads (path, user_id, conversation_id, kind, mime, size) values (v_path, v_uid, p_conversation, 'file', p_mime, 1000);
  perform set_config('role', 'authenticated', true);
  return (api.send_message(p_conversation, ops.uuid_v7(), '', null, 'file', jsonb_build_object('path', v_path, 'name', p_name)) ->> 'id')::uuid;
end $$;
create function pg_temp.send_image(p_conversation uuid) returns uuid language plpgsql as $$
declare
  v_path text := 'chat/' || p_conversation || '/' || gen_random_uuid() || '.jpg';
  v_uid uuid := (current_setting('request.jwt.claims')::jsonb ->> 'sub')::uuid;
begin
  perform set_config('role', 'postgres', true);
  insert into messaging.uploads (path, user_id, conversation_id, kind, mime, size) values (v_path, v_uid, p_conversation, 'image', 'image/jpeg', 1000);
  perform set_config('role', 'authenticated', true);
  return (api.send_message(p_conversation, ops.uuid_v7(), 'whiteboard', null, 'image',
    jsonb_build_object('path', v_path, 'width', 100, 'height', 100)) ->> 'id')::uuid;
end $$;
create function pg_temp.send_link(p_conversation uuid, p_url text, p_title text) returns uuid language sql as $$
  select (api.send_message(p_conversation, ops.uuid_v7(), 'look ' || p_url, null, 'text', null, null, null,
    jsonb_build_object('url', p_url, 'title', p_title)) ->> 'id')::uuid;
$$;
-- Titles in one of the caller's module folders.
create function pg_temp.folder(p_code text) returns text[] language sql as $$
  select coalesce(array_agg(x ->> 'title' order by x ->> 'title'), '{}')
  from jsonb_array_elements(api.library(pg_temp.mod(p_code)) -> 'items') x;
$$;

-- r1 (rep), s2, s3: the 2025 batch at Chi. x1: Chi student in another batch. t1: Psi student.
select pg_temp.make_user('00000000-0000-0000-0000-00000000e101', '2025ll001@chi.test', 'Ruwan Rep');
select pg_temp.make_user('00000000-0000-0000-0000-00000000e102', '2025ll002@chi.test', 'Sithmi Two');
select pg_temp.make_user('00000000-0000-0000-0000-00000000e103', '2025ll003@chi.test', 'Sandun Three');
select pg_temp.make_user('00000000-0000-0000-0000-00000000e104', '2024zz001@chi.test', 'Xavier Other');
select pg_temp.make_user('00000000-0000-0000-0000-00000000e201', '2025ll001@psi.test', 'Tharu Psi');
select pg_temp.act_as('00000000-0000-0000-0000-00000000e101');
select api.join_batch(null, 'BSc in Library Studies', 2025);
select pg_temp.act_as('00000000-0000-0000-0000-00000000e102');
select api.join_batch((select id from academics.programmes where institution_id = 9841), null, 2025);
select pg_temp.act_as('00000000-0000-0000-0000-00000000e103');
select api.join_batch((select id from academics.programmes where institution_id = 9841), null, 2025);
select pg_temp.act_as('00000000-0000-0000-0000-00000000e104');
select api.join_batch(null, 'BSc in Other Studies', 2024);
select pg_temp.act_as('00000000-0000-0000-0000-00000000e201');
select api.join_batch(null, 'BSc in Library Studies', 2025);
select set_config('role', 'postgres', true);
update messaging.conversation_members set role = 'admin'
where user_id = '00000000-0000-0000-0000-00000000e101'
  and conversation_id = (select c.id from messaging.conversations c join academics.cohort_members m on m.cohort_id = c.cohort_id
                         where m.user_id = '00000000-0000-0000-0000-00000000e101');

select pg_temp.act_as('00000000-0000-0000-0000-00000000e101');
select api.save_semester(1, 1, '[{"code": "CS2012", "name": "Data Structures"}, {"code": "MA1013", "name": "Calculus"}]');
select api.set_batch_term(1, 1);
select set_config('role', 'postgres', true);

create temp table ids (batch uuid, course uuid, dm uuid, lec uuid, paper uuid, video uuid, insta uuid, photo uuid, tute uuid, notes uuid, random uuid, tute_path text, notes_path text);
grant all on pg_temp.ids to public;
insert into ids (batch, course) values (
  (select c.id from messaging.conversations c join academics.cohort_members m on m.cohort_id = c.cohort_id
   where m.user_id = '00000000-0000-0000-0000-00000000e101'),
  (select id from messaging.conversations where module_id = pg_temp.mod('CS2012') and module_intake = 2025));

-- ---------------------------------------------------------------- sharing
select pg_temp.act_as('00000000-0000-0000-0000-00000000e102');
update ids set lec = pg_temp.send_file((select batch from ids), 'CS2012_Lec05_Trees.pdf');
update ids set paper = pg_temp.send_file((select batch from ids), 'Past paper 2022.pdf');
update ids set video = pg_temp.send_link((select batch from ids), 'https://youtu.be/avl', 'AVL trees explained CS2012');
update ids set insta = pg_temp.send_link((select batch from ids), 'https://www.instagram.com/p/xyz', 'party CS2012');
update ids set photo = pg_temp.send_image((select batch from ids));
update ids set dm = (api.start_direct('00000000-0000-0000-0000-00000000e103') ->> 'conversation_id')::uuid;
update ids set random = pg_temp.send_file((select dm from ids), 'random.pdf');
select pg_temp.act_as('00000000-0000-0000-0000-00000000e103');
update ids set tute = pg_temp.send_file((select course from ids), 'Tutorial 3.pdf');
update ids set notes = pg_temp.send_file((select course from ids), 'Week 2 notes.pdf');

select set_config('role', 'postgres', true);
update ids set tute_path = (select path from content.chat_items where message_id = ids.tute),
  notes_path = (select path from content.chat_items where message_id = ids.notes);
select is((select count(*)::int from content.chat_items i join ids on true
           where i.message_id in (ids.lec, ids.paper, ids.video, ids.insta, ids.photo, ids.random, ids.tute, ids.notes)), 8,
  'every document, photo and link is recorded once');
select is((select paper_year::int from content.chat_items where message_id = (select paper from ids)), 2022, 'a past paper keeps its year');
select is((select module_source from content.chat_items where message_id = (select tute from ids)), 'chat',
  'a course chat files into its module');

-- ---------------------------------------------------------------- folders
select pg_temp.act_as('00000000-0000-0000-0000-00000000e101');
select is(pg_temp.folder('CS2012'), array['AVL trees explained CS2012', 'CS2012_Lec05_Trees.pdf', 'Tutorial 3.pdf', 'Week 2 notes.pdf'],
  'the module folder holds coded files from the batch group and everything from the course chat');
select is((select x ->> 'count' from jsonb_array_elements(api.library(pg_temp.mod('CS2012')) -> 'folders') x
           where x ->> 'category' = 'slides'), '1', 'with a count per category');
select is(jsonb_array_length(api.library(pg_temp.mod('CS2012'), 'videos') -> 'items'), 1, 'a category can be opened on its own');
select is((select x ->> 'count' from jsonb_array_elements(api.library_overview() -> 'modules') x
           where (x ->> 'module_id')::bigint = pg_temp.mod('CS2012')), '4', 'the overview counts each module');
select is((api.library_overview() ->> 'to_sort')::int, 1, 'the uncoded past paper waits in To sort');
select is((api.library_to_sort() -> 0 ->> 'title'), 'Past paper 2022.pdf', 'To sort lists it');
select ok(not (pg_temp.folder('CS2012') @> array['party CS2012']), 'social links do not file themselves');
select is((api.library_item((select photo from ids)) ->> 'in_library'), 'false', 'nor do photos in a batch group');
select pg_temp.act_as('00000000-0000-0000-0000-00000000e103');
select is((api.library_overview() ->> 'to_sort')::int, 2, 'a document in a direct message files itself (To sort here)');
select pg_temp.act_as('00000000-0000-0000-0000-00000000e101');
select is((api.library_overview() ->> 'to_sort')::int, 1, 'and nobody else sees it');

-- ---------------------------------------------------------------- organising
select api.organise_item((select paper from ids), pg_temp.mod('CS2012'));
select ok(pg_temp.folder('CS2012') @> array['Past paper 2022.pdf'], 'filing from To sort moves it into the module');
select is((api.library_overview() ->> 'to_sort')::int, 0, 'and out of To sort');
select is((select x ->> 'count' from jsonb_array_elements(api.library(pg_temp.mod('CS2012')) -> 'folders') x
           where x ->> 'category' = 'past_papers'), '1', 'into its guessed category');
select pg_temp.act_as('00000000-0000-0000-0000-00000000e102');
select is((api.library_overview() ->> 'to_sort')::int, 2, 'one student''s filing is theirs alone (the sender still has both)');

select pg_temp.act_as('00000000-0000-0000-0000-00000000e101');
select api.organise_item((select photo from ids), pg_temp.mod('MA1013'));
select ok(pg_temp.folder('MA1013') @> array['whiteboard'], 'a photo can be saved into a module with one tap');
select api.organise_item((select lec from ids), null, null, true);
select is(jsonb_array_length(api.library(pg_temp.mod('CS2012')) -> 'pinned'), 1, 'pinned items show first');
select api.organise_item((select video from ids), null, 'links');
select is(jsonb_array_length(api.library(pg_temp.mod('CS2012'), 'links') -> 'items'), 1, 'an item can change category');
select api.organise_item((select notes from ids), null, null, null, true);
select ok(not (pg_temp.folder('CS2012') @> array['Week 2 notes.pdf']), 'hidden items leave the student''s library');
select pg_temp.act_as('00000000-0000-0000-0000-00000000e103');
select ok(pg_temp.folder('CS2012') @> array['Week 2 notes.pdf'], 'but not anyone else''s');

-- ---------------------------------------------------------------- tagging for everyone
select throws_ok($$ select api.tag_item((select paper from ids), pg_temp.mod('MA1013')) $$, '42501', null,
  'only the sender or a rep files an item for everyone');
select pg_temp.act_as('00000000-0000-0000-0000-00000000e102');
select lives_ok($$ select api.tag_item((select paper from ids), pg_temp.mod('MA1013')) $$, 'the sender can');
select pg_temp.act_as('00000000-0000-0000-0000-00000000e103');
select ok(pg_temp.folder('MA1013') @> array['Past paper 2022.pdf'], 'a tag files it for batchmates');
select pg_temp.act_as('00000000-0000-0000-0000-00000000e101');
select ok(pg_temp.folder('CS2012') @> array['Past paper 2022.pdf'], 'a student''s own filing still wins for them');

-- ---------------------------------------------------------------- deleting and blocking
select pg_temp.act_as('00000000-0000-0000-0000-00000000e103');
select api.delete_message((select batch from ids), (select video from ids), false);
select ok(not (pg_temp.folder('CS2012') @> array['AVL trees explained CS2012']), 'deleted for me: gone from my library');
select api.block_user('00000000-0000-0000-0000-00000000e102');
select ok(not (pg_temp.folder('CS2012') @> array['CS2012_Lec05_Trees.pdf']), 'files from a blocked student are not shown');
select pg_temp.act_as('00000000-0000-0000-0000-00000000e102');
select api.delete_message((select batch from ids), (select lec from ids), true);
select pg_temp.act_as('00000000-0000-0000-0000-00000000e101');
select ok(not (pg_temp.folder('CS2012') @> array['CS2012_Lec05_Trees.pdf']), 'deleted for everyone: gone, even if saved and pinned');

-- ---------------------------------------------------------------- keeping saved files after leaving a chat
select api.organise_item((select tute from ids), null, null, true);
select api.set_module_choice(pg_temp.mod('CS2012'), 'not_taking');
select ok(not messaging.is_member((select course from ids)), 'not taking the module leaves its course chat');
select is((select count(*)::int from api.media_access(array[(select tute_path from ids)])), 1,
  'a saved file can still be opened');
select is((select count(*)::int from api.media_access(array[(select notes_path from ids)])), 0,
  'a file that was only hidden cannot');
select ok(pg_temp.folder('CS2012') @> array['Tutorial 3.pdf'], 'and the saved file stays in the folder');

-- ---------------------------------------------------------------- outsiders
select pg_temp.act_as('00000000-0000-0000-0000-00000000e104');
select is(pg_temp.folder('CS2012'), '{}'::text[], 'a student at the same university outside these chats sees nothing');
select throws_ok($$ select api.organise_item((select paper from ids), pg_temp.mod('CS2012')) $$, '22023', null,
  'and cannot save from them');
select is(api.library_item((select paper from ids)), null, 'or look an item up');
select pg_temp.act_as('00000000-0000-0000-0000-00000000e201');
select throws_ok($$ select api.library(pg_temp.mod('CS2012')) $$, '22023', null, 'another university''s module folders are closed');
select throws_ok($$ select count(*) from content.chat_items $$, '42501', null, 'items are not readable directly');
select throws_ok($$ select count(*) from content.library_items $$, '42501', null, 'nor are students'' changes');

select * from finish();
rollback;
