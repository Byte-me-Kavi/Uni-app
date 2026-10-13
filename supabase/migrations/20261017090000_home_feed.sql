-- The home feed: a small social feed for verified students.
--
-- Posts: text (up to 1,000 characters) and up to 4 photos, for the author's university (default)
-- or every university. An optional tag: Question, Lost & found, or Notice (Notice only from batch
-- reps, merch leads and staff, shown with who it is from). No anonymous posts and no polls. Likes,
-- and comments with one level of replies.
--
-- Ranking (api.feed): candidates are live posts from the student's university in the last 30 days
-- (newest 400) and every-university posts from elsewhere in the last 7 days (newest 100), minus
-- blocked students (either way), posts marked "Not interested" and muted authors. Each is scored
-- (likes + 3 x comments + 2)^0.8 / (age in hours + 2)^1.4, raised for the student's batch, for
-- unanswered questions and notices, lowered for tags they keep hiding, for posts already seen
-- (to the bottom, not removed, so the feed never runs dry) and for an author's 2nd, 3rd... post. The
-- student's own post from the last hour sits on top.
--
-- Cost: one call per refresh returns the ordered ids (up to 200), the first page and the extra
-- cards (feed ads, a shop row, kuppi and files in their modules); one call per further page, which
-- also carries the ids seen since the last call. Like and comment counts are stored on the post
-- (kept by triggers), never counted on read; "liked by me" is one key lookup per page.
--
-- Photos: two JPEG copies per photo (1080 px wide for the feed, up to 2048 px for full screen) in
-- the public bucket under random names (posts/<id>.jpg and posts/<id>.full.jpg), uploaded through
-- the media function, which checks their first bytes and sizes (post_sign, post_commit). Deleting
-- a post goes through the media function too (post_delete), which removes its photos.
--
-- Safety: three different students reporting a post or comment hides it until a moderator looks
-- (api.feed_review, api.review_post); the author is told. Moderators (staff of the university)
-- can remove posts and comments. Rate limits: 10 posts and 150 comments a day.
--
-- Ads: an ad can now show on the Home card, in the feed, or both (ads.campaigns.placements), and
-- its numbers are counted per placement.

create schema if not exists feed;
grant usage on schema feed to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table feed.posts (
  id bigint generated always as identity primary key,
  author_id uuid not null references identity.profiles (user_id) on delete cascade,
  institution_id bigint not null references identity.institutions (id) on delete cascade,
  -- The author's batch when posting (ranking: same batch first).
  cohort_id bigint references academics.cohorts (id) on delete set null,
  audience text not null default 'university' check (audience in ('university', 'everyone')),
  tag text check (tag in ('question', 'lost_found', 'notice')),
  -- Who a notice is from ("Batch rep", the club's name, "Uni Era team").
  notice_from text check (char_length(notice_from) <= 60),
  body text not null default '' check (char_length(body) <= 1000),
  -- [{id, w, h}]: posts/<id>.jpg (feed) and posts/<id>.full.jpg.
  photos jsonb not null default '[]'::jsonb
    check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 4),
  like_count integer not null default 0 check (like_count >= 0),
  comment_count integer not null default 0 check (comment_count >= 0),
  -- hidden: after reports, until a moderator looks; removed: by a moderator.
  status text not null default 'live' check (status in ('live', 'hidden', 'removed')),
  created_at timestamptz not null default now(),
  check (char_length(btrim(body)) > 0 or jsonb_array_length(photos) > 0),
  check (tag = 'notice' or notice_from is null)
);
create index posts_university_idx on feed.posts (institution_id, created_at desc) where status = 'live';
create index posts_everyone_idx on feed.posts (created_at desc) where status = 'live' and audience = 'everyone';
create index posts_author_idx on feed.posts (author_id, created_at desc);
create index posts_cohort_idx on feed.posts (cohort_id);
create index posts_review_idx on feed.posts (institution_id, created_at desc) where status = 'hidden';
alter table feed.posts enable row level security;

create table feed.uploads (
  id uuid primary key default ops.uuid_v7(),
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  size integer not null check (size between 1 and 1500000),
  full_size integer not null check (full_size between 1 and 4000000),
  width integer not null check (width between 1 and 4096),
  height integer not null check (height between 1 and 4096),
  -- Set by the media function once both copies are JPEGs of the sizes reserved.
  checked boolean not null default false,
  post_id bigint references feed.posts (id) on delete set null,
  created_at timestamptz not null default now()
);
create index feed_uploads_user_idx on feed.uploads (user_id, created_at desc);
create index feed_uploads_post_idx on feed.uploads (post_id);
alter table feed.uploads enable row level security;

create table feed.likes (
  post_id bigint not null references feed.posts (id) on delete cascade,
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index likes_user_idx on feed.likes (user_id);
alter table feed.likes enable row level security;

create table feed.comments (
  id bigint generated always as identity primary key,
  post_id bigint not null references feed.posts (id) on delete cascade,
  author_id uuid not null references identity.profiles (user_id) on delete cascade,
  -- One level of replies: a reply's parent is a top-level comment.
  parent_id bigint references feed.comments (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index comments_post_idx on feed.comments (post_id, id);
create index comments_author_idx on feed.comments (author_id);
create index comments_parent_idx on feed.comments (parent_id);
alter table feed.comments enable row level security;

-- Posts a student has seen (on screen for a second), kept 10 days: they drop to the bottom.
-- No key to posts: rows for deleted posts go with the daily clean-up.
create table feed.seen (
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  post_id bigint not null,
  seen_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index seen_at_idx on feed.seen using brin (seen_at);
alter table feed.seen enable row level security;

-- "Not interested".
create table feed.hidden (
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  post_id bigint not null references feed.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index hidden_post_idx on feed.hidden (post_id);
alter table feed.hidden enable row level security;

create table feed.mutes (
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  author_id uuid not null references identity.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, author_id),
  check (user_id <> author_id)
);
create index mutes_author_idx on feed.mutes (author_id);
alter table feed.mutes enable row level security;
-- No grants or policies on any feed table: everything goes through the functions below.

alter table safety.reports drop constraint if exists reports_target_kind_check;
alter table safety.reports add constraint reports_target_kind_check
  check (target_kind in ('profile', 'message', 'resource', 'kuppi', 'conversation', 'kuppi_request', 'comment', 'listing',
                         'post', 'post_comment'));

alter table messaging.app_pushes drop constraint app_pushes_kind_check;
alter table messaging.app_pushes add constraint app_pushes_kind_check check (kind in (
  'kuppi_answered', 'kuppi_new', 'kuppi_cancelled', 'kuppi_starting',
  'exam_set', 'exam_tomorrow',
  'order_cancelled', 'listing_hidden', 'merch_lead', 'merch_closing', 'listing_expiring',
  'file_checked', 'file_comment', 'comment_reply',
  'account',
  'post_comment', 'post_reply', 'post_likes', 'post_hidden', 'post_removed'));
alter table messaging.app_pushes drop constraint app_pushes_channel_check;
alter table messaging.app_pushes add constraint app_pushes_channel_check
  check (channel in ('kuppi', 'exams', 'shop', 'files', 'account', 'feed'));

-- ---------------------------------------------------------------------------------------------
-- Counts
-- ---------------------------------------------------------------------------------------------

create or replace function feed.count_likes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update feed.posts p set like_count = p.like_count + 1 where p.id = new.post_id;
  else
    update feed.posts p set like_count = greatest(p.like_count - 1, 0) where p.id = old.post_id;
  end if;
  return null;
end;
$$;
create trigger likes_count after insert or delete on feed.likes
  for each row execute function feed.count_likes();

create or replace function feed.count_comments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update feed.posts p set comment_count = p.comment_count + 1 where p.id = new.post_id;
  else
    update feed.posts p set comment_count = greatest(p.comment_count - 1, 0) where p.id = old.post_id;
  end if;
  return null;
end;
$$;
create trigger comments_count after insert or delete on feed.comments
  for each row execute function feed.count_comments();

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

create or replace function feed.blocked(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from safety.blocks b
                 where (b.blocker_id = p_a and b.blocked_id = p_b) or (b.blocker_id = p_b and b.blocked_id = p_a));
$$;

-- A post the caller may see: live (or their own), at their university or for every university,
-- and nobody blocked.
create or replace function feed.can_see(p feed.posts)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (p.author_id = (select auth.uid())
         or (p.status = 'live'
             and (p.audience = 'everyone' or p.institution_id = (select identity.current_institution_id()))
             and not feed.blocked(p.author_id, (select auth.uid()))));
$$;

-- What the app shows for a post.
create or replace function feed.post_json(p feed.posts, p_uid uuid, p_institution bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'body', p.body,
    'tag', p.tag,
    'notice_from', p.notice_from,
    'audience', p.audience,
    'photos', p.photos,
    'like_count', p.like_count,
    'comment_count', p.comment_count,
    'liked', exists (select 1 from feed.likes l where l.post_id = p.id and l.user_id = p_uid),
    'created_at', p.created_at,
    'mine', p.author_id = p_uid,
    'status', p.status,
    'other', p.institution_id <> p_institution,
    'author', (
      select jsonb_build_object(
        'id', pr.user_id, 'name', pr.full_name, 'avatar_path', pr.avatar_path,
        -- Their programme and intake at the same university; the university's short name elsewhere.
        'line', case when p.institution_id = p_institution
                     then (select prog.name || ' · ' || c.intake_year from academics.cohorts c
                           join academics.programmes prog on prog.id = c.programme_id where c.id = p.cohort_id)
                     else (select coalesce(i.short_name, i.name) from identity.institutions i where i.id = p.institution_id) end)
      from identity.profiles pr where pr.user_id = p.author_id));
$$;

create or replace function feed.comment_json(c feed.comments, p_uid uuid, p_post_author uuid, p_moderator boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'parent_id', c.parent_id,
    'body', c.body,
    'created_at', c.created_at,
    'mine', c.author_id = p_uid,
    'can_delete', c.author_id = p_uid or p_post_author = p_uid or p_moderator,
    'author', (select jsonb_build_object('id', pr.user_id, 'name', pr.full_name, 'avatar_path', pr.avatar_path)
               from identity.profiles pr where pr.user_id = c.author_id));
$$;

-- Records posts as seen (up to 100 a call). Only real posts; the first sighting counts.
create or replace function feed.mark_seen(p_ids bigint[])
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into feed.seen (user_id, post_id)
  select (select auth.uid()), p.id from feed.posts p
  where p_ids is not null and cardinality(p_ids) > 0 and p.id = any (p_ids[1:100])
  on conflict do nothing;
$$;

-- The posts for these ids, in the order given, that the caller may see.
create or replace function feed.posts_for(p_ids bigint[], p_uid uuid, p_institution bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(feed.post_json(p, p_uid, p_institution) order by x.n), '[]'::jsonb)
  from unnest(p_ids[1:30]) with ordinality as x(id, n)
  join feed.posts p on p.id = x.id
  where feed.can_see(p);
$$;

-- ---------------------------------------------------------------------------------------------
-- The feed
-- ---------------------------------------------------------------------------------------------

-- Refresh: the ranked ids (up to 200), the first 15 posts, and the extra cards. p_seen: ids seen
-- since the last call.
create or replace function api.feed(p_seen bigint[] default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_institution bigint := (select identity.current_institution_id());
  v_cohort bigint;
  v_ids bigint[];
  v_modules bigint[];
  v_subjects bigint[];
begin
  if v_uid is null or v_institution is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  perform feed.mark_seen(p_seen);
  select c.id into v_cohort from academics.my_cohort() c;

  with candidates as (
    (select p.* from feed.posts p
     where p.status = 'live' and p.institution_id = v_institution and p.created_at > now() - interval '30 days'
     order by p.created_at desc limit 400)
    union all
    (select p.* from feed.posts p
     where p.status = 'live' and p.audience = 'everyone' and p.institution_id <> v_institution
       and p.created_at > now() - interval '7 days'
     order by p.created_at desc limit 100)
  ), disliked as (
    -- Tags the student hid at least twice in the last 30 days.
    select p.tag from feed.hidden h join feed.posts p on p.id = h.post_id
    where h.user_id = v_uid and h.created_at > now() - interval '30 days' and p.tag is not null
    group by p.tag having count(*) >= 2
  ), scored as (
    select c.id, c.author_id,
      case when c.author_id = v_uid and c.created_at > now() - interval '1 hour'
        then 1e12 + extract(epoch from c.created_at)
      else power(c.like_count + 3 * c.comment_count + 2, 0.8)
           / power(extract(epoch from now() - c.created_at) / 3600 + 2, 1.4)
           * case when v_cohort is not null and c.cohort_id = v_cohort then 1.5 else 1 end
           * case when c.institution_id <> v_institution then 0.8 else 1 end
           * case when c.tag = 'question' and c.comment_count = 0 then 1.2 else 1 end
           * case when c.tag = 'notice' then 1.5 else 1 end
           * case when c.tag in (select d.tag from disliked d) then 0.5 else 1 end
           * case when exists (select 1 from feed.seen s where s.user_id = v_uid and s.post_id = c.id) then 0.15 else 1 end
      end as score
    from candidates c
    where not exists (select 1 from feed.hidden h where h.user_id = v_uid and h.post_id = c.id)
      and not exists (select 1 from feed.mutes m where m.user_id = v_uid and m.author_id = c.author_id)
      and not feed.blocked(c.author_id, v_uid)
  ), spread as (
    -- An author's 2nd, 3rd... post counts less, so one person cannot fill the feed.
    select s.id, s.score * power(0.6, row_number() over (partition by s.author_id order by s.score desc) - 1) as score
    from scored s
  )
  select coalesce(array_agg(x.id order by x.score desc, x.id desc), '{}') into v_ids
  from (select * from spread order by score desc, id desc limit 200) x;

  select coalesce(array_agg(m.module_id), '{}') into v_modules from content.my_modules_for(v_uid) m;
  v_subjects := kuppi.my_subjects(v_uid);

  return jsonb_build_object(
    'ids', to_jsonb(v_ids),
    'posts', feed.posts_for(v_ids[1:15], v_uid, v_institution),
    -- Notices: who the caller may post them as (null: they cannot).
    'notice_as', feed.notice_as(v_uid, v_cohort),
    'ads', coalesce((
      select jsonb_agg(ads.slide_json(c) order by c.priority desc, c.created_at desc)
      from (select * from ads.campaigns c
            where c.active and 'feed' = any (c.placements) and c.starts_at <= now() and (c.ends_at is null or c.ends_at > now())
              and (c.institution_id is null or c.institution_id = v_institution)
            order by c.priority desc, c.created_at desc limit 3) c), '[]'::jsonb),
    -- New in the shop at the caller's university in the last 14 days (not their own).
    'shop', coalesce((
      select jsonb_agg(shop.listing_json(l, false) order by l.created_at desc)
      from (select * from shop.listings x
            where x.status = 'open' and x.institution_id = v_institution
              and (x.audience in ('university', 'everyone') or x.cohort_id = v_cohort)
              and x.seller_id <> v_uid
              and x.created_at > now() - interval '14 days'
              and (x.expires_at is null or x.expires_at > now())
              and (x.closes_at is null or x.closes_at > now())
              and not feed.blocked(x.seller_id, v_uid)
            order by x.created_at desc limit 6) l), '[]'::jsonb),
    -- Kuppi in the caller's modules in the next 3 days (not their own), soonest first.
    'kuppi', coalesce((
      select jsonb_agg(kuppi.session_json(s, v_uid) order by s.starts_at)
      from (select * from kuppi.sessions s
            where s.cancelled_at is null and s.starts_at > now() and s.starts_at < now() + interval '3 days'
              and s.host_id <> v_uid
              and ((s.institution_id = v_institution and s.module_id = any (v_modules))
                   or (s.scope = 'national' and s.institution_id <> v_institution
                       and academics.subject_of(s.module_id) = any (v_subjects)))
              and not feed.blocked(s.host_id, v_uid)
            order by s.starts_at limit 3) s), '[]'::jsonb),
    -- Files shared to the caller's modules at their university in the last 7 days (not their own).
    'files', coalesce((
      select jsonb_agg(content.resource_json(r, v_uid) order by r.created_at desc)
      from (select * from content.resources r
            where r.status = 'live' and r.deleted_at is null and r.institution_id = v_institution
              and r.module_id = any (v_modules) and r.created_at > now() - interval '7 days'
              and r.uploader_id is distinct from v_uid
              and not feed.blocked(r.uploader_id, v_uid)
            order by r.created_at desc limit 3) r), '[]'::jsonb));
end;
$$;

-- A further page: the posts for these ids (up to 30), plus the ids seen since the last call.
create or replace function api.feed_posts(p_ids bigint[], p_seen bigint[] default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  perform feed.mark_seen(p_seen);
  return feed.posts_for(p_ids, v_uid, (select identity.current_institution_id()));
end;
$$;

-- Seen posts, when the app goes to the background between pages.
create or replace function api.feed_seen(p_ids bigint[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select identity.is_active_user()) then
    return;
  end if;
  perform feed.mark_seen(p_ids);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Posting
-- ---------------------------------------------------------------------------------------------

-- Who the student may post notices as: "Batch rep", their club (merch leads) or "Uni Era team"
-- (staff). Null: they cannot post notices.
create or replace function feed.notice_as(p_uid uuid, p_cohort bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from identity.staff_roles s where s.user_id = p_uid) then 'Uni Era team'
    when p_cohort is not null and shop.is_rep(p_cohort) then 'Batch rep'
    else shop.my_club() end;
$$;

-- Reserves up to 4 photos (each a feed copy and a full copy). p_photos: [{size, full_size, width,
-- height}]. The media function signs the uploads and checks them (api.post_uploads_to_check).
create or replace function api.begin_post_upload(p_photos jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v jsonb;
  v_ids jsonb := '[]'::jsonb;
  v_id uuid;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_photos is null or jsonb_typeof(p_photos) <> 'array' or jsonb_array_length(p_photos) not between 1 and 4 then
    raise exception 'Add 1 to 4 photos.' using errcode = '22023';
  end if;
  perform messaging.hit_limit('post_upload', 60, 'You have uploaded a lot of photos today. Try again tomorrow.');
  for v in select * from jsonb_array_elements(p_photos) loop
    if coalesce(v ->> 'size', '') !~ '^[0-9]{1,8}$' or coalesce(v ->> 'full_size', '') !~ '^[0-9]{1,8}$'
       or coalesce(v ->> 'width', '') !~ '^[0-9]{1,5}$' or coalesce(v ->> 'height', '') !~ '^[0-9]{1,5}$' then
      raise exception 'Choose the photos again.' using errcode = '22023';
    end if;
    if (v ->> 'size')::integer not between 1 and 1500000 or (v ->> 'full_size')::integer not between 1 and 4000000
       or (v ->> 'width')::integer not between 1 and 4096 or (v ->> 'height')::integer not between 1 and 4096 then
      raise exception 'That photo is too large.' using errcode = '22023';
    end if;
    insert into feed.uploads (user_id, size, full_size, width, height)
    values (v_uid, (v ->> 'size')::integer, (v ->> 'full_size')::integer, (v ->> 'width')::integer, (v ->> 'height')::integer)
    returning id into v_id;
    v_ids := v_ids || jsonb_build_object('id', v_id, 'size', (v ->> 'size')::integer, 'full_size', (v ->> 'full_size')::integer);
  end loop;
  return v_ids;
end;
$$;

-- For the media function: the caller's own photos waiting for their check.
create or replace function api.post_uploads_to_check(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'size', u.size, 'full_size', u.full_size)), '[]'::jsonb)
  from feed.uploads u
  where u.id = any (p_ids[1:4]) and u.user_id = (select auth.uid()) and not u.checked;
$$;

-- The media function's verdicts (service role).
create or replace function api.post_uploads_checked(p_ok uuid[], p_bad uuid[])
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update feed.uploads u set checked = true where u.id = any (coalesce(p_ok, '{}'));
  delete from feed.uploads u where u.id = any (coalesce(p_bad, '{}')) and u.post_id is null;
$$;

-- Creates a post. p_post: body, tag (question, lost_found, notice or null), audience
-- ('university' or 'everyone'), photos (upload ids, in order).
create or replace function api.create_post(p_post jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_institution bigint := (select identity.current_institution_id());
  v_cohort bigint;
  v_body text := btrim(regexp_replace(coalesce(p_post ->> 'body', ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'));
  v_tag text := nullif(p_post ->> 'tag', '');
  v_audience text := coalesce(nullif(p_post ->> 'audience', ''), 'university');
  v_ids uuid[];
  v_photos jsonb;
  v_from text;
  v_row feed.posts;
begin
  if v_uid is null or v_institution is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_post is null or jsonb_typeof(p_post) <> 'object' then
    raise exception 'Write something first.' using errcode = '22023';
  end if;
  -- Collapses long runs of blank lines.
  v_body := regexp_replace(v_body, '\n{3,}', E'\n\n', 'g');
  if char_length(v_body) > 1000 then
    raise exception 'Keep it under 1,000 characters.' using errcode = '22023';
  end if;
  if v_audience not in ('university', 'everyone') then
    raise exception 'Choose who sees it.' using errcode = '22023';
  end if;
  if v_tag is not null and v_tag not in ('question', 'lost_found', 'notice') then
    raise exception 'Unknown tag.' using errcode = '22023';
  end if;
  select c.id into v_cohort from academics.my_cohort() c;
  if v_tag = 'notice' then
    v_from := feed.notice_as(v_uid, v_cohort);
    if v_from is null then
      raise exception 'Notices are for batch reps, merch leads and the Uni Era team.' using errcode = '42501';
    end if;
  end if;

  begin
    select coalesce(array_agg(x::uuid order by n), '{}') into v_ids
    from jsonb_array_elements_text(coalesce(p_post -> 'photos', '[]'::jsonb)) with ordinality as t(x, n);
  exception when others then
    raise exception 'Add the photos again.' using errcode = '22023';
  end;
  if cardinality(v_ids) > 4 then
    raise exception 'Up to 4 photos.' using errcode = '22023';
  end if;
  if cardinality(v_ids) <> (select count(distinct u.id) from feed.uploads u
                            where u.id = any (v_ids) and u.user_id = v_uid and u.checked and u.post_id is null) then
    raise exception 'Add the photos again.' using errcode = '22023';
  end if;
  if char_length(v_body) = 0 and cardinality(v_ids) = 0 then
    raise exception 'Write something or add a photo.' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'w', u.width, 'h', u.height) order by x.n), '[]'::jsonb)
  into v_photos
  from unnest(v_ids) with ordinality as x(id, n) join feed.uploads u on u.id = x.id;

  perform messaging.hit_limit('post', 10, 'You have posted 10 times today. Try again tomorrow.');
  insert into feed.posts (author_id, institution_id, cohort_id, audience, tag, notice_from, body, photos)
  values (v_uid, v_institution, v_cohort, v_audience, v_tag, v_from, v_body, v_photos)
  returning * into v_row;
  update feed.uploads u set post_id = v_row.id where u.id = any (v_ids);
  return feed.post_json(v_row, v_uid, v_institution);
end;
$$;

-- Deletes the caller's post, or (moderators) removes one. Returns the photo ids for the media
-- function to delete (only for the author's own delete: a removed post is kept for appeals).
create or replace function api.delete_post(p_post_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v feed.posts;
  v_photos jsonb;
begin
  if v_uid is null then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into v from feed.posts p where p.id = p_post_id for update;
  if v.id is null then
    return '[]'::jsonb;
  end if;
  if v.author_id = v_uid then
    select coalesce(jsonb_agg(u.id), '[]'::jsonb) into v_photos from feed.uploads u where u.post_id = v.id;
    delete from feed.uploads u where u.post_id = v.id;
    delete from feed.posts p where p.id = v.id;
    return v_photos;
  end if;
  if not identity.is_staff_for(v.institution_id) then
    raise exception 'This post is not available.' using errcode = '42501';
  end if;
  update feed.posts p set status = 'removed' where p.id = v.id;
  update safety.reports r set status = 'actioned', resolved_at = now()
  where r.target_kind = 'post' and r.target_id = v.id::text and r.status = 'open';
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (v_uid, 'feed.post_removed', 'feed.posts', v.id::text, jsonb_build_object('was', v.status));
  perform messaging.notify(array[v.author_id], 'post_removed', 'Your post was removed',
    'A moderator removed it for breaking the community rules: ' || left(coalesce(nullif(v.body, ''), 'your photo post'), 80),
    jsonb_build_object('href', '/'), 'feed');
  return '[]'::jsonb;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Likes and comments
-- ---------------------------------------------------------------------------------------------

-- Likes or unlikes (safe to repeat). The author hears about likes at most once an hour per post.
create or replace function api.like_post(p_post_id bigint, p_on boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v feed.posts;
  v_name text;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into v from feed.posts p where p.id = p_post_id;
  if v.id is null or not feed.can_see(v) or v.status <> 'live' then
    raise exception 'This post is not available.' using errcode = '42501';
  end if;
  if coalesce(p_on, false) then
    insert into feed.likes (post_id, user_id) values (v.id, v_uid) on conflict do nothing;
    if found and v.author_id <> v_uid then
      select split_part(p.full_name, ' ', 1) into v_name from identity.profiles p where p.user_id = v_uid;
      perform messaging.notify(array[v.author_id], 'post_likes',
        case when v.like_count = 0 then v_name || ' liked your post'
             else v_name || ' and ' || v.like_count || (case when v.like_count = 1 then ' other' else ' others' end) || ' liked your post' end,
        left(coalesce(nullif(v.body, ''), 'Your photo post'), 120),
        jsonb_build_object('href', '/post/' || v.id), 'feed', 'post_likes:' || v.id, interval '1 hour');
    end if;
  else
    delete from feed.likes l where l.post_id = v.id and l.user_id = v_uid;
  end if;
  return jsonb_build_object('liked', coalesce(p_on, false),
                            'like_count', (select p.like_count from feed.posts p where p.id = v.id));
end;
$$;

-- A post with its comments (oldest first, replies under their comment), 50 threads a page. The
-- post is included on the first page (p_after null).
create or replace function api.post_comments(p_post_id bigint, p_after bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_institution bigint := (select identity.current_institution_id());
  v feed.posts;
  v_moderator boolean;
  v_threads bigint[];
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into v from feed.posts p where p.id = p_post_id;
  if v.id is null or not feed.can_see(v) then
    raise exception 'This post is no longer available.' using errcode = '42501';
  end if;
  v_moderator := identity.is_staff_for(v.institution_id);
  select coalesce(array_agg(c.id order by c.id), '{}') into v_threads
  from (select c.id from feed.comments c
        where c.post_id = v.id and c.parent_id is null and (p_after is null or c.id > p_after)
          and not feed.blocked(c.author_id, v_uid)
        order by c.id limit 50) c;
  return jsonb_build_object(
    'post', case when p_after is null
                 then feed.post_json(v, v_uid, v_institution) || jsonb_build_object('can_moderate', v_moderator) end,
    'comments', coalesce((
      select jsonb_agg(feed.comment_json(c, v_uid, v.author_id, v_moderator) order by coalesce(c.parent_id, c.id), c.id)
      from feed.comments c
      where c.post_id = v.id and (c.id = any (v_threads) or c.parent_id = any (v_threads))
        and not feed.blocked(c.author_id, v_uid)), '[]'::jsonb),
    'more', cardinality(v_threads) = 50);
end;
$$;

create or replace function api.add_comment(p_post_id bigint, p_body text, p_parent_id bigint default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v feed.posts;
  v_parent feed.comments;
  v_body text := btrim(regexp_replace(coalesce(p_body, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'));
  v_row feed.comments;
  v_name text;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into v from feed.posts p where p.id = p_post_id;
  if v.id is null or not feed.can_see(v) or v.status <> 'live' then
    raise exception 'This post is no longer available.' using errcode = '42501';
  end if;
  if char_length(v_body) = 0 then
    raise exception 'Write a comment first.' using errcode = '22023';
  end if;
  if char_length(v_body) > 500 then
    raise exception 'Keep comments under 500 characters.' using errcode = '22023';
  end if;
  if p_parent_id is not null then
    select * into v_parent from feed.comments c where c.id = p_parent_id and c.post_id = v.id;
    if v_parent.id is null then
      raise exception 'That comment was deleted.' using errcode = '22023';
    end if;
    -- Replies to a reply go under the same comment.
    if v_parent.parent_id is not null then
      select * into v_parent from feed.comments c where c.id = v_parent.parent_id;
    end if;
    if feed.blocked(v_parent.author_id, v_uid) then
      raise exception 'You cannot reply to this comment.' using errcode = '42501';
    end if;
  end if;
  perform messaging.hit_limit('post_comment', 150, 'You have commented a lot today. Try again tomorrow.');
  insert into feed.comments (post_id, author_id, parent_id, body) values (v.id, v_uid, v_parent.id, v_body)
  returning * into v_row;

  select split_part(p.full_name, ' ', 1) into v_name from identity.profiles p where p.user_id = v_uid;
  if v_parent.id is not null and v_parent.author_id <> v_uid then
    perform messaging.notify(array[v_parent.author_id], 'post_reply', v_name || ' replied to you', left(v_body, 140),
      jsonb_build_object('href', '/post/' || v.id), 'feed', 'post_reply:' || v_parent.id, interval '15 minutes');
  end if;
  if v.author_id <> v_uid and v.author_id is distinct from v_parent.author_id then
    perform messaging.notify(array[v.author_id], 'post_comment', v_name || ' commented on your post', left(v_body, 140),
      jsonb_build_object('href', '/post/' || v.id), 'feed', 'post_comments:' || v.id, interval '15 minutes');
  end if;
  return feed.comment_json(v_row, v_uid, v.author_id, false);
end;
$$;

-- The comment's author, the post's author or a moderator deletes a comment (and its replies).
create or replace function api.delete_comment(p_comment_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v feed.comments;
  v_post feed.posts;
begin
  select * into v from feed.comments c where c.id = p_comment_id;
  if v.id is null then
    return;
  end if;
  select * into v_post from feed.posts p where p.id = v.post_id;
  if v_uid is null or not (v.author_id = v_uid or v_post.author_id = v_uid or identity.is_staff_for(v_post.institution_id)) then
    raise exception 'You cannot delete this comment.' using errcode = '42501';
  end if;
  delete from feed.comments c where c.id = v.id;
  if v.author_id <> v_uid and v_post.author_id <> v_uid then
    insert into ops.audit_log (actor_id, action, target_table, target_id, details)
    values (v_uid, 'feed.comment_removed', 'feed.comments', v.id::text, jsonb_build_object('body', v.body, 'author_id', v.author_id));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Not interested, mute, report
-- ---------------------------------------------------------------------------------------------

-- "Not interested": the post leaves the caller's feed. Returns how many of this author's posts
-- they hid in the last 30 days (the app offers to mute them from the second).
create or replace function api.hide_post(p_post_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v feed.posts;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into v from feed.posts p where p.id = p_post_id;
  if v.id is null or v.author_id = v_uid then
    return jsonb_build_object('author_hidden', 0);
  end if;
  insert into feed.hidden (user_id, post_id) values (v_uid, v.id) on conflict do nothing;
  return jsonb_build_object(
    'author_hidden', (select count(*) from feed.hidden h join feed.posts p on p.id = h.post_id
                      where h.user_id = v_uid and p.author_id = v.author_id and h.created_at > now() - interval '30 days'));
end;
$$;

create or replace function api.undo_hide_post(p_post_id bigint)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from feed.hidden h where h.user_id = (select auth.uid()) and h.post_id = p_post_id;
$$;

-- Mutes (or unmutes) a student's posts in the caller's feed. They are not told.
create or replace function api.mute_author(p_user_id uuid, p_on boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_user_id is null or p_user_id = v_uid then
    raise exception 'Choose someone else.' using errcode = '22023';
  end if;
  if coalesce(p_on, false) then
    insert into feed.mutes (user_id, author_id) values (v_uid, p_user_id) on conflict do nothing;
  else
    delete from feed.mutes m where m.user_id = v_uid and m.author_id = p_user_id;
  end if;
end;
$$;

-- Reports a post (p_kind 'post') or a comment ('post_comment'). Three different students hide a
-- post until a moderator looks (the author is told); a comment is deleted (the report keeps a copy).
create or replace function api.report_post(p_kind text, p_id bigint, p_category text, p_details text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_post feed.posts;
  v_comment feed.comments;
  v_author uuid;
  v_snapshot jsonb;
  v_id uuid;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_kind = 'post_comment' then
    select * into v_comment from feed.comments c where c.id = p_id;
    select * into v_post from feed.posts p where p.id = v_comment.post_id;
    v_author := v_comment.author_id;
  elsif p_kind = 'post' then
    select * into v_post from feed.posts p where p.id = p_id;
    v_author := v_post.author_id;
  else
    raise exception 'Unknown report.' using errcode = '22023';
  end if;
  if v_post.id is null or not feed.can_see(v_post) then
    raise exception 'This is no longer available.' using errcode = '42501';
  end if;
  if v_author = v_uid then
    raise exception 'You wrote this. Delete it instead.' using errcode = '22023';
  end if;
  if not exists (select 1 from safety.report_categories rc where rc.code = p_category) then
    raise exception 'Choose what is wrong.' using errcode = '22023';
  end if;
  if p_details is not null and char_length(p_details) > 1000 then
    raise exception 'Keep the details under 1,000 characters.' using errcode = '22023';
  end if;
  select r.id into v_id from safety.reports r
  where r.reporter_id = v_uid and r.target_kind = p_kind and r.target_id = p_id::text and r.status = 'open';
  if v_id is not null then
    return v_id;
  end if;
  perform messaging.hit_limit('report', 20, 'You have sent a lot of reports today. Our team will look at them first.');
  v_snapshot := case when p_kind = 'post'
    then to_jsonb(v_post) - 'like_count' - 'comment_count'
    else to_jsonb(v_comment) || jsonb_build_object('post', to_jsonb(v_post) - 'like_count' - 'comment_count') end;
  insert into safety.reports (reporter_id, institution_id, target_kind, target_id, category_code, details, snapshot)
  values (v_uid, v_post.institution_id, p_kind, p_id::text, p_category, nullif(btrim(coalesce(p_details, '')), ''), v_snapshot)
  returning id into v_id;

  if (select count(distinct r.reporter_id) from safety.reports r
      where r.target_kind = p_kind and r.target_id = p_id::text and r.status = 'open') >= 3 then
    if p_kind = 'post' and v_post.status = 'live' then
      update feed.posts p set status = 'hidden' where p.id = v_post.id;
      insert into ops.audit_log (actor_id, action, target_table, target_id, details)
      values (null, 'feed.hidden_after_reports', 'feed.posts', v_post.id::text, '{}'::jsonb);
      perform messaging.notify(array[v_post.author_id], 'post_hidden', 'Your post is hidden for now',
        'Several students reported it. A moderator will look at it and restore it if it is fine.',
        jsonb_build_object('href', '/'), 'feed');
    elsif p_kind = 'post_comment' then
      delete from feed.comments c where c.id = v_comment.id;
      update safety.reports r set status = 'actioned', resolved_at = now()
      where r.target_kind = 'post_comment' and r.target_id = p_id::text and r.status = 'open';
      insert into ops.audit_log (actor_id, action, target_table, target_id, details)
      values (null, 'feed.comment_removed_after_reports', 'feed.comments', v_comment.id::text,
              jsonb_build_object('body', v_comment.body, 'author_id', v_comment.author_id));
    end if;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Moderators
-- ---------------------------------------------------------------------------------------------

-- Posts hidden after reports, and live posts with open reports, at the universities the caller
-- moderates, oldest first, with the reports' reasons.
create or replace function api.feed_review()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not exists (select 1 from identity.staff_roles s where s.user_id = v_uid) then
    raise exception 'Only moderators review posts.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(feed.post_json(p, v_uid, p.institution_id) || jsonb_build_object(
             'university', (select coalesce(i.short_name, i.name) from identity.institutions i where i.id = p.institution_id),
             'reports', (select jsonb_agg(jsonb_build_object('category', rc.label, 'details', r.details) order by r.created_at)
                         from safety.reports r join safety.report_categories rc on rc.code = r.category_code
                         where r.target_kind = 'post' and r.target_id = p.id::text and r.status = 'open'))
           order by p.created_at)
    from feed.posts p
    where identity.is_staff_for(p.institution_id)
      and p.status in ('live', 'hidden')
      and exists (select 1 from safety.reports r where r.target_kind = 'post' and r.target_id = p.id::text and r.status = 'open')
    limit 100), '[]'::jsonb);
end;
$$;

-- A moderator restores a reported post (reports dismissed) or removes it.
create or replace function api.review_post(p_post_id bigint, p_action text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v feed.posts;
begin
  select * into v from feed.posts p where p.id = p_post_id for update;
  if v.id is null or v_uid is null or not identity.is_staff_for(v.institution_id) then
    raise exception 'This post is not available.' using errcode = '42501';
  end if;
  if p_action = 'remove' then
    perform api.delete_post(v.id);
  elsif p_action = 'restore' then
    update feed.posts p set status = 'live' where p.id = v.id;
    update safety.reports r set status = 'dismissed', resolved_at = now()
    where r.target_kind = 'post' and r.target_id = v.id::text and r.status = 'open';
    insert into ops.audit_log (actor_id, action, target_table, target_id, details)
    values (v_uid, 'feed.post_restored', 'feed.posts', v.id::text, jsonb_build_object('was', v.status));
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Ads in the feed
-- ---------------------------------------------------------------------------------------------

alter table ads.campaigns add column placements text[] not null default '{home}'
  check (cardinality(placements) between 1 and 2 and placements <@ array['home', 'feed']);

alter table ads.stats add column placement text not null default 'home' check (placement in ('home', 'feed'));
alter table ads.stats drop constraint stats_pkey;
alter table ads.stats add primary key (ad_id, user_id, day, placement);

create or replace function api.home_ads()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_institution bigint := (select identity.current_institution_id());
begin
  if v_institution is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(ads.slide_json(c) order by c.priority desc, c.created_at desc)
    from (select * from ads.campaigns c
          where c.active and 'home' = any (c.placements) and c.starts_at <= now() and (c.ends_at is null or c.ends_at > now())
            and (c.institution_id is null or c.institution_id = v_institution)
          order by c.priority desc, c.created_at desc
          limit 6) c), '[]'::jsonb);
end;
$$;

drop function api.ad_event(uuid, boolean);

-- A slide or feed ad was shown (p_tap false) or tapped (true). Counted once per student, ad, day
-- and placement.
create or replace function api.ad_event(p_ad_id uuid, p_tap boolean default false, p_placement text default 'home')
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_institution bigint := (select identity.current_institution_id());
begin
  if v_uid is null or v_institution is null or coalesce(p_placement, 'home') not in ('home', 'feed') then
    return;
  end if;
  if not exists (select 1 from ads.campaigns c where c.id = p_ad_id and c.active
                 and (c.institution_id is null or c.institution_id = v_institution)) then
    return;
  end if;
  insert into ads.stats as s (ad_id, user_id, tapped, placement)
  values (p_ad_id, v_uid, coalesce(p_tap, false), coalesce(p_placement, 'home'))
  on conflict (ad_id, user_id, day, placement) do update set tapped = s.tapped or excluded.tapped;
end;
$$;

create or replace function api.admin_ads()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_national boolean;
begin
  if not ads.is_admin() then
    raise exception 'Only Uni Era admins manage ads.' using errcode = '42501';
  end if;
  v_national := ads.can_manage(null);
  return jsonb_build_object(
    'national', v_national,
    'universities', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'short_name', i.short_name) order by i.name)
      from identity.institutions i where ads.can_manage(i.id)), '[]'::jsonb),
    'ads', coalesce((
      select jsonb_agg(ads.slide_json(c) || jsonb_build_object(
               'name', c.name, 'status', ads.status_of(c), 'active', c.active,
               'placements', to_jsonb(c.placements),
               'institution_id', c.institution_id,
               'university', (select coalesce(i.short_name, i.name) from identity.institutions i where i.id = c.institution_id),
               'starts_at', c.starts_at, 'ends_at', c.ends_at, 'priority', c.priority,
               'created_by', (select p.full_name from identity.profiles p where p.user_id = c.created_by),
               'updated_at', c.updated_at,
               'viewers', (select count(distinct s.user_id) from ads.stats s where s.ad_id = c.id),
               'views', (select count(*) from ads.stats s where s.ad_id = c.id),
               'taps', (select count(*) from ads.stats s where s.ad_id = c.id and s.tapped),
               'by_placement', (
                 select coalesce(jsonb_object_agg(x.placement, jsonb_build_object('viewers', x.viewers, 'taps', x.taps)), '{}'::jsonb)
                 from (select s.placement, count(distinct s.user_id) as viewers, count(*) filter (where s.tapped) as taps
                       from ads.stats s where s.ad_id = c.id group by s.placement) x))
             order by (ads.status_of(c) = 'live') desc, c.priority desc, c.created_at desc)
      from ads.campaigns c where ads.can_manage(c.institution_id)), '[]'::jsonb));
end;
$$;

-- save_ad: placements ('home', 'feed' or both; default Home).
create or replace function api.save_ad(p_ad jsonb, p_ad_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old ads.campaigns;
  v_row ads.campaigns;
  v_name text := btrim(coalesce(p_ad ->> 'name', ''));
  v_sponsor text := btrim(coalesce(p_ad ->> 'sponsor', ''));
  v_headline text := nullif(btrim(coalesce(p_ad ->> 'headline', '')), '');
  v_body text := nullif(btrim(coalesce(p_ad ->> 'body', '')), '');
  v_cta text := nullif(btrim(coalesce(p_ad ->> 'cta_label', '')), '');
  v_link text := nullif(btrim(coalesce(p_ad ->> 'link_url', '')), '');
  v_kind text := p_ad ->> 'media_kind';
  v_media text := nullif(p_ad ->> 'media_path', '');
  v_poster text := nullif(p_ad ->> 'poster_path', '');
  v_placements text[];
  v_institution bigint;
  v_starts timestamptz;
  v_ends timestamptz;
  v_priority integer;
  v_active boolean := coalesce((p_ad ->> 'active')::boolean, true);
begin
  if not ads.is_admin() then
    raise exception 'Only Uni Era admins manage ads.' using errcode = '42501';
  end if;
  if p_ad is null or jsonb_typeof(p_ad) <> 'object' then
    raise exception 'Fill in the ad.' using errcode = '22023';
  end if;
  if p_ad_id is not null then
    select * into v_old from ads.campaigns c where c.id = p_ad_id for update;
    if v_old.id is null or not ads.can_manage(v_old.institution_id) then
      raise exception 'This ad is not available.' using errcode = '42501';
    end if;
  end if;

  if coalesce(p_ad ->> 'institution_id', '') = '' then
    v_institution := null;
  elsif (p_ad ->> 'institution_id') ~ '^[0-9]{1,12}$' then
    v_institution := (p_ad ->> 'institution_id')::bigint;
  else
    raise exception 'Choose where the ad shows.' using errcode = '22023';
  end if;
  if not ads.can_manage(v_institution) then
    raise exception '%', (case when v_institution is null then 'Only national admins place ads at every university.'
                               else 'You cannot place ads at that university.' end) using errcode = '42501';
  end if;

  if jsonb_typeof(p_ad -> 'placements') = 'array' then
    select coalesce(array_agg(distinct x order by x), '{}') into v_placements
    from jsonb_array_elements_text(p_ad -> 'placements') x;
  else
    v_placements := coalesce(v_old.placements, array['home']);
  end if;
  if cardinality(v_placements) = 0 or not (v_placements <@ array['home', 'feed']) then
    raise exception 'Choose where it shows: the Home card, the feed or both.' using errcode = '22023';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'Name the ad (2 to 80 characters), for your list.' using errcode = '22023';
  end if;
  if char_length(v_sponsor) < 2 or char_length(v_sponsor) > 60 then
    raise exception 'Enter the sponsor''s name (2 to 60 characters). Students always see who it is from.' using errcode = '22023';
  end if;
  if v_headline is not null and char_length(v_headline) > 60 then
    raise exception 'Keep the headline under 60 characters.' using errcode = '22023';
  end if;
  if v_body is not null and char_length(v_body) > 140 then
    raise exception 'Keep the text under 140 characters.' using errcode = '22023';
  end if;
  if v_link is not null and (v_link !~ '^https://[^\s]+$' or char_length(v_link) > 500) then
    raise exception 'The link must start with https://' using errcode = '22023';
  end if;
  if v_cta is not null and (v_link is null or char_length(v_cta) > 24) then
    raise exception 'A button needs a link, and a label under 24 characters.' using errcode = '22023';
  end if;
  if v_link is not null and v_cta is null then
    v_cta := 'Learn more';
  end if;
  if v_kind is null or v_kind not in ('image', 'video') then
    raise exception 'Add a photo or a video.' using errcode = '22023';
  end if;
  if v_media is null then
    raise exception 'Add a photo or a video.' using errcode = '22023';
  end if;
  perform ads.check_upload(v_media, 'media', v_kind = 'video', v_old.media_path);
  if v_kind = 'video' then
    if v_poster is null then
      raise exception 'Add a cover image for the video. It shows before the video plays and on mobile data.' using errcode = '22023';
    end if;
    perform ads.check_upload(v_poster, 'poster', false, v_old.poster_path);
  else
    v_poster := null;
  end if;

  begin
    v_starts := coalesce((p_ad ->> 'starts_at')::timestamptz, now());
    v_ends := (p_ad ->> 'ends_at')::timestamptz;
  exception when others then
    raise exception 'Choose the dates again.' using errcode = '22023';
  end;
  if v_ends is not null and v_ends <= v_starts then
    raise exception 'The end must be after the start.' using errcode = '22023';
  end if;
  if coalesce(p_ad ->> 'priority', '0') !~ '^[0-9]{1,3}$' or (coalesce(p_ad ->> 'priority', '0'))::integer > 100 then
    raise exception 'Priority is 0 to 100.' using errcode = '22023';
  end if;
  v_priority := coalesce(p_ad ->> 'priority', '0')::integer;

  if v_old.id is null then
    perform messaging.hit_limit('ad_save', 50, 'You have created a lot of ads today. Try again tomorrow.');
    insert into ads.campaigns (name, sponsor, headline, body, cta_label, link_url, media_kind, media_path, poster_path,
                               institution_id, starts_at, ends_at, priority, active, placements, created_by, updated_by)
    values (v_name, v_sponsor, v_headline, v_body, v_cta, v_link, v_kind, v_media, v_poster,
            v_institution, v_starts, v_ends, v_priority, v_active, v_placements, v_uid, v_uid)
    returning * into v_row;
  else
    update ads.campaigns c set name = v_name, sponsor = v_sponsor, headline = v_headline, body = v_body, cta_label = v_cta,
      link_url = v_link, media_kind = v_kind, media_path = v_media, poster_path = v_poster, institution_id = v_institution,
      starts_at = v_starts, ends_at = v_ends, priority = v_priority, active = v_active, placements = v_placements,
      updated_by = v_uid
    where c.id = v_old.id
    returning * into v_row;
  end if;
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (v_uid, case when v_old.id is null then 'ads.created' else 'ads.changed' end, 'ads.campaigns', v_row.id::text,
          ads.slide_json(v_row) || jsonb_build_object('name', v_name, 'institution_id', v_institution, 'starts_at', v_starts,
                                                      'ends_at', v_ends, 'priority', v_priority, 'active', v_active,
                                                      'placements', to_jsonb(v_placements)));
  return ads.slide_json(v_row) || jsonb_build_object('status', ads.status_of(v_row));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Clean-up
-- ---------------------------------------------------------------------------------------------

select cron.schedule('feed-seen-cleanup', '40 21 * * *', $$delete from feed.seen where seen_at < now() - interval '10 days'$$);

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'feed' and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end;
$$;

revoke execute on function api.feed(bigint[]) from public, anon;
revoke execute on function api.feed_posts(bigint[], bigint[]) from public, anon;
revoke execute on function api.feed_seen(bigint[]) from public, anon;
revoke execute on function api.begin_post_upload(jsonb) from public, anon;
revoke execute on function api.post_uploads_to_check(uuid[]) from public, anon;
revoke execute on function api.create_post(jsonb) from public, anon;
revoke execute on function api.delete_post(bigint) from public, anon;
revoke execute on function api.like_post(bigint, boolean) from public, anon;
revoke execute on function api.post_comments(bigint, bigint) from public, anon;
revoke execute on function api.add_comment(bigint, text, bigint) from public, anon;
revoke execute on function api.delete_comment(bigint) from public, anon;
revoke execute on function api.hide_post(bigint) from public, anon;
revoke execute on function api.undo_hide_post(bigint) from public, anon;
revoke execute on function api.mute_author(uuid, boolean) from public, anon;
revoke execute on function api.report_post(text, bigint, text, text) from public, anon;
revoke execute on function api.feed_review() from public, anon;
revoke execute on function api.review_post(bigint, text) from public, anon;
revoke execute on function api.ad_event(uuid, boolean, text) from public, anon;
revoke execute on function api.post_uploads_checked(uuid[], uuid[]) from public, anon, authenticated;

grant execute on function api.feed(bigint[]) to authenticated;
grant execute on function api.feed_posts(bigint[], bigint[]) to authenticated;
grant execute on function api.feed_seen(bigint[]) to authenticated;
grant execute on function api.begin_post_upload(jsonb) to authenticated;
grant execute on function api.post_uploads_to_check(uuid[]) to authenticated;
grant execute on function api.create_post(jsonb) to authenticated;
grant execute on function api.delete_post(bigint) to authenticated;
grant execute on function api.like_post(bigint, boolean) to authenticated;
grant execute on function api.post_comments(bigint, bigint) to authenticated;
grant execute on function api.add_comment(bigint, text, bigint) to authenticated;
grant execute on function api.delete_comment(bigint) to authenticated;
grant execute on function api.hide_post(bigint) to authenticated;
grant execute on function api.undo_hide_post(bigint) to authenticated;
grant execute on function api.mute_author(uuid, boolean) to authenticated;
grant execute on function api.report_post(text, bigint, text, text) to authenticated;
grant execute on function api.feed_review() to authenticated;
grant execute on function api.review_post(bigint, text) to authenticated;
grant execute on function api.ad_event(uuid, boolean, text) to authenticated;
grant execute on function api.post_uploads_checked(uuid[], uuid[]) to service_role;
