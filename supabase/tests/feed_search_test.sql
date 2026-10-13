-- Feed search: words match anywhere, near spellings and some of the words count, across the text and the place, the filter applies, other
-- universities' posts only when shared with everyone, muted authors never; and the chat list says
-- which module a module chat belongs to.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(14);

insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9796, 'Test Psi University', 'TPU', 'state', 'live'),
  (9797, 'Test Rho University', 'TRU', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('psi.test', 9796), ('rho.test', 9797);

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

select pg_temp.make_user('00000000-0000-0000-0000-0000000c0001', '2024pp001@psi.test', 'Nimal N');
select pg_temp.make_user('00000000-0000-0000-0000-0000000c0002', '2024pp002@psi.test', 'Dilani D');
select pg_temp.make_user('00000000-0000-0000-0000-0000000c0003', '2024rr003@rho.test', 'Ruwan R');
create temp table ids (bodim bigint, question bigint, lost bigint, mine_other bigint, shared bigint, private bigint);
insert into ids default values;
grant all on pg_temp.ids to public;

select pg_temp.act_as('00000000-0000-0000-0000-0000000c0001');
update ids set bodim = (api.create_post('{"tag": "bodim", "body": "Room for girls, quiet house", "details": {"rent": 12000,
  "gender": "girls", "room": "single", "area": "Kelaniya"}}') ->> 'id')::bigint;
update ids set question = (api.create_post('{"tag": "question", "body": "Where is the Kelaniya library open late?"}') ->> 'id')::bigint;
update ids set lost = (api.create_post('{"tag": "lost_found", "body": "Blue water bottle", "details": {"kind": "lost", "where": "Canteen"}}') ->> 'id')::bigint;

select pg_temp.act_as('00000000-0000-0000-0000-0000000c0003');
update ids set shared = (api.create_post('{"body": "Kelaniya hackathon next week, all welcome", "audience": "everyone"}') ->> 'id')::bigint;
update ids set private = (api.create_post('{"body": "Kelaniya trip for our batch only"}') ->> 'id')::bigint;

select pg_temp.act_as('00000000-0000-0000-0000-0000000c0002');
create temp table found as
  select x::bigint as id from jsonb_array_elements(api.search_posts('kelan') -> 'ids') as t(x);
grant all on pg_temp.found to public;
select ok((select bodim from ids) in (select id from found), 'a word matches the place of a bodim, by prefix');
select ok((select question from ids) in (select id from found), 'and the text of a question');
select ok((select shared from ids) in (select id from found), 'posts shared with every university are found');
select ok((select private from ids) not in (select id from found), 'another university''s own posts are not');
select ok((select lost from ids) in (select x::bigint from jsonb_array_elements(api.search_posts('canteen') -> 'ids') as t(x)),
  'where something was lost is searched');
select is(jsonb_array_length(api.search_posts('kelaniya', 'question') -> 'ids'), 1, 'the filter applies');
select is(api.search_posts('k') -> 'ids', '[]'::jsonb, 'one letter finds nothing');
select ok((select bodim from ids) in (select x::bigint from jsonb_array_elements(api.search_posts('laniya') -> 'ids') as t(x)),
  'part of a word inside it matches');
select ok((select bodim from ids) in (select x::bigint from jsonb_array_elements(api.search_posts('kelanya') -> 'ids') as t(x)),
  'a near spelling matches');
select ok((select lost from ids) in (select x::bigint from jsonb_array_elements(api.search_posts('bottle umbrella') -> 'ids') as t(x)),
  'one of the words is enough');
select is((api.search_posts('kelaniya library') -> 'ids' ->> 0)::bigint, (select question from ids),
  'the post matching more of the words comes first');
select is(jsonb_array_length(api.search_posts('kelaniya & | !') -> 'posts'), 3, 'stray symbols are ignored');

select api.mute_author('00000000-0000-0000-0000-0000000c0001', true);
select is(jsonb_array_length(api.search_posts('kelaniya') -> 'ids'), 1, 'muted authors are left out');

set local role postgres;
insert into academics.modules (id, institution_id, code, name) overriding system value values (979601, 9796, 'TS1001', 'Test Searching')
  on conflict do nothing;
insert into messaging.conversations (id, kind, module_id, module_intake, title)
  values ('00000000-0000-0000-0000-00000c0c0001', 'module', 979601, 2024, 'TS1001');
insert into messaging.conversation_members (conversation_id, user_id) values ('00000000-0000-0000-0000-00000c0c0001', '00000000-0000-0000-0000-0000000c0002');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c0002');
select is((select module_id from api.my_chats() where conversation_id = '00000000-0000-0000-0000-00000c0c0001'), 979601::bigint,
  'the chat list says which module a chat is for');

select * from finish();
rollback;
