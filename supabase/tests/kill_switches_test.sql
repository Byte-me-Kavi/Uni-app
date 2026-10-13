-- Kill switches: a switched-off feature refuses new content through every path, existing content
-- keeps working, only national admins read or change the switches, values are checked and every
-- change is audited.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(14);

insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9794, 'Test Sigma University', 'TSU', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('sigma.test', 9794);

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

-- a: a student. n: a national admin. s: an admin scoped to one university.
select pg_temp.make_user('00000000-0000-0000-0000-0000000ce001', '2025ss001@sigma.test', 'Amaya A');
select pg_temp.make_user('00000000-0000-0000-0000-0000000ce002', '2025ss002@sigma.test', 'Nimal N');
select pg_temp.make_user('00000000-0000-0000-0000-0000000ce003', '2025ss003@sigma.test', 'Sanu S');
insert into identity.staff_roles (user_id, role, institution_id) values
  ('00000000-0000-0000-0000-0000000ce002', 'admin', null),
  ('00000000-0000-0000-0000-0000000ce003', 'admin', 9794);

create temp table ids (post bigint);
insert into ids default values;
grant all on pg_temp.ids to public;

select pg_temp.act_as('00000000-0000-0000-0000-0000000ce001');
update ids set post = (api.create_post('{"body": "Before the pause"}') ->> 'id')::bigint;

-- ---------------------------------------------------------------- who may change them
select throws_ok($$ select api.admin_settings() $$, '42501', null, 'students cannot read the switches');
select throws_ok($$ select api.set_setting('feature.posting', 'false') $$, '42501', null, 'or change them');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ce003');
select throws_ok($$ select api.set_setting('feature.posting', 'false') $$, '42501', null, 'nor can an admin of one university');

select pg_temp.act_as('00000000-0000-0000-0000-0000000ce002');
select ok(api.admin_settings() ? 'feature.posting', 'national admins read every switch');
select throws_ok($$ select api.set_setting('feature.posting', '"no"') $$, '22023', null, 'a switch is on or off');
select throws_ok($$ select api.set_setting('app.min_version', '"latest"') $$, '22023', null, 'a version looks like 1.2.0');
select throws_ok($$ select api.set_setting('db.password', '"x"') $$, '22023', null, 'unknown settings are refused');
select api.set_setting('feature.posting', 'false');
select api.set_setting('app.notice', '"  Chats are slow tonight.  "');

-- ---------------------------------------------------------------- what a switch does
select pg_temp.act_as('00000000-0000-0000-0000-0000000ce001');
select throws_ok($$ select api.create_post('{"body": "During the pause"}') $$, 'P0001',
  'Posting is paused for now. Try again later.', 'a paused feature refuses new posts');
select throws_ok($$ select api.add_comment((select post from ids), 'Nice') $$, 'P0001', null, 'and new comments');
select lives_ok($$ select api.like_post((select post from ids), true) $$, 'what is not paused keeps working');
select is(api.app_config() -> 'feature.posting', 'false'::jsonb, 'the app sees the switch');
select is(api.app_config() ->> 'app.notice', 'Chats are slow tonight.', 'and the notice, tidied');

set local role postgres;
select is((select count(*)::integer from ops.audit_log
           where action = 'setting.change' and actor_id = '00000000-0000-0000-0000-0000000ce002'), 2,
  'every change is audited');

select pg_temp.act_as('00000000-0000-0000-0000-0000000ce002');
select api.set_setting('feature.posting', 'true');
select pg_temp.act_as('00000000-0000-0000-0000-0000000ce001');
select lives_ok($$ select api.create_post('{"body": "After the pause"}') $$, 'switching it back on lets posts through');

select * from finish();
rollback;
