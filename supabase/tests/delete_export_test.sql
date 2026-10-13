-- Deleting an account and downloading data: retype the email, 30 days to change your mind (the
-- token knows), the export has your things, and on the day the account goes with its direct chats
-- and files queued, while group messages and moderation records stay without the person.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(14);

insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9802, 'Test Beta2 University', 'TB2', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('beta2.test', 9802);

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

select pg_temp.make_user('00000000-0000-0000-0000-0000000b2001', '2024bb001@beta2.test', 'Dinithi Leaving');
select pg_temp.make_user('00000000-0000-0000-0000-0000000b2002', '2024bb002@beta2.test', 'Eshan Staying');
update identity.profiles set avatar_path = 'avatars/00000000-0000-0000-0000-0000000b2001/00000000-0000-0000-0000-00000000bbbb.jpg'
where user_id = '00000000-0000-0000-0000-0000000b2001';

create temp table ids (dm uuid, batch uuid, post bigint);
insert into ids default values;
grant all on pg_temp.ids to public;

select pg_temp.act_as('00000000-0000-0000-0000-0000000b2001');
select api.join_batch(null, 'BSc in Leaving', 2024);
update ids set post = (api.create_post('{"body": "My last post"}') ->> 'id')::bigint;
update ids set dm = (api.start_direct('00000000-0000-0000-0000-0000000b2002') ->> 'conversation_id')::uuid;
select pg_temp.act_as('00000000-0000-0000-0000-0000000b2002');
select api.join_batch(null, 'BSc in Leaving', 2024);

set local role postgres;
update ids set batch = (select c.id from messaging.conversations c
                        join academics.cohort_members m on m.cohort_id = c.cohort_id
                        where m.user_id = '00000000-0000-0000-0000-0000000b2001');
insert into messaging.messages (conversation_id, sender_id, body)
values ((select batch from ids), '00000000-0000-0000-0000-0000000b2001', 'See you all in the lab'),
       ((select dm from ids), '00000000-0000-0000-0000-0000000b2001', 'Just between us');
insert into safety.moderation_actions (moderator_id, subject_user_id, action, reason)
values ('00000000-0000-0000-0000-0000000b2002', '00000000-0000-0000-0000-0000000b2001', 'warn', 'A test warning');

-- ---------------------------------------------------------------- download
select pg_temp.act_as('00000000-0000-0000-0000-0000000b2001');
select is(api.export_my_data() #>> '{account,email}', '2024bb001@beta2.test', 'the download has the account');
select is(jsonb_array_length(api.export_my_data() -> 'posts'), 1, 'and the student''s posts');
select is(jsonb_array_length(api.export_my_data() -> 'messages'), 2, 'and the messages they sent');

-- ---------------------------------------------------------------- asking and changing your mind
select throws_ok($$ select api.request_deletion('someone@else.test') $$, '22023', null, 'the email must be retyped exactly');
select ok(api.request_deletion(' 2024BB001@beta2.test ') > now() + interval '29 days', 'deletion is 30 days away');
set local role postgres;
select ok(identity.custom_access_token(jsonb_build_object('user_id', '00000000-0000-0000-0000-0000000b2001', 'claims', '{}'::jsonb))
  #> '{claims,app_metadata,deleting_at}' <> 'null'::jsonb, 'the token says so');
select pg_temp.act_as('00000000-0000-0000-0000-0000000b2001');
select api.cancel_deletion();
set local role postgres;
select is((select count(*)::integer from identity.deletion_requests where user_id = '00000000-0000-0000-0000-0000000b2001'), 0,
  'keeping the account cancels it');

-- ---------------------------------------------------------------- the day comes
select pg_temp.act_as('00000000-0000-0000-0000-0000000b2001');
select api.request_deletion('2024bb001@beta2.test');
set local role postgres;
update identity.deletion_requests set delete_after = now() - interval '1 minute' where user_id = '00000000-0000-0000-0000-0000000b2001';
select identity.run_deletions();
select is((select count(*)::integer from auth.users where id = '00000000-0000-0000-0000-0000000b2001'), 0, 'the sign-in is gone');
select is((select count(*)::integer from identity.profiles where user_id = '00000000-0000-0000-0000-0000000b2001'), 0, 'and the profile');
select is((select count(*)::integer from feed.posts where id = (select post from ids)), 0, 'and their posts');
select is((select count(*)::integer from messaging.conversations where id = (select dm from ids)), 0, 'and their direct chats');
select is((select sender_id from messaging.messages where conversation_id = (select batch from ids) and body = 'See you all in the lab'),
  null, 'group messages stay, without the sender');
select ok(exists (select 1 from ops.file_deletions where path like 'avatars/00000000-0000-0000-0000-0000000b2001/%'),
  'their photo is queued for deletion');
select is((select count(*)::integer from safety.moderation_actions where reason = 'A test warning' and subject_user_id is null), 1,
  'moderation records stay, without the person');

select * from finish();
rollback;
