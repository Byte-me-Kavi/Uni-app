-- Sign-up rules, approval workflow and account isolation.
-- Run with: supabase test db

begin;
-- On a linked project the runner logs in as a temporary CLI role; run as postgres, as locally.
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(28);

-- ---------------------------------------------------------------- fixtures
insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9001, 'Test Alpha University', 'TAU', 'state', 'live'),
  (9002, 'Test Beta University', 'TBU', 'state', 'live'),
  (9003, 'Test Closed University', 'TCU', 'state', 'waitlist');
insert into identity.institution_email_domains (domain, institution_id) values
  ('alpha.test', 9001), ('beta.test', 9002), ('closed.test', 9003);

create function pg_temp.signup_event(p_email text, p_meta jsonb) returns jsonb language sql as $$
  select jsonb_build_object('user', jsonb_build_object('email', p_email, 'user_metadata', p_meta));
$$;

create function pg_temp.make_user(p_id uuid, p_email text, p_name text) returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, aud, role)
  values (p_id, p_email, jsonb_build_object('full_name', p_name), now(), 'authenticated', 'authenticated');
$$;

create function pg_temp.act_as(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.act_as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ---------------------------------------------------------------- before_user_created hook
select is(
  identity.before_user_created(pg_temp.signup_event('someone@gmail.com',
    '{"full_name":"Some One","age_confirmed":true,"guidelines_accepted":true}'))->'error'->>'http_code',
  '403', 'hook rejects a personal email domain');

select is(
  identity.before_user_created(pg_temp.signup_event('someone@closed.test',
    '{"full_name":"Some One","age_confirmed":true,"guidelines_accepted":true}'))->'error'->>'http_code',
  '403', 'hook rejects a waitlisted institution');

select is(
  identity.before_user_created(pg_temp.signup_event('someone@alpha.test',
    '{"full_name":"Some One","age_confirmed":true}'))->'error'->>'http_code',
  '400', 'hook rejects a sign-up without the guidelines confirmation');

select is(
  identity.before_user_created(pg_temp.signup_event('someone@alpha.test',
    '{"age_confirmed":true,"guidelines_accepted":true}')),
  '{}'::jsonb, 'hook accepts a sign-up without a name (students choose it after approval)');

select is(
  identity.before_user_created(pg_temp.signup_event('Someone@ALPHA.test',
    '{"full_name":"Some One","age_confirmed":true,"guidelines_accepted":true}')),
  '{}'::jsonb, 'hook accepts a live institution domain, case-insensitively');

-- ---------------------------------------------------------------- new-user trigger
select pg_temp.make_user('00000000-0000-0000-0000-00000000000a', 'student.a@alpha.test', 'Student A');
select pg_temp.make_user('00000000-0000-0000-0000-00000000000b', 'student.b@alpha.test', 'Student B');
select pg_temp.make_user('00000000-0000-0000-0000-00000000000c', 'mod.beta@beta.test', 'Beta Moderator');
select pg_temp.make_user('00000000-0000-0000-0000-00000000000d', 'admin@alpha.test', 'National Admin');

select is(
  (select account_status from identity.profiles where user_id = '00000000-0000-0000-0000-00000000000a'),
  'pending', 'a new account starts pending');
select is(
  (select institution_id from identity.profiles where user_id = '00000000-0000-0000-0000-00000000000a'),
  9001::bigint, 'institution comes from the email domain');
select is(
  (select count(*)::int from identity.consents where user_id = '00000000-0000-0000-0000-00000000000a'),
  3, 'the three required sign-up consents are recorded');
select ok(
  exists (select 1 from identity.privacy_settings where user_id = '00000000-0000-0000-0000-00000000000a'),
  'privacy settings are created with safe defaults');

select throws_ok(
  $$ insert into auth.users (id, email, raw_user_meta_data, aud, role)
     values ('00000000-0000-0000-0000-0000000000ff', 'x@unknown.test', '{"full_name":"X Y"}', 'authenticated', 'authenticated') $$,
  '23514', null, 'the trigger refuses an unknown domain even if the hook were off');

-- staff fixtures
update identity.profiles set account_status = 'active'
  where user_id in ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000d');
insert into identity.staff_roles (user_id, role, institution_id) values
  ('00000000-0000-0000-0000-00000000000c', 'moderator', 9002),
  ('00000000-0000-0000-0000-00000000000d', 'admin', null);

-- ---------------------------------------------------------------- access token hook
select is(
  identity.custom_access_token(jsonb_build_object(
    'user_id', '00000000-0000-0000-0000-00000000000a', 'claims', '{"sub":"x"}'::jsonb))
    -> 'claims' -> 'app_metadata' ->> 'account_status',
  'pending', 'token carries the account status');
select is(
  identity.custom_access_token(jsonb_build_object(
    'user_id', '00000000-0000-0000-0000-00000000000d', 'claims', '{"sub":"x"}'::jsonb))
    -> 'claims' -> 'app_metadata' ->> 'staff_role',
  'admin', 'token carries the staff role');

-- ---------------------------------------------------------------- isolation as student A
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');

select is((select count(*)::int from identity.profiles), 1, 'a student sees only their own profile');
select is((api.my_account() ->> 'account_status'), 'pending', 'my_account returns the caller''s status');
select ok(not identity.is_active_user(), 'a pending student is not active');
select is(identity.pending_account_count(), null, 'a student gets no approval count');

select throws_ok(
  $$ update identity.profiles set account_status = 'active' where user_id = '00000000-0000-0000-0000-00000000000a' $$,
  '42501', null, 'a student cannot approve themselves');

select throws_ok(
  $$ select * from api.pending_accounts() $$,
  '42501', null, 'a student cannot see the approval queue');

select throws_ok(
  $$ select api.review_account('00000000-0000-0000-0000-00000000000b', 'approved') $$,
  '42501', null, 'a student cannot approve another student');

select throws_ok(
  $$ insert into identity.staff_roles (user_id, role) values ('00000000-0000-0000-0000-00000000000a', 'admin') $$,
  '42501', null, 'a student cannot grant themselves a staff role');

-- ---------------------------------------------------------------- moderator of another institution
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');

select is((select count(*)::int from api.pending_accounts()), 0,
  'a moderator sees no pending accounts from other institutions');
select is(identity.pending_account_count(), 0, 'a moderator''s count covers only their own institution');
select throws_ok(
  $$ select api.review_account('00000000-0000-0000-0000-00000000000a', 'approved') $$,
  '42501', null, 'a moderator cannot approve at another institution');

-- ---------------------------------------------------------------- national admin
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');

select is((select count(*)::int from api.pending_accounts(9001)), 2, 'an admin sees the pending queue');
select ok(identity.pending_account_count() >= 2, 'a national admin''s count covers every institution');
select throws_ok(
  $$ select api.review_account('00000000-0000-0000-0000-00000000000b', 'rejected', '') $$,
  '22023', null, 'rejecting needs a reason');
select is(api.review_account('00000000-0000-0000-0000-00000000000a', 'approved'), 'active',
  'an admin can approve a pending student');

select pg_temp.act_as_postgres();
select is(
  (select count(*)::int from ops.audit_log
   where action = 'account.approved' and target_id = '00000000-0000-0000-0000-00000000000a'),
  1, 'the approval is written to the audit log');

select * from finish();
rollback;
