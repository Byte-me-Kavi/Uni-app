-- Rich messages: uploads, photos, documents, stickers, polls and contacts.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(26);

-- ---------------------------------------------------------------- fixtures
insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9801, 'Test Xi University', 'TXU', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('xi.test', 9801);

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
create function pg_temp.post(p_conversation uuid, p_kind text, p_attachment jsonb, p_body text default '') returns jsonb
language sql as $$
  select api.send_message(p_conversation, ops.uuid_v7(), p_body, null, p_kind, p_attachment);
$$;

select pg_temp.make_user('00000000-0000-0000-0000-0000000ee001', '2024ar001@xi.test', 'Hiruni Peris');
select pg_temp.make_user('00000000-0000-0000-0000-0000000ee002', '2024ar002@xi.test', 'Isuru Kumara');
select pg_temp.make_user('00000000-0000-0000-0000-0000000ee003', '2024ar003@xi.test', 'Janith Silva');

select pg_temp.act_as('00000000-0000-0000-0000-0000000ee001');
select api.join_batch(null, 'BSc in Rich Studies', 2024);
select pg_temp.act_as('00000000-0000-0000-0000-0000000ee002');
select api.join_batch((select id from academics.programmes where institution_id = 9801), null, 2024);
select set_config('role', 'postgres', true);

create temp table ids as select
  (select c.id from messaging.conversations c join academics.cohorts co on co.id = c.cohort_id
   join academics.programmes p on p.id = co.programme_id where p.institution_id = 9801) as chat;
grant all on pg_temp.ids to public;

-- ---------------------------------------------------------------- uploads
select pg_temp.act_as('00000000-0000-0000-0000-0000000ee001');
select throws_ok($$ select api.begin_chat_upload((select chat from ids), 'file', 'application/x-msdownload', 1000) $$,
  '22023', null, 'programs cannot be sent');
select throws_ok($$ select api.begin_chat_upload((select chat from ids), 'file', 'application/pdf', 30000000) $$,
  '22023', null, 'documents are 25 MB at most');
select matches(api.begin_chat_upload((select chat from ids), 'file', 'application/pdf', 120000) ->> 'path',
  '^chat/[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$', 'a document gets a path in this chat');
create temp table up as select
  (api.begin_chat_upload((select chat from ids), 'image', 'image/jpeg', 300000) ->> 'path') as photo, null::text as doc;
select set_config('role', 'postgres', true);
update pg_temp.up set doc = (select path from messaging.uploads where user_id = '00000000-0000-0000-0000-0000000ee001' and kind = 'file' limit 1);
grant all on pg_temp.up to public;

select pg_temp.act_as('00000000-0000-0000-0000-0000000ee003');
select throws_ok($$ select api.begin_chat_upload((select chat from ids), 'image', 'image/jpeg', 1000) $$,
  '42501', null, 'only members can upload to a chat');

select pg_temp.act_as('00000000-0000-0000-0000-0000000ee002');
select throws_ok($$ select pg_temp.post((select chat from ids), 'image',
  jsonb_build_object('path', (select photo from up), 'width', 800, 'height', 600)) $$,
  '22023', null, 'nobody can send someone else''s upload');

-- ---------------------------------------------------------------- photos and documents
select pg_temp.act_as('00000000-0000-0000-0000-0000000ee001');
select is(pg_temp.post((select chat from ids), 'image',
  jsonb_build_object('path', (select photo from up), 'width', 1600, 'height', 1200, 'thumb', 'data:image/jpeg;base64,AAAA'),
  'Board notes') -> 'attachment' ->> 'width', '1600', 'a photo is sent with its size');
select is((select last_message_preview from messaging.conversations where id = (select chat from ids)), 'Photo: Board notes',
  'the chat list says what it is');
select throws_ok($$ select pg_temp.post((select chat from ids), 'image',
  jsonb_build_object('path', (select photo from up), 'width', 1600, 'height', 1200)) $$,
  '22023', null, 'an upload is sent once');
select is(pg_temp.post((select chat from ids), 'file',
  jsonb_build_object('path', (select doc from up), 'name', 'Lecture 4.pdf')) -> 'attachment' ->> 'mime', 'application/pdf',
  'a document keeps its type from the upload');
select set_config('role', 'postgres', true);
select is((select message_id is not null from messaging.uploads where path = (select doc from up)), true,
  'the upload is linked to its message');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ee001');
select is((select last_message_preview from messaging.conversations where id = (select chat from ids)), 'Document: Lecture 4.pdf',
  'documents are named in the chat list');

-- ---------------------------------------------------------------- stickers
select is(pg_temp.post((select chat from ids), 'sticker', '{"pack": "fluent", "id": "party_popper"}') -> 'attachment' ->> 'id',
  'party_popper', 'a sticker is sent');
select throws_ok($$ select pg_temp.post((select chat from ids), 'sticker', '{"pack": "fluent", "id": "../evil"}') $$,
  '22023', null, 'sticker names are checked');

-- ---------------------------------------------------------------- polls
create temp table poll (id uuid);
grant all on pg_temp.poll to public;
select throws_ok($$ select pg_temp.post((select chat from ids), 'poll', '{"question": "Lab day?", "options": ["Mon"]}') $$,
  '22023', null, 'polls need two options');
select throws_ok($$ select pg_temp.post((select chat from ids), 'poll', '{"question": "Lab day?", "options": ["Mon", "mon"]}') $$,
  '22023', null, 'options must differ');
insert into pg_temp.poll select (pg_temp.post((select chat from ids), 'poll',
  '{"question": "Which day for the kuppi?", "options": ["Monday", "Wednesday", "Friday"]}') ->> 'id')::uuid;
select is((select last_message_preview from messaging.conversations where id = (select chat from ids)),
  'Poll: Which day for the kuppi?', 'polls show their question in the list');

select is(api.vote_poll((select chat from ids), (select id from poll), '{1}') -> 'counts', '[0, 1, 0]'::jsonb, 'a vote counts');
select throws_ok($$ select api.vote_poll((select chat from ids), (select id from poll), '{0,2}') $$,
  '22023', null, 'one answer unless the poll allows more');
select throws_ok($$ select api.vote_poll((select chat from ids), (select id from poll), '{5}') $$,
  '22023', null, 'options outside the poll are refused');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ee002');
select api.vote_poll((select chat from ids), (select id from poll), '{1}');
select is(api.vote_poll((select chat from ids), (select id from poll), '{2}') ->> 'voters', '2', 'changing a vote keeps one vote per student');
select is((select counts from api.poll_results((select chat from ids), array[(select id from poll)])), '[0, 1, 1]'::jsonb,
  'results reflect the change');
select is((select mine from api.poll_results((select chat from ids), array[(select id from poll)])), '{2}'::smallint[],
  'results include your own choice');
select is(api.vote_poll((select chat from ids), (select id from poll), '{}') ->> 'voters', '1', 'a vote can be taken back');

-- ---------------------------------------------------------------- contacts
select is(pg_temp.post((select chat from ids), 'contact',
  '{"type": "student", "user_id": "00000000-0000-0000-0000-0000000ee003", "name": "Fake Name"}') -> 'attachment' ->> 'name',
  'Janith Silva', 'a shared student shows their real name, not what the sender typed');
select is(pg_temp.post((select chat from ids), 'contact',
  '{"type": "phone", "name": "Canteen", "phones": [{"label": "mobile", "number": "+94 77 123 4567"}]}') -> 'attachment' ->> 'name',
  'Canteen', 'a phone contact is shared');

-- ---------------------------------------------------------------- reading
select is((select array_agg(kind order by created_at) from api.chat_messages((select chat from ids))),
  array['image', 'file', 'sticker', 'poll', 'contact', 'contact'], 'messages come back with their kind');

select * from finish();
rollback;
