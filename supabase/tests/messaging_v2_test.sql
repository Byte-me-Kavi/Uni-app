-- Messaging v2: reply, reactions, forward, delete, edit, star, delivered, mentions, pin, links,
-- voice notes, private media access, presence and stickers.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(48);

-- ---------------------------------------------------------------- fixtures
insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9901, 'Test Omicron University', 'TOU', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('omicron.test', 9901);

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
create function pg_temp.say(p_conversation uuid, p_body text, p_reply uuid default null, p_mentions uuid[] default null,
  p_link jsonb default null) returns uuid language sql as $$
  select (api.send_message(p_conversation, ops.uuid_v7(), p_body, p_reply, 'text', null, null, p_mentions, p_link) ->> 'id')::uuid;
$$;

select pg_temp.make_user('00000000-0000-0000-0000-0000000ff001', '2024bm001@omicron.test', 'Kasun Rajapaksha');
select pg_temp.make_user('00000000-0000-0000-0000-0000000ff002', '2024bm002@omicron.test', 'Lahiru Mendis');
select pg_temp.make_user('00000000-0000-0000-0000-0000000ff003', '2024bm003@omicron.test', 'Malsha Dias');

select pg_temp.act_as('00000000-0000-0000-0000-0000000ff001');
select api.join_batch(null, 'BSc in Version Two', 2024);
select pg_temp.act_as('00000000-0000-0000-0000-0000000ff002');
select api.join_batch((select id from academics.programmes where institution_id = 9901), null, 2024);
select pg_temp.act_as('00000000-0000-0000-0000-0000000ff003');
select api.join_batch((select id from academics.programmes where institution_id = 9901), null, 2024);

select pg_temp.act_as('00000000-0000-0000-0000-0000000ff001');
create temp table ids as select
  (api.start_direct('00000000-0000-0000-0000-0000000ff002') ->> 'conversation_id')::uuid as dm,
  (select c.id from messaging.conversations c join academics.cohorts co on co.id = c.cohort_id
   join academics.programmes p on p.id = co.programme_id where p.institution_id = 9901) as grp,
  null::uuid as first, null::uuid as second, null::uuid as fwd;
grant all on pg_temp.ids to public;
update pg_temp.ids set first = pg_temp.say(dm, 'Lab report due Friday?');

-- ---------------------------------------------------------------- reply
select pg_temp.act_as('00000000-0000-0000-0000-0000000ff002');
update pg_temp.ids set second = pg_temp.say(dm, 'Yes, 5pm', first);
select is((select reply ->> 'text' from api.chat_messages((select dm from ids)) where id = (select second from ids)),
  'Lab report due Friday?', 'a reply carries the text it answers');
select is((select reply ->> 'sender_name' from api.chat_messages((select dm from ids)) where id = (select second from ids)),
  'Kasun Rajapaksha', 'and who wrote it');
select is((api.send_message((select dm from ids), ops.uuid_v7(), 'x', (select id from messaging.conversations where id = (select grp from ids)))) -> 'reply',
  'null'::jsonb, 'replying to something outside this chat attaches nothing');

-- ---------------------------------------------------------------- reactions
select api.react((select dm from ids), (select first from ids), '👍');
select is((select count from api.reactions((select dm from ids), array[(select first from ids)])), 1, 'a reaction counts');
select api.react((select dm from ids), (select first from ids), '❤️');
select is((select array_agg(emoji) from api.reactions((select dm from ids), array[(select first from ids)])), array['❤️'],
  'reacting again replaces your reaction');
select throws_ok($$ select api.react((select dm from ids), (select first from ids), 'lol') $$, '22023', null, 'words are not reactions');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ff001');
select api.react((select dm from ids), (select first from ids), '❤️');
select is((select count from api.reactions((select dm from ids), array[(select first from ids)])), 2, 'the same emoji adds up');
select is((select mine from api.reactions((select dm from ids), array[(select first from ids)])), true, 'and knows one is yours');
select is((select count(*)::int from api.reaction_details((select dm from ids), (select first from ids))), 2, 'who reacted is listed');
select api.react((select dm from ids), (select first from ids), null);
select is((select count from api.reactions((select dm from ids), array[(select first from ids)])), 1, 'a reaction can be taken back');

-- ---------------------------------------------------------------- forward
select is((api.send_message((select grp from ids), ops.uuid_v7(), '', null, 'text', null, (select first from ids)) ->> 'forwarded'),
  'true', 'a message can be forwarded to another chat');
select set_config('role', 'postgres', true);
select is((select body from messaging.messages where conversation_id = (select grp from ids) and forwarded order by created_at desc limit 1),
  'Lab report due Friday?', 'with the original content, not what the client sent');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ff003');
select throws_ok($$ select api.send_message((select grp from ids), ops.uuid_v7(), '', null, 'text', null, (select first from ids)) $$,
  '22023', null, 'nobody can forward from a chat they are not in');

-- ---------------------------------------------------------------- media access follows forwards
select pg_temp.act_as('00000000-0000-0000-0000-0000000ff001');
create temp table up as select (api.begin_chat_upload((select dm from ids), 'image', 'image/jpeg', 100000) ->> 'path') as photo;
grant all on pg_temp.up to public;
select api.send_message((select dm from ids), ops.uuid_v7(), '', null, 'image',
  jsonb_build_object('path', (select photo from up), 'width', 100, 'height', 100));
select pg_temp.act_as('00000000-0000-0000-0000-0000000ff003');
select is((select count(*)::int from api.media_access(array[(select photo from up)])), 0, 'a private photo is closed to others');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ff001');
select api.send_message((select grp from ids), ops.uuid_v7(), '', null, 'text', null,
  (select id from messaging.messages where attachment ->> 'path' = (select photo from up) and conversation_id = (select dm from ids)));
select pg_temp.act_as('00000000-0000-0000-0000-0000000ff003');
select is((select count(*)::int from api.media_access(array[(select photo from up)])), 1, 'forwarding it to a group opens it to that group');

-- ---------------------------------------------------------------- voice notes
select pg_temp.act_as('00000000-0000-0000-0000-0000000ff001');
select throws_ok($$ select api.begin_chat_upload((select dm from ids), 'voice', 'image/jpeg', 1000) $$, '22023', null,
  'voice notes are audio');
create temp table voice as select (api.begin_chat_upload((select dm from ids), 'voice', 'audio/mp4', 50000) ->> 'path') as path;
grant all on pg_temp.voice to public;
select is(api.send_message((select dm from ids), ops.uuid_v7(), '', null, 'voice',
  jsonb_build_object('path', (select path from voice), 'duration', 72000, 'waveform', '[1, 5, 15, 99, 3]'::jsonb)) -> 'attachment' -> 'waveform',
  '[1, 5, 15, 15, 3]'::jsonb, 'a voice note keeps its waveform, within range');
select is((select last_message_preview from messaging.conversations where id = (select dm from ids)), 'Voice message (1:12)',
  'and shows its length in the chat list');

-- ---------------------------------------------------------------- edit and delete
select is(api.edit_message((select dm from ids), (select first from ids), 'Lab report due Monday?') is not null, true, 'your message can be edited');
select is((select body from api.chat_messages((select dm from ids)) where id = (select first from ids)), 'Lab report due Monday?',
  'everyone sees the new text');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ff002');
select throws_ok($$ select api.edit_message((select dm from ids), (select first from ids), 'hacked') $$, '42501', null,
  'nobody edits someone else''s message');
select throws_ok($$ select api.delete_message((select dm from ids), (select first from ids), true) $$, '42501', null,
  'nobody deletes someone else''s message for everyone');
select api.delete_message((select dm from ids), (select first from ids), false);
select is((select count(*)::int from api.chat_messages((select dm from ids)) where id = (select first from ids)), 0,
  'delete for me hides it from you');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ff001');
select is((select count(*)::int from api.chat_messages((select dm from ids)) where id = (select first from ids)), 1,
  'but not from them');
select api.star_message((select dm from ids), (select first from ids), true);
select is((select count(*)::int from api.starred_messages()), 1, 'a message can be starred');
select api.delete_message((select dm from ids), (select first from ids), true);
select is((select deleted from api.chat_messages((select dm from ids)) where id = (select first from ids)), true,
  'delete for everyone marks it deleted');
select set_config('role', 'postgres', true);
select is((select body from messaging.messages where id = (select first from ids)), '', 'and clears its content');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ff001');
select is((select count(*)::int from api.starred_messages()), 0, 'deleted messages leave your starred list');
select lives_ok($$ select api.delete_message((select dm from ids), (select first from ids), false) $$,
  'a message deleted for everyone can still be deleted for me');
select is((select count(*)::int from api.chat_messages((select dm from ids)) where id = (select first from ids)), 0,
  'and its placeholder leaves your view');

-- ---------------------------------------------------------------- delivered
select pg_temp.act_as('00000000-0000-0000-0000-0000000ff002');
select api.mark_delivered((select dm from ids), now());
select pg_temp.act_as('00000000-0000-0000-0000-0000000ff001');
select isnt((select other_delivered_at from api.my_chats() where conversation_id = (select dm from ids)), null,
  'the sender sees their message delivered');

-- ---------------------------------------------------------------- mentions
select pg_temp.act_as('00000000-0000-0000-0000-0000000ff001');
select pg_temp.say((select grp from ids), '@Malsha can you bring the slides', null,
  array['00000000-0000-0000-0000-0000000ff003', '00000000-0000-0000-0000-0000000ff001', '00000000-0000-0000-0000-000000000000']::uuid[]);
select set_config('role', 'postgres', true);
select is((select mentions from messaging.messages where conversation_id = (select grp from ids) order by created_at desc limit 1),
  array['00000000-0000-0000-0000-0000000ff003']::uuid[], 'mentions keep only other members of the group');
select set_config('role', 'postgres', true);
insert into messaging.push_tokens (token, user_id, platform) values ('ExponentPushToken[malsha]', '00000000-0000-0000-0000-0000000ff003', 'android');
update messaging.conversation_members set muted_until = 'infinity', notified_at = now()
where user_id = '00000000-0000-0000-0000-0000000ff003' and conversation_id = (select grp from ids);
select is((select count(*)::int from messaging.push_recipients((select grp from ids), '00000000-0000-0000-0000-0000000ff001', '{}')), 0,
  'a muted member is not notified');
select is((select count(*)::int from messaging.push_recipients((select grp from ids), '00000000-0000-0000-0000-0000000ff001',
  array['00000000-0000-0000-0000-0000000ff003']::uuid[])), 1, 'unless they are mentioned');

-- ---------------------------------------------------------------- links
select pg_temp.act_as('00000000-0000-0000-0000-0000000ff001');
create temp table linked as select pg_temp.say((select dm from ids), 'see https://ucsc.cmb.ac.lk', null, null,
  '{"url": "https://ucsc.cmb.ac.lk", "title": "UCSC", "image": "javascript:alert(1)"}') as id;
grant all on pg_temp.linked to public;
select is((select link ->> 'title' from messaging.messages where id = (select id from linked)), 'UCSC', 'a link preview is kept');
select is((select (link -> 'image') is not null from messaging.messages where id = (select id from linked)), false,
  'without anything that is not a https image');

-- ---------------------------------------------------------------- pin
-- Members cannot pin in groups at all (reps and group admins can: see chat_tools_test).
select throws_ok($$ select api.pin_message((select grp from ids), (select second from ids)) $$, '42501', null,
  'members cannot pin in a group');
select is(api.pin_message((select dm from ids), (select second from ids)) ->> 'text', 'Yes, 5pm', 'a message can be pinned');
select is((select pinned ->> 'text' from api.my_chats() where conversation_id = (select dm from ids)), 'Yes, 5pm',
  'and the chat list knows');

-- ---------------------------------------------------------------- presence
select pg_temp.act_as('00000000-0000-0000-0000-0000000ff002');
select api.set_presence(true);
select pg_temp.act_as('00000000-0000-0000-0000-0000000ff001');
select is((api.presence('00000000-0000-0000-0000-0000000ff002') ->> 'online'), 'true', 'someone you chat with shows as online');
select is(api.presence('00000000-0000-0000-0000-0000000ff003'), null, 'someone you do not chat with does not');
select api.set_show_last_seen(false);
select is(api.presence('00000000-0000-0000-0000-0000000ff002'), null, 'hiding your last seen hides theirs from you');

-- ---------------------------------------------------------------- stickers
select pg_temp.act_as('00000000-0000-0000-0000-0000000ff001');
select is(api.begin_sticker_upload(repeat('a', 64), 50000, false) ->> 'path', 'stickers/' || repeat('a', 64) || '.webp',
  'a new sticker gets a path named by its hash');
select throws_ok($$ select api.commit_sticker('00000000-0000-0000-0000-0000000ff001', repeat('a', 64), 50000, false) $$, '42501', null,
  'students cannot register a sticker without the upload check');
select set_config('role', 'service_role', true);
select api.commit_sticker('00000000-0000-0000-0000-0000000ff001', repeat('a', 64), 50000, false);
select pg_temp.act_as('00000000-0000-0000-0000-0000000ff002');
select is(api.begin_sticker_upload(repeat('a', 64), 50000, false) ->> 'exists', 'true', 'the same sticker is stored once');
select is((select count(*)::int from api.my_stickers() where mine), 1, 'and added to the second student''s stickers');
select is(api.send_message((select dm from ids), ops.uuid_v7(), '', null, 'sticker',
  jsonb_build_object('pack', 'user', 'id', repeat('a', 64))) -> 'attachment' ->> 'pack', 'user', 'an imported sticker can be sent');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ff001');
select api.save_sticker('fluent:fire', true);
select is((select favourite from api.my_stickers() where sticker = 'fluent:fire'), true, 'stickers can be favourites');

select * from finish();
rollback;
