-- The home feed: posting (notices only from reps, merch leads and staff; photos only after their
-- check), who sees what (university or everyone, blocks), ranking basics, likes and comments with
-- their counts and pushes, not interested, mute, reports hiding posts and comments, moderators,
-- seen posts, and feed ads.
-- Run with: supabase test db

begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public;
select plan(47);

insert into identity.institutions (id, name, short_name, kind, status) overriding system value values
  (9791, 'Test Omega University', 'TOU', 'state', 'live'),
  (9792, 'Test Psi University', 'TPU', 'state', 'live');
insert into identity.institution_email_domains (domain, institution_id) values ('omega.test', 9791), ('psi.test', 9792);

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
create function pg_temp.app_pushes(p_kind text, p_user uuid) returns integer language sql security definer as $$
  select count(*)::int from messaging.app_pushes where kind = p_kind and user_id = p_user;
$$;
create function pg_temp.in_feed(p_post bigint) returns boolean language sql as $$
  select (api.feed() -> 'ids') @> to_jsonb(p_post);
$$;
-- Photos the media function has checked.
create function pg_temp.checked_photo() returns uuid language plpgsql as $$
declare v uuid;
begin
  v := (api.begin_post_upload('[{"size": 150000, "full_size": 600000, "width": 1080, "height": 1350}]') -> 0 ->> 'id')::uuid;
  perform set_config('role', 'postgres', true);
  perform api.post_uploads_checked(array[v], null);
  perform set_config('role', 'authenticated', true);
  return v;
end $$;

-- r: rep of the 2025 batch at Omega. b: batchmate. c, d, e: Omega, another batch. z: Psi.
-- m: moderator at Omega. n: national admin. p: waiting for approval.
select pg_temp.make_user('00000000-0000-0000-0000-0000000fe001', '2025oo001@omega.test', 'Ruwan R');
select pg_temp.make_user('00000000-0000-0000-0000-0000000fe002', '2025oo002@omega.test', 'Binara B');
select pg_temp.make_user('00000000-0000-0000-0000-0000000fe003', '2024pp001@omega.test', 'Chathu C');
select pg_temp.make_user('00000000-0000-0000-0000-0000000fe004', '2024pp002@omega.test', 'Dinithi D');
select pg_temp.make_user('00000000-0000-0000-0000-0000000fe005', '2024pp003@omega.test', 'Eshan E');
select pg_temp.make_user('00000000-0000-0000-0000-0000000fe006', '2025ss001@psi.test', 'Zainab Z');
select pg_temp.make_user('00000000-0000-0000-0000-0000000fe007', 'mod@omega.test', 'Malith M');
select pg_temp.make_user('00000000-0000-0000-0000-0000000fe008', 'admin@omega.test', 'Nadeesha N');
select pg_temp.make_user('00000000-0000-0000-0000-0000000fe009', '2025oo009@omega.test', 'Pubudu P');
select set_config('role', 'postgres', true);
update identity.profiles set account_status = 'pending' where user_id = '00000000-0000-0000-0000-0000000fe009';
insert into identity.staff_roles (user_id, role, institution_id) values
  ('00000000-0000-0000-0000-0000000fe007', 'moderator', 9791),
  ('00000000-0000-0000-0000-0000000fe008', 'admin', null);

select pg_temp.act_as('00000000-0000-0000-0000-0000000fe001');
select api.join_batch(null, 'BSc in Feed Studies', 2025);
select pg_temp.act_as('00000000-0000-0000-0000-0000000fe002');
select api.join_batch((select id from academics.programmes where institution_id = 9791), null, 2025);
select pg_temp.act_as('00000000-0000-0000-0000-0000000fe003');
select api.join_batch(null, 'BSc in Other Feeds', 2024);
select pg_temp.act_as('00000000-0000-0000-0000-0000000fe006');
select api.join_batch(null, 'BSc in Psi Studies', 2025);

select set_config('role', 'postgres', true);
update messaging.conversation_members set role = 'admin'
where user_id = '00000000-0000-0000-0000-0000000fe001'
  and conversation_id = (select c.id from messaging.conversations c join academics.cohort_members m on m.cohort_id = c.cohort_id
                         where m.user_id = '00000000-0000-0000-0000-0000000fe001' and c.kind = 'cohort');
insert into messaging.push_tokens (token, user_id, platform) values
  ('ExponentPushToken[feedr]', '00000000-0000-0000-0000-0000000fe001', 'android'),
  ('ExponentPushToken[feedb]', '00000000-0000-0000-0000-0000000fe002', 'android'),
  ('ExponentPushToken[feedc]', '00000000-0000-0000-0000-0000000fe003', 'android');
create temp table ids (notice bigint, question bigint, open_post bigint, psi_everyone bigint, psi_uni bigint, photo_post bigint,
                       c_post bigint, comment bigint, reply bigint, raw uuid, ad uuid);
insert into ids default values;
grant all on pg_temp.ids to public;

-- ---------------------------------------------------------------- posting
select pg_temp.act_as('00000000-0000-0000-0000-0000000fe009');
select throws_ok($$ select api.feed() $$, '42501', null, 'students waiting for approval cannot see the feed');

select pg_temp.act_as('00000000-0000-0000-0000-0000000fe002');
select throws_ok($$ select api.create_post('{"body": "   "}') $$, '22023', null, 'a post needs words or a photo');
select throws_ok($$ select api.create_post(jsonb_build_object('body', repeat('a', 1001))) $$, '22023', null, 'up to 1,000 characters');
select throws_ok($$ select api.create_post('{"body": "Exam moved", "tag": "notice"}') $$, '42501', null,
  'only reps, merch leads and staff post notices');
update ids set question = (api.create_post('{"body": "Anyone has the CS2012 past paper?", "tag": "question"}') ->> 'id')::bigint;
update ids set raw = (api.begin_post_upload('[{"size": 150000, "full_size": 600000, "width": 1080, "height": 1350}]') -> 0 ->> 'id')::uuid;
select throws_ok($$ select api.create_post(jsonb_build_object('body', 'Found a calculator', 'photos', jsonb_build_array((select raw from ids)))) $$,
  '22023', null, 'photos are used only after their check');
update ids set photo_post = (api.create_post(jsonb_build_object('body', 'Found a calculator', 'tag', 'lost_found', 'details', jsonb_build_object('kind', 'found'),
  'photos', jsonb_build_array(pg_temp.checked_photo()))) ->> 'id')::bigint;
select is(jsonb_array_length((pg_temp.post((select photo_post from ids))).photos), 1, 'a checked photo goes on the post');
select is(((pg_temp.post((select photo_post from ids))).photos -> 0 ->> 'w')::int, 1080, 'with its size, so the app saves its space');
select throws_ok($$ select api.begin_post_upload('[{"size": 3000000, "full_size": 600000, "width": 1080, "height": 1350}]') $$,
  '22023', null, 'feed copies are small');

select pg_temp.act_as('00000000-0000-0000-0000-0000000fe001');
update ids set notice = (api.create_post('{"body": "Trip money due Friday", "tag": "notice"}') ->> 'id')::bigint;
select is((pg_temp.post((select notice from ids))).notice_from, 'Batch rep', 'a rep''s notice says it is from the batch rep');

select pg_temp.act_as('00000000-0000-0000-0000-0000000fe003');
update ids set open_post = (api.create_post('{"body": "Hackathon team anyone?", "audience": "everyone"}') ->> 'id')::bigint;
update ids set c_post = (api.create_post('{"body": "Library open till 10 tonight"}') ->> 'id')::bigint;
select pg_temp.act_as('00000000-0000-0000-0000-0000000fe006');
update ids set psi_everyone = (api.create_post('{"body": "Psi sports meet, all welcome", "audience": "everyone"}') ->> 'id')::bigint;
update ids set psi_uni = (api.create_post('{"body": "Psi canteen closed today"}') ->> 'id')::bigint;

-- ---------------------------------------------------------------- who sees what
select pg_temp.act_as('00000000-0000-0000-0000-0000000fe002');
select ok(pg_temp.in_feed((select notice from ids)) and pg_temp.in_feed((select c_post from ids)),
  'students see posts from their university');
select ok(pg_temp.in_feed((select psi_everyone from ids)), 'and every-university posts from elsewhere');
select ok(not pg_temp.in_feed((select psi_uni from ids)), 'but not another university''s own posts');
select ok((api.feed() -> 'ids' -> 0)::bigint in ((select photo_post from ids), (select question from ids)),
  'their own new post is on top');
select is((select count(*)::int from jsonb_array_elements(api.feed() -> 'posts') p
           where p -> 'author' ->> 'id' like '00000000-0000-0000-0000-0000000fe%'), 6,
  'the first page comes with the ids (real posts on the database aside)');
select is((api.feed() ->> 'notice_as'), null, 'students cannot post notices');
select pg_temp.act_as('00000000-0000-0000-0000-0000000fe006');
select is(jsonb_array_length(api.feed_posts(array[(select question from ids), (select open_post from ids)])), 1,
  'a page only has posts the student may see');
select is((api.feed_posts(array[(select open_post from ids)]) -> 0 -> 'author' ->> 'line'), 'TOU',
  'authors elsewhere show their university');

-- ---------------------------------------------------------------- likes and comments
select pg_temp.act_as('00000000-0000-0000-0000-0000000fe002');
select api.like_post((select notice from ids), true);
select api.like_post((select notice from ids), true);
select is((pg_temp.post((select notice from ids))).like_count, 1, 'liking twice counts once');
select is((api.feed_posts(array[(select notice from ids)]) -> 0 ->> 'liked'), 'true', 'the post says the student liked it');
select pg_temp.act_as('00000000-0000-0000-0000-0000000fe003');
select api.like_post((select notice from ids), true);
select is(pg_temp.app_pushes('post_likes', '00000000-0000-0000-0000-0000000fe001'), 1, 'likes reach the author at most once an hour');
select api.like_post((select notice from ids), false);
select is((pg_temp.post((select notice from ids))).like_count, 1, 'unliking takes it back');

select pg_temp.act_as('00000000-0000-0000-0000-0000000fe002');
update ids set comment = (api.add_comment((select notice from ids), 'Can we pay on Monday?') ->> 'id')::bigint;
select is(pg_temp.app_pushes('post_comment', '00000000-0000-0000-0000-0000000fe001'), 1, 'the author hears about comments');
select pg_temp.act_as('00000000-0000-0000-0000-0000000fe001');
update ids set reply = (api.add_comment((select notice from ids), 'Yes, Monday is fine', (select comment from ids)) ->> 'id')::bigint;
select is(pg_temp.app_pushes('post_reply', '00000000-0000-0000-0000-0000000fe002'), 1, 'and the commenter about replies');
select pg_temp.act_as('00000000-0000-0000-0000-0000000fe003');
select is((api.add_comment((select notice from ids), 'Same question', (select reply from ids)) ->> 'parent_id')::bigint,
  (select comment from ids), 'replies to a reply go under the same comment');
select is((pg_temp.post((select notice from ids))).comment_count, 3, 'comments are counted on the post');
select is(jsonb_array_length(api.post_comments((select notice from ids)) -> 'comments'), 3, 'the post comes with its comments');
select throws_ok($$ select api.delete_comment((select comment from ids)) $$, '42501', null, 'students cannot delete others'' comments');
select pg_temp.act_as('00000000-0000-0000-0000-0000000fe001');
select api.delete_comment((select comment from ids));
select is((pg_temp.post((select notice from ids))).comment_count, 0, 'the post''s author can, and the replies go with it');

-- ---------------------------------------------------------------- not interested, mute, block, seen
select pg_temp.act_as('00000000-0000-0000-0000-0000000fe002');
select is((api.hide_post((select c_post from ids)) ->> 'author_hidden')::int, 1, 'not interested counts the author''s hidden posts');
select ok(not pg_temp.in_feed((select c_post from ids)), 'and the post leaves the feed');
select ok(pg_temp.in_feed((select open_post from ids)), 'the author''s other posts stay');
select api.mute_author('00000000-0000-0000-0000-0000000fe003', true);
select ok(not pg_temp.in_feed((select open_post from ids)), 'until they are muted');
select api.mute_author('00000000-0000-0000-0000-0000000fe003', false);
select api.block_user('00000000-0000-0000-0000-0000000fe006');
select ok(not pg_temp.in_feed((select psi_everyone from ids)), 'blocked students'' posts are gone');
select pg_temp.act_as('00000000-0000-0000-0000-0000000fe006');
select ok(not pg_temp.in_feed((select question from ids)), 'both ways');

select pg_temp.act_as('00000000-0000-0000-0000-0000000fe003');
select api.feed_posts(array[(select notice from ids)], array[(select notice from ids), (select question from ids), -1]);
select set_config('role', 'postgres', true);
select is((select count(*)::int from feed.seen where user_id = '00000000-0000-0000-0000-0000000fe003'), 2, 'seen posts are recorded (real ones only)');

-- ---------------------------------------------------------------- reports and moderators
select pg_temp.act_as('00000000-0000-0000-0000-0000000fe003');
select api.report_post('post', (select question from ids), 'spam');
select pg_temp.act_as('00000000-0000-0000-0000-0000000fe004');
select api.report_post('post', (select question from ids), 'spam');
select throws_ok($$ select api.review_post((select question from ids), 'restore') $$, '42501', null, 'students cannot review posts');
select pg_temp.act_as('00000000-0000-0000-0000-0000000fe005');
select api.report_post('post', (select question from ids), 'harassment');
select is((pg_temp.post((select question from ids))).status, 'hidden', 'three students reporting hide a post');
select is(pg_temp.app_pushes('post_hidden', '00000000-0000-0000-0000-0000000fe002'), 1, 'and its author is told');
select ok(not pg_temp.in_feed((select question from ids)), 'it leaves everyone''s feed');
select pg_temp.act_as('00000000-0000-0000-0000-0000000fe007');
select is(jsonb_array_length(api.feed_review()), 1, 'moderators see it to review');
select api.review_post((select question from ids), 'restore');
select is((pg_temp.post((select question from ids))).status, 'live', 'and can restore it');
select api.delete_post((select c_post from ids));
select is((pg_temp.post((select c_post from ids))).status, 'removed', 'moderators remove posts (kept for appeals)');

select pg_temp.act_as('00000000-0000-0000-0000-0000000fe002');
select is(jsonb_array_length(api.delete_post((select photo_post from ids))), 1, 'deleting your post returns its photos to remove');
select is((select count(*)::int from pg_temp.post((select photo_post from ids)) p where p.id is not null), 0, 'and the post is gone');

-- ---------------------------------------------------------------- ads in the feed
select pg_temp.act_as('00000000-0000-0000-0000-0000000fe008');
create function pg_temp.ad_upload() returns text language plpgsql as $$
declare v text;
begin
  v := api.begin_ad_upload('media', 'image/jpeg', 200000) ->> 'path';
  perform set_config('role', 'postgres', true);
  perform api.ad_upload_checked(v, true);
  perform set_config('role', 'authenticated', true);
  return v;
end $$;
update ids set ad = (api.save_ad(jsonb_build_object('name', 'Feed only', 'sponsor', 'Dialog', 'media_kind', 'image',
  'media_path', pg_temp.ad_upload(), 'placements', jsonb_build_array('feed'), 'institution_id', 9791)) ->> 'id')::uuid;
select pg_temp.act_as('00000000-0000-0000-0000-0000000fe002');
select ok((api.feed() -> 'ads') @> jsonb_build_array(jsonb_build_object('id', (select ad from ids))), 'feed ads show in the feed');
select ok(not (api.home_ads() @> jsonb_build_array(jsonb_build_object('id', (select ad from ids)))), 'and not on the Home card');
select api.ad_event((select ad from ids), true, 'feed');
select pg_temp.act_as('00000000-0000-0000-0000-0000000fe008');
select is((select a -> 'by_placement' -> 'feed' ->> 'taps' from jsonb_array_elements(api.admin_ads() -> 'ads') a
           where a ->> 'id' = (select ad from ids)::text), '1', 'their numbers are counted per placement');

select * from finish();
rollback;
