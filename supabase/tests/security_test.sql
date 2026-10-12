-- Security review: who may run what, and who may send on which realtime channel.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(12);

-- ---------------------------------------------------------------- the api schema
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and has_function_privilege('anon', p.oid, 'execute') and p.proname <> 'app_config'), 0,
          'signed-out callers cannot run api functions');
select ok(has_function_privilege('anon', 'api.app_config()', 'execute'), 'except the app version check');
select ok(has_function_privilege('authenticated', 'api.my_home()', 'execute'), 'students still can');
select ok(not has_function_privilege('authenticated', 'api.chat_file_checked(uuid, boolean, text, text)', 'execute'),
          'server-only functions stay server-only');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and has_function_privilege('public', p.oid, 'execute')), 0,
          'nothing is open to everyone (new functions must revoke it)');

-- ---------------------------------------------------------------- realtime topics
insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9898, 'Test Delta Two University', 'TD2', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('d2.test', 9898);

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

select pg_temp.make_user('00000000-0000-0000-0000-0000000b1101', '2025dd001@d2.test', 'Dinu D');
select pg_temp.make_user('00000000-0000-0000-0000-0000000b1102', '2025dd002@d2.test', 'Eshan E');
select pg_temp.make_user('00000000-0000-0000-0000-0000000b1103', '2025dd003@d2.test', 'Fathima F');
select pg_temp.act_as('00000000-0000-0000-0000-0000000b1101');
select api.join_batch(null, 'BSc in Delta Computing', 2025);
select pg_temp.act_as('00000000-0000-0000-0000-0000000b1102');
select api.join_batch((select id from academics.programmes where institution_id = 9898), null, 2025);

select set_config('role', 'postgres', true);
create temp table ids (batch uuid, dm uuid);
insert into ids default values;
grant all on pg_temp.ids to public;
update ids set batch = (select c.id from messaging.conversations c join academics.cohort_members m on m.cohort_id = c.cohort_id
                        where m.user_id = '00000000-0000-0000-0000-0000000b1101' and c.kind = 'cohort');

-- A direct chat between d and e (same university: accepted straight away).
select pg_temp.act_as('00000000-0000-0000-0000-0000000b1101');
update ids set dm = (api.start_direct('00000000-0000-0000-0000-0000000b1102') ->> 'conversation_id')::uuid;

select ok(messaging.can_use_topic('chat:' || (select batch from ids), false), 'members listen to their chat');
select ok(not messaging.can_use_topic('chat:' || (select batch from ids), true), 'but nobody can send on it (only the database)');
select ok(not messaging.can_use_topic('chat:' || (select dm from ids), true), 'not even in a direct chat');
select ok(messaging.can_use_topic('typing:' || (select dm from ids), true), 'typing has its own channel in a direct chat');
select ok(not messaging.can_use_topic('typing:' || (select batch from ids), true), 'only in direct chats');
select pg_temp.act_as('00000000-0000-0000-0000-0000000b1103');
select ok(not messaging.can_use_topic('typing:' || (select dm from ids), false), 'and only for the two people in it');
select ok(not messaging.can_use_topic('user:00000000-0000-0000-0000-0000000b1101', false), 'nobody listens to another student''s inbox');

select * from finish();
rollback;
