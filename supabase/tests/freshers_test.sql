-- Fresher accounts: sign-up with a personal email, the letter upload and its check, the admin
-- queue and decisions (upload again, approve into a batch, one letter number per account), the
-- limits on freshers, shielding from seniors, fresher batches closed to seniors until started,
-- upgrading by university email, and fresher time running out.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(49);

insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9795, 'Test Tau University', 'TTU', 'state', 'live'),
  (9796, 'Test Upsilon University', 'TUU', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('tau.test', 9795), ('upsilon.test', 9796);

create function pg_temp.make_user(p_id uuid, p_email text, p_meta jsonb default '{}') returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, aud, role)
  values (p_id, p_email, p_meta, now(), 'authenticated', 'authenticated');
$$;
create function pg_temp.activate(p_id uuid, p_name text) returns void language sql as $$
  update identity.profiles set account_status = 'active', name_confirmed_at = now(), full_name = p_name where user_id = p_id;
$$;
create function pg_temp.act_as(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
end $$;
create function pg_temp.app(p_id uuid) returns identity.fresher_applications language sql security definer as $$
  select * from identity.fresher_applications where user_id = p_id;
$$;
create function pg_temp.prof(p_id uuid) returns identity.profiles language sql security definer as $$
  select * from identity.profiles where user_id = p_id;
$$;
create function pg_temp.hook(p_email text, p_meta jsonb) returns jsonb language sql as $$
  select identity.before_user_created(jsonb_build_object('user', jsonb_build_object('email', p_email, 'user_metadata', p_meta)));
$$;

-- f: a fresher. g: a second fresher (same batch). h: a third (runs out of time). s: a senior at the
-- same university. n: a national admin. m: a moderator at Tau.
select pg_temp.make_user('00000000-0000-0000-0000-0000000f5001', 'fresher.one@gmail.test', '{"fresher": true}');
select pg_temp.make_user('00000000-0000-0000-0000-0000000f5002', 'fresher.two@gmail.test', '{"fresher": true}');
select pg_temp.make_user('00000000-0000-0000-0000-0000000f5003', 'fresher.three@gmail.test', '{"fresher": true}');
select pg_temp.make_user('00000000-0000-0000-0000-0000000f5004', '2023tt004@tau.test');
select pg_temp.make_user('00000000-0000-0000-0000-0000000f5005', '2021tt005@tau.test');
select pg_temp.make_user('00000000-0000-0000-0000-0000000f5006', '2021tt006@tau.test');
select pg_temp.activate('00000000-0000-0000-0000-0000000f5004', 'Sahan Senior');
select pg_temp.activate('00000000-0000-0000-0000-0000000f5005', 'Nimal Admin');
select pg_temp.activate('00000000-0000-0000-0000-0000000f5006', 'Mala Moderator');
insert into identity.staff_roles (user_id, role, institution_id) values
  ('00000000-0000-0000-0000-0000000f5005', 'admin', null),
  ('00000000-0000-0000-0000-0000000f5006', 'moderator', 9795);

create temp table t (path text, path2 text, path3 text);
insert into t default values;
grant all on pg_temp.t to public;

-- ---------------------------------------------------------------- sign-up
select is(pg_temp.hook('someone@gmail.test', '{"fresher": true, "age_confirmed": true, "guidelines_accepted": true}'), '{}'::jsonb,
  'a fresher signs up with a personal email');
select ok(pg_temp.hook('2026tt001@tau.test', '{"fresher": true, "age_confirmed": true, "guidelines_accepted": true}') ? 'error',
  'but not with a university email');
select ok(pg_temp.hook('someone@gmail.test', '{"age_confirmed": true, "guidelines_accepted": true}') -> 'error' ->> 'message' like '%fresher%',
  'a personal email in the normal sign-up points to the fresher sign-up');
update ops.settings set value = 'false' where key = 'feature.fresher_signup';
select ok(pg_temp.hook('someone@gmail.test', '{"fresher": true, "age_confirmed": true, "guidelines_accepted": true}') ? 'error',
  'the fresher sign-up switch closes it');
update ops.settings set value = 'true' where key = 'feature.fresher_signup';

select is((pg_temp.prof('00000000-0000-0000-0000-0000000f5001')).account_kind, 'fresher', 'the account is a fresher account');
select is((pg_temp.prof('00000000-0000-0000-0000-0000000f5001')).institution_id, null, 'with no university yet');
select is((pg_temp.app('00000000-0000-0000-0000-0000000f5001')).status, 'needs_letter', 'waiting for the letter');
select is(identity.custom_access_token(jsonb_build_object('user_id', '00000000-0000-0000-0000-0000000f5001', 'claims', '{}'::jsonb))
  #>> '{claims,app_metadata,account_kind}', 'fresher', 'the token says fresher');

-- ---------------------------------------------------------------- the letter
select pg_temp.act_as('00000000-0000-0000-0000-0000000f5001');
select throws_ok($$ select api.begin_letter_upload('image/png', 1000) $$, '22023', null, 'a photo or a PDF only');
select throws_ok($$ select api.begin_letter_upload('application/pdf', 20000000) $$, '22023', null, 'under 10 MB');
update t set path = api.begin_letter_upload('image/jpeg', 800000) ->> 'path';
select ok((select path from t) ~ '^letters/00000000-0000-0000-0000-0000000f5001/', 'the letter goes under the fresher''s own folder');
select is(api.letter_upload_to_check((select path from t)) ->> 'mime', 'image/jpeg', 'the fresher''s upload can be checked');
select throws_ok($$ select api.letter_upload_checked((select path from t), true, repeat('a', 64)) $$, '42501', null,
  'only the letters function records the check');

select pg_temp.act_as('00000000-0000-0000-0000-0000000f5004');
select throws_ok($$ select api.begin_letter_upload('image/jpeg', 1000) $$, '42501', null, 'students do not upload letters');
select is(api.letter_upload_to_check((select path from t)), null, 'or see anyone else''s');

select pg_temp.as_service();
select api.letter_upload_checked((select path from t), true, repeat('a', 64));
select is((pg_temp.app('00000000-0000-0000-0000-0000000f5001')).status, 'waiting', 'a checked letter joins the queue');

-- The second fresher uploads the very same file.
select pg_temp.act_as('00000000-0000-0000-0000-0000000f5002');
update t set path2 = api.begin_letter_upload('application/pdf', 300000) ->> 'path';
select pg_temp.as_service();
select api.letter_upload_checked((select path2 from t), true, repeat('a', 64));

-- ---------------------------------------------------------------- the admin
select pg_temp.act_as('00000000-0000-0000-0000-0000000f5006');
select throws_ok($$ select api.fresher_queue() $$, '42501', null, 'a university moderator does not approve freshers');
select throws_ok($$ select api.fresher_letter('00000000-0000-0000-0000-0000000f5001') $$, '42501', null, 'or see letters');

select pg_temp.act_as('00000000-0000-0000-0000-0000000f5005');
select is((select (x ->> 'same_file')::integer from jsonb_array_elements(api.fresher_queue()) x
           where x ->> 'user_id' = '00000000-0000-0000-0000-0000000f5001'), 1, 'the queue flags a file used by another account');
select is(api.fresher_letter('00000000-0000-0000-0000-0000000f5001') ->> 'path', (select path from t), 'a national admin opens the letter');
select throws_ok($$ select api.review_fresher('00000000-0000-0000-0000-0000000f5001', 'reupload') $$, '22023', null,
  'asking again needs a reason');
select api.review_fresher('00000000-0000-0000-0000-0000000f5001', 'reupload', p_reason => 'The photo is blurry. Take it in daylight.');
select is((pg_temp.app('00000000-0000-0000-0000-0000000f5001')).status, 'needs_letter', 'the fresher is asked to upload again');

select pg_temp.act_as('00000000-0000-0000-0000-0000000f5001');
update t set path3 = api.begin_letter_upload('image/jpeg', 900000) ->> 'path';
select pg_temp.as_service();
select api.letter_upload_checked((select path3 from t), true, repeat('b', 64));
set local role postgres;
select ok(exists (select 1 from identity.letter_deletions where path = (select path from t)), 'the old letter is queued for deletion');

select pg_temp.act_as('00000000-0000-0000-0000-0000000f5005');
select throws_ok($$ select api.review_fresher('00000000-0000-0000-0000-0000000f5001', 'approved', 9795, null, 'BSc in Testing', 2020) $$,
  '22023', null, 'the intake year must be this year, last year or next');
select is(api.review_fresher('00000000-0000-0000-0000-0000000f5001', 'approved', 9795, null, 'BSc in Testing', 2026, 'A/L 1234567') ->> 'status',
  'approved', 'a national admin approves into a batch');
select throws_ok($$ select api.review_fresher('00000000-0000-0000-0000-0000000f5002', 'approved', 9795, null, 'BSc in Testing', 2026, 'al-1234567') $$,
  '22023', 'Another account already used this letter number.', 'one letter number, one account');
select api.review_fresher('00000000-0000-0000-0000-0000000f5002', 'approved', 9795, null, 'BSc in Testing', 2026);

set local role postgres;
select is((pg_temp.prof('00000000-0000-0000-0000-0000000f5001')).account_status, 'active', 'the fresher is in');
select ok((pg_temp.prof('00000000-0000-0000-0000-0000000f5001')).fresher_until > now() + interval '119 days', 'for 120 days');
select is((select c.stage from academics.cohort_members m join academics.cohorts c on c.id = m.cohort_id
           where m.user_id = '00000000-0000-0000-0000-0000000f5001'), 'freshers', 'in a new batch for freshers');
select is((select count(*)::integer from messaging.conversation_members m join messaging.conversations c on c.id = m.conversation_id
           where m.user_id = '00000000-0000-0000-0000-0000000f5001' and c.kind = 'cohort'), 1, 'with its batch chat');
select is((select count(*)::integer from messaging.conversation_members m join messaging.conversations c on c.id = m.conversation_id
           where m.user_id = '00000000-0000-0000-0000-0000000f5001' and c.kind = 'programme'), 0, 'but not the national group yet');
update identity.profiles set name_confirmed_at = now(), full_name = 'Fathima Fresher' where user_id = '00000000-0000-0000-0000-0000000f5001';
update identity.profiles set name_confirmed_at = now(), full_name = 'Gihan Fresher' where user_id = '00000000-0000-0000-0000-0000000f5002';
select is((select array_agg(distinct institution_id) from identity.search_keys where user_id = '00000000-0000-0000-0000-0000000f5001'),
  array[0::bigint], 'search finds a fresher only within their batch');

-- ---------------------------------------------------------------- limits
select pg_temp.act_as('00000000-0000-0000-0000-0000000f5004');
create temp table p (id bigint);
grant all on pg_temp.p to public;
insert into p values ((api.create_post('{"body": "Welcome freshers"}') ->> 'id')::bigint);
select pg_temp.act_as('00000000-0000-0000-0000-0000000f5001');
select throws_ok($$ select api.create_post('{"body": "Hi all"}') $$, '42501', 'Freshers can post once they add their university email.',
  'freshers cannot post');
select throws_ok($$ select api.add_comment((select id from p), 'Thanks!') $$, '42501', null, 'or comment');
select lives_ok($$ select api.like_post((select id from p), true) $$, 'but can like');

-- ---------------------------------------------------------------- shielding
select pg_temp.act_as('00000000-0000-0000-0000-0000000f5004');
select is(api.person('00000000-0000-0000-0000-0000000f5001'), null, 'a senior cannot open a fresher''s card');
select is(api.start_direct('00000000-0000-0000-0000-0000000f5001') ->> 'request_status', 'pending',
  'a senior''s message to a fresher is a request');
select pg_temp.act_as('00000000-0000-0000-0000-0000000f5002');
select is(api.person('00000000-0000-0000-0000-0000000f5001') ->> 'fresher', 'true', 'a batchmate opens it, marked as a fresher');
select is(api.start_direct('00000000-0000-0000-0000-0000000f5001') ->> 'request_status', 'accepted', 'and chats straight away');

-- ---------------------------------------------------------------- the batch stays closed to seniors
select pg_temp.act_as('00000000-0000-0000-0000-0000000f5004');
select throws_ok($$ select api.join_batch(null, 'BSc in Testing', 2026) $$, '42501', null,
  'a senior cannot join a fresher batch');
select pg_temp.act_as('00000000-0000-0000-0000-0000000f5004');
select throws_ok($$ select api.start_batch((select cohort_id from academics.cohort_members where user_id = '00000000-0000-0000-0000-0000000f5001')) $$,
  '42501', null, 'students cannot start a batch');

-- ---------------------------------------------------------------- upgrading by university email
select pg_temp.act_as('00000000-0000-0000-0000-0000000f5001');
select throws_ok($$ select api.check_university_email('fathima@upsilon.test') $$, '22023', null, 'an email from another university is refused');
select throws_ok($$ select api.check_university_email('2023tt004@tau.test') $$, '22023', null, 'and one already in use');
select is(api.check_university_email('2026tt101@tau.test') ->> 'ok', 'true', 'a free email of their university is fine');
set local role postgres;
update auth.users set email = '2026tt101@tau.test' where id = '00000000-0000-0000-0000-0000000f5001';
select is((pg_temp.prof('00000000-0000-0000-0000-0000000f5001')).account_kind, 'student', 'the university email makes a student');
select ok(exists (select 1 from identity.letter_deletions where path = (select path3 from t)), 'the letter is deleted');
select is((select count(*)::integer from messaging.conversation_members m join messaging.conversations c on c.id = m.conversation_id
           where m.user_id = '00000000-0000-0000-0000-0000000f5001' and c.kind = 'programme'), 1, 'and the national group opens');

-- ---------------------------------------------------------------- time running out
update identity.profiles set fresher_until = now() - interval '1 day' where user_id = '00000000-0000-0000-0000-0000000f5002';
select identity.expire_freshers();
select is((pg_temp.app('00000000-0000-0000-0000-0000000f5002')).letter_path, null, 'an expired fresher''s letter is deleted');
select pg_temp.act_as('00000000-0000-0000-0000-0000000f5002');
select throws_ok($$ select api.person('00000000-0000-0000-0000-0000000f5001') $$, '42501', null,
  'and the app stops working until the university email is added');

select * from finish();
rollback;
