-- Feed post types: bodim details checked and tidied, lost & found says lost or found, resolving
-- (author only, sinks the post), editing (author only, keeps the type), tag filters, and shop
-- listings from other universities open to everyone.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(22);

insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9793, 'Test Rho University', 'TRU', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('rho.test', 9793);

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
create function pg_temp.post(p_id bigint) returns feed.posts language sql security definer as $$
  select * from feed.posts where id = p_id;
$$;
create temp table mine (id bigint);
grant all on pg_temp.mine to public;
create function pg_temp.ranked(p_tag text default null) returns jsonb language sql as $$
  select coalesce(jsonb_agg(x) filter (where x::bigint in (select id from pg_temp.mine)), '[]'::jsonb)
  from jsonb_array_elements(api.feed(null, p_tag) -> 'ids') x;
$$;

-- a: posts. b: reads, same university.
select pg_temp.make_user('00000000-0000-0000-0000-0000000fd001', '2025rr001@rho.test', 'Amaya A');
select pg_temp.make_user('00000000-0000-0000-0000-0000000fd002', '2025rr002@rho.test', 'Buddhi B');
create temp table ids (bodim bigint, lost bigint, question bigint, plain bigint);
insert into ids default values;
grant all on pg_temp.ids to public;

-- ---------------------------------------------------------------- bodim
select pg_temp.act_as('00000000-0000-0000-0000-0000000fd001');
select throws_ok($$ select api.create_post('{"tag": "bodim", "details": {"gender": "girls", "room": "single", "area": "Dalugama"}}') $$,
  '22023', null, 'a bodim needs its rent');
select throws_ok($$ select api.create_post('{"tag": "bodim", "details": {"rent": 500, "gender": "girls", "room": "single", "area": "Dalugama"}}') $$,
  '22023', null, 'a real monthly rent');
select throws_ok($$ select api.create_post('{"tag": "bodim", "details": {"rent": 15000, "gender": "aliens", "room": "single", "area": "Dalugama"}}') $$,
  '22023', null, 'who it is for is one of the choices');
select throws_ok($$ select api.create_post('{"tag": "bodim", "details": {"rent": 15000, "gender": "girls", "room": "single", "area": "Dalugama", "phone": "call me"}}') $$,
  '22023', null, 'a phone number must be one');
update ids set bodim = (api.create_post('{"tag": "bodim", "details": {"rent": 15000, "gender": "girls", "room": "single",
  "area": " Near Gate 2, Dalugama ", "walk": 8, "facilities": ["wifi", "meals", "wifi", "jacuzzi"], "phone": "077 123 4567"}}') ->> 'id')::bigint;
insert into mine select bodim from ids;
select is((pg_temp.post((select bodim from ids))).details ->> 'area', 'Near Gate 2, Dalugama', 'a bodim can be details only, tidied');
select is((pg_temp.post((select bodim from ids))).details -> 'facilities', '["meals", "wifi"]'::jsonb, 'unknown and repeated facilities are dropped');
select is((pg_temp.post((select bodim from ids))).details ->> 'phone', '0771234567', 'the phone number is cleaned');

-- ---------------------------------------------------------------- lost & found, questions
select throws_ok($$ select api.create_post('{"tag": "lost_found", "body": "Blue bottle"}') $$, '22023', null,
  'lost & found says lost or found');
update ids set lost = (api.create_post('{"tag": "lost_found", "body": "Blue bottle", "details": {"kind": "found", "where": "Library 2nd floor"}}') ->> 'id')::bigint;
update ids set question = (api.create_post('{"tag": "question", "body": "When is the CS2012 deadline?"}') ->> 'id')::bigint;
update ids set plain = (api.create_post('{"body": "Sports meet today!"}') ->> 'id')::bigint;
insert into mine select lost from ids union all select question from ids union all select plain from ids;
select is((pg_temp.post((select question from ids))).details, null, 'other posts have no details');
select throws_ok($$ select api.set_post_resolved((select plain from ids), true) $$, '22023', null, 'plain posts cannot be marked done');

-- ---------------------------------------------------------------- filters
select pg_temp.act_as('00000000-0000-0000-0000-0000000fd002');
select is(jsonb_array_length(pg_temp.ranked('bodim')), 1, 'the bodim filter shows only bodim');
select is(jsonb_array_length(pg_temp.ranked('lost_found')), 1, 'and lost & found only lost & found');
select is(jsonb_array_length(pg_temp.ranked()), 4, 'the full feed shows everything');
select is(api.feed(null, 'bodim') -> 'shop', '[]'::jsonb, 'filtered feeds come without the extra cards');
select throws_ok($$ select api.feed(null, 'memes') $$, '22023', null, 'unknown filters are refused');

-- ---------------------------------------------------------------- resolving and editing
select throws_ok($$ select api.set_post_resolved((select lost from ids), true) $$, '42501', null, 'only the author marks it done');
select throws_ok($$ select api.edit_post((select lost from ids), '{"body": "mine now"}') $$, '42501', null, 'or edits it');
select pg_temp.act_as('00000000-0000-0000-0000-0000000fd001');
select is((api.set_post_resolved((select bodim from ids), true) ->> 'resolved'), 'true', 'the author marks a bodim taken');
select pg_temp.act_as('00000000-0000-0000-0000-0000000fd002');
select is((pg_temp.ranked() ->> -1)::bigint, (select bodim from ids), 'a taken bodim sinks to the bottom');
select pg_temp.act_as('00000000-0000-0000-0000-0000000fd001');
select is((api.edit_post((select bodim from ids), '{"details": {"rent": 14000, "gender": "anyone", "room": "annex", "area": "Kiribathgoda"}}')
  -> 'details' ->> 'rent'), '14000', 'the author edits the details');
select is((pg_temp.post((select bodim from ids))).tag, 'bodim', 'the type stays');
select throws_ok($$ select api.edit_post((select lost from ids), '{"body": "Blue bottle", "details": {"kind": "stolen"}}') $$,
  '22023', null, 'edits are checked like new posts');

select * from finish();
rollback;
