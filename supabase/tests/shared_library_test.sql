-- Shared library and file checks: who may publish (the sender, or a rep for batch-group files),
-- pending until checked, live at the university only, quarantine, removal, reports, upload bans,
-- blocked chat files, and searching the library.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(30);

insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9861, 'Test Kappa University', 'TKU', 'state', 'live'),
  (9862, 'Test Lambda University', 'TLU', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('kappa.test', 9861), ('lambda.test', 9862);

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
create function pg_temp.mod() returns bigint language sql as $$
  select id from academics.modules where institution_id = 9861 and code_key = 'CS2012';
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

-- r: rep. a, b: students. l: Lambda student.
select pg_temp.make_user('00000000-0000-0000-0000-0000000ab101', '2025ss001@kappa.test', 'Rasika Rep');
select pg_temp.make_user('00000000-0000-0000-0000-0000000ab102', '2025ss002@kappa.test', 'Ayesha A');
select pg_temp.make_user('00000000-0000-0000-0000-0000000ab103', '2025ss003@kappa.test', 'Buddhi B');
select pg_temp.make_user('00000000-0000-0000-0000-0000000ab201', '2025ss001@lambda.test', 'Lahiru L');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ab101');
select api.join_batch(null, 'BSc in Sharing Studies', 2025);
select pg_temp.act_as('00000000-0000-0000-0000-0000000ab102');
select api.join_batch((select id from academics.programmes where institution_id = 9861), null, 2025);
select pg_temp.act_as('00000000-0000-0000-0000-0000000ab103');
select api.join_batch((select id from academics.programmes where institution_id = 9861), null, 2025);
select pg_temp.act_as('00000000-0000-0000-0000-0000000ab201');
select api.join_batch(null, 'BSc in Sharing Studies', 2025);
select set_config('role', 'postgres', true);
update messaging.conversation_members set role = 'admin'
where user_id = '00000000-0000-0000-0000-0000000ab101'
  and conversation_id = (select c.id from messaging.conversations c join academics.cohort_members m on m.cohort_id = c.cohort_id
                         where m.user_id = '00000000-0000-0000-0000-0000000ab101');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ab101');
select api.save_semester(1, 1, '[{"code": "CS2012", "name": "Data Structures"}]');
select api.set_batch_term(1, 1);
select set_config('role', 'postgres', true);

create temp table ids (batch uuid, a_file uuid, b_file uuid, bad_file uuid, res uuid, res2 uuid, key text, a_path text, bad_path text);
insert into ids default values;
grant all on pg_temp.ids to public;
update ids set batch = (select c.id from messaging.conversations c join academics.cohort_members m on m.cohort_id = c.cohort_id
                        where m.user_id = '00000000-0000-0000-0000-0000000ab101');

select pg_temp.act_as('00000000-0000-0000-0000-0000000ab102');
update ids set a_file = pg_temp.send_file((select batch from ids), 'CS2012 Past Paper 2023.pdf');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ab103');
update ids set b_file = pg_temp.send_file((select batch from ids), 'CS2012 Notes by B.pdf');
update ids set bad_file = pg_temp.send_file((select batch from ids), 'CS2012 totally safe.pdf');
select set_config('role', 'postgres', true);
update ids set a_path = (select path from content.chat_items where message_id = ids.a_file),
  bad_path = (select path from content.chat_items where message_id = ids.bad_file);

-- ---------------------------------------------------------------- the library offers sharing
select pg_temp.act_as('00000000-0000-0000-0000-0000000ab102');
select is((select (x ->> 'can_share') from jsonb_array_elements(api.library(pg_temp.mod()) -> 'items') x
           where x ->> 'id' = (select a_file::text from ids)), 'true', 'the sender may share their file');
select is((select (x ->> 'can_share') from jsonb_array_elements(api.library(pg_temp.mod()) -> 'items') x
           where x ->> 'id' = (select b_file::text from ids)), 'false', 'but not someone else''s');
select is(jsonb_array_length(api.library_search('past paper')), 1, 'the library can be searched by name');
select is(jsonb_array_length(api.library_search('CS2012')), 3, 'and by module code');

-- ---------------------------------------------------------------- publishing
select throws_ok($$ select api.begin_publish((select b_file from ids), pg_temp.mod(), 'notes') $$, '42501', null,
  'students cannot publish others'' files');
update ids set res = (api.begin_publish((select a_file from ids), pg_temp.mod(), 'past_papers', null, 2023) ->> 'resource_id')::uuid;
select throws_ok($$ select api.begin_publish((select a_file from ids), pg_temp.mod(), 'past_papers') $$, '22023', null,
  'a file is shared once');
select set_config('role', 'postgres', true);
update ids set key = (select storage_key from content.resources where id = ids.res);
select is((select title from content.resources where id = (select res from ids)), 'CS2012 Past Paper 2023',
  'the name comes from the file, without its extension');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ab103');
select is(jsonb_array_length(api.explore(pg_temp.mod())), 0, 'nothing is shown before it is checked');
select is((select count(*)::int from api.media_access(array[(select key from ids)])), 0, 'nor can it be opened');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ab102');
select is((select count(*)::int from api.media_access(array[(select key from ids)])), 1, 'the uploader can open it while it waits');
select is((api.explore_overview() -> 'mine' -> 0 ->> 'status'), 'pending', 'and sees it waiting');
select ok(api.pending_resource((select res from ids)) is not null, 'the files function can find it with the uploader''s token');

select set_config('role', 'postgres', true);
select api.finish_resource((select res from ids), true, null, 1000);
select pg_temp.act_as('00000000-0000-0000-0000-0000000ab103');
select is((api.explore(pg_temp.mod()) -> 0 ->> 'title'), 'CS2012 Past Paper 2023', 'once checked it is live for the university');
select is((select count(*)::int from api.media_access(array[(select key from ids)])), 1, 'and can be opened');
select is(jsonb_array_length(api.explore(null, 'past_papers', 'CS20')), 1, 'Explore searches by module code');
select is((api.explore_overview() -> 'modules' -> 0 ->> 'count'), '1', 'module counts include it');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ab201');
select is(jsonb_array_length(api.explore()), 0, 'another university does not see it');
select is((select count(*)::int from api.media_access(array[(select key from ids)])), 0, 'or open it');

-- A rep can share batch-group files; a quarantined file stays hidden with its reason.
select pg_temp.act_as('00000000-0000-0000-0000-0000000ab101');
update ids set res2 = (api.begin_publish((select b_file from ids), pg_temp.mod(), 'notes') ->> 'resource_id')::uuid;
select throws_ok($$ select count(*) from content.resources $$, '42501', null, 'shared files are not readable directly');
select set_config('role', 'postgres', true);
select is((select published_as from content.resources where id = (select res2 from ids)), 'rep', 'a rep can share batch-group files');
select api.finish_resource((select res2 from ids), false, 'This PDF runs scripts.');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ab101');
select is((api.explore_overview() -> 'mine' -> 0 ->> 'check_reason'), 'This PDF runs scripts.', 'the uploader sees why it was not shared');
select is(jsonb_array_length(api.explore(pg_temp.mod())), 1, 'and nobody sees it');

-- ---------------------------------------------------------------- uploads, reports, removal, bans
select throws_ok($$ select api.begin_resource_upload(pg_temp.mod(), 'notes', 'Lab sheet', 'application/zip', 1000) $$, '22023', null,
  'only PDF, Word, PowerPoint and photos can be shared');
select lives_ok($$ select api.report_resource((select res from ids), 'copyright', 'from the lecturer''s textbook') $$,
  'a shared file can be reported');
select throws_ok($$ select api.remove_resource((select res from ids)) $$, '42501', null, 'only the uploader or a moderator removes it');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ab102');
select api.remove_resource((select res from ids));
select is(jsonb_array_length(api.explore(pg_temp.mod())), 0, 'the uploader can take it down');
select set_config('role', 'postgres', true);
insert into content.upload_bans (user_id, reason) values ('00000000-0000-0000-0000-0000000ab102', 'Repeat copyright');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ab102');
select throws_ok($$ select api.begin_resource_upload(pg_temp.mod(), 'notes', 'More notes', 'application/pdf', 1000) $$, '42501', null,
  'a banned student cannot share');

-- ---------------------------------------------------------------- blocked chat files
select set_config('role', 'postgres', true);
select api.chat_file_checked((select bad_file from ids), false, 'This PDF runs scripts.');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ab102');
select is((select count(*)::int from api.media_access(array[(select bad_path from ids)])), 0, 'a blocked chat file cannot be opened');
select ok(not exists (select 1 from jsonb_array_elements(api.library(pg_temp.mod()) -> 'items') x
                      where x ->> 'id' = (select bad_file::text from ids)), 'and leaves the library');
select set_config('role', 'postgres', true);
select is((select attachment ->> 'blocked' from messaging.messages where id = (select bad_file from ids)), 'true',
  'the message says it was blocked');

select * from finish();
rollback;
