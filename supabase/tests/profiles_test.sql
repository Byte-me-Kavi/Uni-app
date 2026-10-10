-- Profile settings: photo paths, bio, privacy choices and blocking.
-- Run with: supabase test db

begin;
-- On a linked project the runner logs in as a temporary CLI role; run as postgres, as locally.
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(26);

-- ---------------------------------------------------------------- fixtures
insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9401, 'Test Iota University', 'TIU', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('iota.test', 9401);

create function pg_temp.make_user(p_id uuid, p_email text, p_name text, p_active boolean default true) returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, aud, role)
  values (p_id, p_email, jsonb_build_object('full_name', p_name), now(), 'authenticated', 'authenticated');
  update identity.profiles set account_status = 'active', name_confirmed_at = now() where user_id = p_id and p_active;
$$;
create function pg_temp.act_as(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.make_user('00000000-0000-0000-0000-00000000c001', 'amaya@iota.test', 'Amaya Silva');
select pg_temp.make_user('00000000-0000-0000-0000-00000000c002', 'ruwan@iota.test', 'Ruwan Perera');
select pg_temp.make_user('00000000-0000-0000-0000-00000000c003', 'pending@iota.test', 'Pending Person', false);

-- ---------------------------------------------------------------- photo
select pg_temp.act_as('00000000-0000-0000-0000-00000000c001');
select matches(api.begin_avatar_upload(), '^avatars/00000000-0000-0000-0000-00000000c001/[0-9a-f-]{36}\.jpg$',
  'an upload goes to a new random path in the student''s own folder');
select is(api.set_my_avatar('avatars/00000000-0000-0000-0000-00000000c001/11111111-1111-1111-1111-111111111111.jpg'), null,
  'the first photo has no previous one to delete');
select is(api.set_my_avatar('avatars/00000000-0000-0000-0000-00000000c001/22222222-2222-2222-2222-222222222222.jpg'),
  'avatars/00000000-0000-0000-0000-00000000c001/11111111-1111-1111-1111-111111111111.jpg',
  'a new photo returns the old path, so its file can be deleted');
select throws_ok($$ select api.set_my_avatar('avatars/00000000-0000-0000-0000-00000000c002/33333333-3333-3333-3333-333333333333.jpg') $$,
  '22023', null, 'a student cannot use another student''s photo');
select throws_ok($$ select api.set_my_avatar('../../secret.jpg') $$, '22023', null, 'arbitrary paths are refused');
select is(api.my_account() ->> 'avatar_path', 'avatars/00000000-0000-0000-0000-00000000c001/22222222-2222-2222-2222-222222222222.jpg',
  'the account shows the photo');

select pg_temp.act_as('00000000-0000-0000-0000-00000000c002');
select is((select avatar_path from api.search_people('amaya')),
  'avatars/00000000-0000-0000-0000-00000000c001/22222222-2222-2222-2222-222222222222.jpg', 'search results carry the photo');
select is(api.person('00000000-0000-0000-0000-00000000c001') ->> 'avatar_path',
  'avatars/00000000-0000-0000-0000-00000000c001/22222222-2222-2222-2222-222222222222.jpg', 'student cards carry the photo');

select pg_temp.act_as('00000000-0000-0000-0000-00000000c001');
select isnt(api.set_my_avatar(null), null, 'removing the photo returns the old path');
select is(api.my_account() ->> 'avatar_path', null, 'and the account has no photo');

select set_config('role', 'postgres', true);
insert into ops.rate_limits (user_id, action, window_start, hits)
values ('00000000-0000-0000-0000-00000000c001', 'avatar_upload', date_trunc('hour', now()), 20)
on conflict on constraint rate_limits_pkey do update set hits = 20;
select pg_temp.act_as('00000000-0000-0000-0000-00000000c001');
select throws_ok($$ select api.begin_avatar_upload() $$, 'PT429', null, 'more than 20 uploads an hour is refused');

select pg_temp.act_as('00000000-0000-0000-0000-00000000c003');
select throws_ok($$ select api.begin_avatar_upload() $$, '42501', null, 'accounts waiting for approval cannot upload');

-- ---------------------------------------------------------------- bio
select pg_temp.act_as('00000000-0000-0000-0000-00000000c001');
select is(api.update_bio('  Second year CS. Ask me about kuppi.  '), 'Second year CS. Ask me about kuppi.', 'the bio is saved trimmed');
select throws_ok($$ select api.update_bio(repeat('a', 281)) $$, '22023', null, 'a bio over 280 characters is refused');
select is(api.update_bio('   '), null, 'an empty bio removes it');

-- ---------------------------------------------------------------- privacy
select is(api.my_account() ->> 'who_can_message', 'my_institution', 'messages default to the student''s own university');
select is(api.update_privacy(null, 'my_cohort'),
  '{"findable_by": "everyone", "who_can_message": "my_cohort"}'::jsonb, 'one setting changes, the other stays');
select throws_ok($$ select api.update_privacy(null, 'friends') $$, '22023', null, 'unknown message settings are refused');
select is(api.update_privacy('my_institution', null) ->> 'findable_by', 'my_institution', 'who can find me changes too');

-- ---------------------------------------------------------------- blocking
select throws_ok($$ select api.block_user('00000000-0000-0000-0000-00000000c001') $$, '22023', null, 'a student cannot block themselves');
select api.block_user('00000000-0000-0000-0000-00000000c002');
select is((select array_agg(full_name) from api.blocked_users()), array['Ruwan Perera'], 'blocked students are listed');
select is((api.my_account() ->> 'blocked_count')::int, 1, 'the account counts blocked students');
select is((api.person('00000000-0000-0000-0000-00000000c002') ->> 'blocked')::boolean, true, 'a blocked student''s card says they are blocked');
select pg_temp.act_as('00000000-0000-0000-0000-00000000c002');
select is(api.person('00000000-0000-0000-0000-00000000c001'), null, 'the blocked student sees no card for the blocker, so the block is not revealed');
select is((select count(*)::int from api.search_people('amaya')), 0, 'and cannot find the blocker in search');
select pg_temp.act_as('00000000-0000-0000-0000-00000000c001');
select api.unblock_user('00000000-0000-0000-0000-00000000c002');
select is((select count(*)::int from api.blocked_users()), 0, 'unblocking removes them from the list');

select * from finish();
rollback;
