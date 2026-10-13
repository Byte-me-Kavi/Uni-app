-- Moderation: the queue (scope, conflict rule, who it is about), actions with reasons (warn,
-- remove, mute, suspend), strikes, what the student sees, appeals decided by a different
-- moderator, and penalties ending.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(24);

insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9799, 'Test Psi University', 'TSU2', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('psi.test', 9799);

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
create function pg_temp.prof(p_id uuid) returns identity.profiles language sql security definer as $$
  select * from identity.profiles where user_id = p_id;
$$;

-- x: breaks the rules (batch B). r: reports. b: the moderator's batchmate (batch A).
-- m: moderator (batch A). m2: a second moderator. n: national admin. s: another staff member.
select pg_temp.make_user('00000000-0000-0000-0000-0000000d0001', '2024ss001@psi.test', 'Xavier X');
select pg_temp.make_user('00000000-0000-0000-0000-0000000d0002', '2024ss002@psi.test', 'Ruwan R');
select pg_temp.make_user('00000000-0000-0000-0000-0000000d0003', '2023ss003@psi.test', 'Bimal B');
select pg_temp.make_user('00000000-0000-0000-0000-0000000d0004', '2023ss004@psi.test', 'Malsha M');
select pg_temp.make_user('00000000-0000-0000-0000-0000000d0005', '2020ss005@psi.test', 'Mohan M2');
select pg_temp.make_user('00000000-0000-0000-0000-0000000d0006', '2019ss006@psi.test', 'Nadee N');
insert into identity.staff_roles (user_id, role, institution_id) values
  ('00000000-0000-0000-0000-0000000d0004', 'moderator', 9799),
  ('00000000-0000-0000-0000-0000000d0005', 'moderator', 9799),
  ('00000000-0000-0000-0000-0000000d0006', 'admin', null);
select pg_temp.act_as('00000000-0000-0000-0000-0000000d0001');
select api.join_batch(null, 'BSc in Moderation', 2024);
select pg_temp.act_as('00000000-0000-0000-0000-0000000d0003');
select api.join_batch(null, 'BSc in Moderation', 2023);
select pg_temp.act_as('00000000-0000-0000-0000-0000000d0004');
select api.join_batch(null, 'BSc in Moderation', 2023);

create temp table ids (bad bigint, mate bigint, action uuid, suspend uuid, appeal uuid);
insert into ids default values;
grant all on pg_temp.ids to public;

select pg_temp.act_as('00000000-0000-0000-0000-0000000d0001');
update ids set bad = (api.create_post('{"body": "Freshers, meet us behind the canteen tonight. Or else."}') ->> 'id')::bigint;
select pg_temp.act_as('00000000-0000-0000-0000-0000000d0003');
update ids set mate = (api.create_post('{"body": "Selling notes, cheap"}') ->> 'id')::bigint;
select pg_temp.act_as('00000000-0000-0000-0000-0000000d0002');
select api.report_post('post', (select bad from ids), 'ragging_or_threats', 'This is a threat to freshers');
select api.report_post('post', (select mate from ids), 'spam');

set local role postgres;
select is((select subject_user_id from safety.reports where target_kind = 'post' and target_id = (select bad from ids)::text),
  '00000000-0000-0000-0000-0000000d0001'::uuid, 'a report knows who it is about');

-- ---------------------------------------------------------------- the queue
select pg_temp.act_as('00000000-0000-0000-0000-0000000d0002');
select throws_ok($$ select api.reports_queue() $$, '42501', null, 'students have no queue');
select pg_temp.act_as('00000000-0000-0000-0000-0000000d0004');
select is(api.reports_queue() -> 0 ->> 'priority', '1', 'ragging comes first');
select is(api.reports_queue() -> 0 -> 'subject' ->> 'name', 'Xavier X', 'with who it is about');
select is((select count(*)::integer from jsonb_array_elements(api.reports_queue()) g
           where g -> 'subject' ->> 'user_id' = '00000000-0000-0000-0000-0000000d0003'), 0,
  'a moderator does not see reports about their own batchmates');
select throws_ok($$ select api.take_action('warn', null, 'Spam', null, 'post', (select mate from ids)::text) $$, '42501', null,
  'or act on them');
select pg_temp.act_as('00000000-0000-0000-0000-0000000d0006');
select is((select count(*)::integer from jsonb_array_elements(api.reports_queue()) g
           where g -> 'subject' ->> 'user_id' = '00000000-0000-0000-0000-0000000d0003'), 1, 'a national admin does');

-- ---------------------------------------------------------------- acting
select pg_temp.act_as('00000000-0000-0000-0000-0000000d0004');
select throws_ok($$ select api.take_action('warn', null, null, null, 'post', (select bad from ids)::text) $$, '22023', null,
  'every action needs a reason');
select is((api.take_action('warn', null, 'Threatening freshers breaks the ragging rules.', null, 'post', (select bad from ids)::text, true)
           ->> 'strikes'), '1', 'a warning is a strike');
set local role postgres;
select is((select status from feed.posts where id = (select bad from ids)), 'removed', 'and the post can be removed with it');
select is((select count(*)::integer from safety.reports where target_id = (select bad from ids)::text and status = 'open'), 0,
  'its reports are closed');

select pg_temp.act_as('00000000-0000-0000-0000-0000000d0001');
select is(api.my_standing() -> 'actions' -> 0 ->> 'reason', 'Threatening freshers breaks the ragging rules.', 'the student sees the reason');
select is(api.my_standing() -> 'actions' -> 0 ->> 'can_appeal', 'true', 'and can appeal');

select pg_temp.act_as('00000000-0000-0000-0000-0000000d0004');
select throws_ok($$ select api.take_action('mute', '00000000-0000-0000-0000-0000000d0001', 'Cool off', 90) $$, '22023', null,
  'a mute is 1 to 30 days');
select api.take_action('mute', '00000000-0000-0000-0000-0000000d0001', 'Keep it civil for a few days.', 3);
select throws_ok($$ select api.take_action('warn', '00000000-0000-0000-0000-0000000d0005', 'Be nicer') $$, '42501', null,
  'only a national admin acts on staff');

select pg_temp.act_as('00000000-0000-0000-0000-0000000d0001');
select throws_ok($$ select api.create_post('{"body": "hello again"}') $$, '42501', null, 'a muted student cannot post');

select pg_temp.act_as('00000000-0000-0000-0000-0000000d0004');
update ids set suspend = (api.take_action('suspend', '00000000-0000-0000-0000-0000000d0001', 'Repeated threats after a warning.', 7) ->> 'action_id')::uuid;
select is((pg_temp.prof('00000000-0000-0000-0000-0000000d0001')).account_status, 'suspended', 'a suspension suspends the account');

-- ---------------------------------------------------------------- appeals
select pg_temp.act_as('00000000-0000-0000-0000-0000000d0001');
select throws_ok($$ select api.feed() $$, '42501', null, 'a suspended student cannot use the app');
update ids set appeal = api.appeal((select suspend from ids), 'It was a joke between friends, I am sorry and it will not happen again.');
select ok((select appeal from ids) is not null, 'but can appeal');
select throws_ok($$ select api.appeal((select suspend from ids), 'Again please, I really mean it this time.') $$, '22023', null, 'once');

select pg_temp.act_as('00000000-0000-0000-0000-0000000d0004');
select throws_ok($$ select api.decide_appeal((select appeal from ids), 'overturned') $$, '42501', null,
  'the moderator who acted cannot decide the appeal');
select pg_temp.act_as('00000000-0000-0000-0000-0000000d0005');
select api.decide_appeal((select appeal from ids), 'overturned', 'First suspension; the warning and mute are enough.');
select is((pg_temp.prof('00000000-0000-0000-0000-0000000d0001')).account_status, 'active', 'overturning lifts the suspension');
select pg_temp.act_as('00000000-0000-0000-0000-0000000d0001');
select is(api.my_standing() ->> 'strikes', '2', 'and removes its strike');

-- ---------------------------------------------------------------- penalties end
set local role postgres;
update safety.moderation_actions set expires_at = now() - interval '1 minute'
where subject_user_id = '00000000-0000-0000-0000-0000000d0001' and action = 'mute';
update identity.profiles set muted_until = now() - interval '1 minute' where user_id = '00000000-0000-0000-0000-0000000d0001';
select safety.end_penalties();
select is((pg_temp.prof('00000000-0000-0000-0000-0000000d0001')).muted_until, null, 'mutes end by themselves');

select * from finish();
rollback;
