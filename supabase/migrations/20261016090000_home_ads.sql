-- Ads on Home: the "you're in your uni era" card becomes a carousel, with sponsored slides after it.
--
-- Admins only (identity.staff_roles, role 'admin'): national admins place ads at every university or
-- one; admins scoped to a university only there. An ad is a photo (JPEG, PNG, WebP), an animated GIF
-- or a video (MP4 or MOV, with a cover image shown before it plays and on mobile data), plus the
-- sponsor's name (always shown as "Sponsored"), an optional headline, text and a button with an
-- https link. It runs from its start to its optional end while switched on; higher priority first.
-- Media is uploaded through the media function to the public bucket (ads/<id>.<ext>), checked by its
-- first bytes before an ad can use it. Students' views and taps are counted once per student per day,
-- for the admins' numbers. Every change is audited.

create schema if not exists ads;
grant usage on schema ads to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table ads.campaigns (
  id uuid primary key default ops.uuid_v7(),
  -- For the admins' list only ("Dialog student pack, October").
  name text not null check (char_length(btrim(name)) between 2 and 80),
  sponsor text not null check (char_length(btrim(sponsor)) between 2 and 60),
  headline text check (char_length(headline) <= 60),
  body text check (char_length(body) <= 140),
  cta_label text check (char_length(cta_label) <= 24),
  link_url text check (link_url ~ '^https://[^\s]+$' and char_length(link_url) <= 500),
  media_kind text not null check (media_kind in ('image', 'video')),
  media_path text not null check (char_length(media_path) <= 200),
  poster_path text check (char_length(poster_path) <= 200),
  -- Null: every university.
  institution_id bigint references identity.institutions (id) on delete cascade,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  priority smallint not null default 0 check (priority between 0 and 100),
  active boolean not null default true,
  created_by uuid references identity.profiles (user_id) on delete set null,
  updated_by uuid references identity.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (media_kind = 'image' or poster_path is not null),
  check (ends_at is null or ends_at > starts_at),
  check (cta_label is null or link_url is not null)
);
create index campaigns_live_idx on ads.campaigns (priority desc, created_at desc) where active;
create index campaigns_institution_idx on ads.campaigns (institution_id);
create index campaigns_created_by_idx on ads.campaigns (created_by);
create index campaigns_updated_by_idx on ads.campaigns (updated_by);
create trigger campaigns_touch before update on ads.campaigns
  for each row execute function ops.touch_updated_at();
alter table ads.campaigns enable row level security;

create table ads.uploads (
  path text primary key,
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  kind text not null check (kind in ('media', 'poster')),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime')),
  size integer not null check (size > 0),
  -- Set by the media function once the first bytes match the type.
  checked boolean not null default false,
  created_at timestamptz not null default now()
);
create index ad_uploads_user_idx on ads.uploads (user_id, created_at desc);
alter table ads.uploads enable row level security;

-- One row per student, ad and day: seen, and whether they tapped it.
create table ads.stats (
  ad_id uuid not null references ads.campaigns (id) on delete cascade,
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  day date not null default (now() at time zone 'Asia/Colombo')::date,
  tapped boolean not null default false,
  primary key (ad_id, user_id, day)
);
create index ad_stats_user_idx on ads.stats (user_id);
alter table ads.stats enable row level security;
-- No grants or policies: through the functions below.

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- An admin who may place ads at this university (null: every university, national admins only).
create or replace function ads.can_manage(p_institution_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select identity.is_active_user()) and exists (
    select 1 from identity.staff_roles s
    where s.user_id = (select auth.uid()) and s.role = 'admin'
      and (s.institution_id is null or (p_institution_id is not null and s.institution_id = p_institution_id)));
$$;

-- Any admin.
create or replace function ads.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select identity.is_active_user()) and exists (
    select 1 from identity.staff_roles s where s.user_id = (select auth.uid()) and s.role = 'admin');
$$;

create or replace function ads.status_of(c ads.campaigns)
returns text
language sql
stable
set search_path = ''
as $$
  select case when not c.active then 'paused'
              when c.ends_at is not null and c.ends_at <= now() then 'ended'
              when c.starts_at > now() then 'scheduled'
              else 'live' end;
$$;

-- What a slide on Home needs.
create or replace function ads.slide_json(c ads.campaigns)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'sponsor', c.sponsor, 'headline', c.headline, 'body', c.body,
    'cta_label', c.cta_label, 'link_url', c.link_url,
    'media_kind', c.media_kind, 'media_path', c.media_path, 'poster_path', c.poster_path);
$$;

-- Every upload path must be the admin's own, checked, of the right kind and type.
create or replace function ads.check_upload(p_path text, p_kind text, p_video boolean, p_old text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_path is null then
    return;
  end if;
  if p_path is not distinct from p_old then
    return;
  end if;
  if not exists (
    select 1 from ads.uploads u
    where u.path = p_path and u.user_id = (select auth.uid()) and u.kind = p_kind and u.checked
      and (p_video is null or (u.mime like 'video/%') = p_video)) then
    raise exception '%', case when p_kind = 'poster' then 'Add the cover image again.' else 'Add the photo or video again.' end
      using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Home: the slides, and counting views and taps
-- ---------------------------------------------------------------------------------------------

-- Live ads for the caller's university (and every university), highest priority first, up to 6.
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
          where c.active and c.starts_at <= now() and (c.ends_at is null or c.ends_at > now())
            and (c.institution_id is null or c.institution_id = v_institution)
          order by c.priority desc, c.created_at desc
          limit 6) c), '[]'::jsonb);
end;
$$;

-- A slide was shown (p_tap false) or tapped (true). Counted once per student, ad and day.
create or replace function api.ad_event(p_ad_id uuid, p_tap boolean default false)
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
  if v_uid is null or v_institution is null then
    return;
  end if;
  if not exists (select 1 from ads.campaigns c where c.id = p_ad_id and c.active
                 and (c.institution_id is null or c.institution_id = v_institution)) then
    return;
  end if;
  insert into ads.stats as s (ad_id, user_id, tapped) values (p_ad_id, v_uid, coalesce(p_tap, false))
  on conflict (ad_id, user_id, day) do update set tapped = s.tapped or excluded.tapped;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Admins
-- ---------------------------------------------------------------------------------------------

-- The admin's ads (all of them for national admins, their university's otherwise), with numbers,
-- and the universities they may place ads at.
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
               'institution_id', c.institution_id,
               'university', (select coalesce(i.short_name, i.name) from identity.institutions i where i.id = c.institution_id),
               'starts_at', c.starts_at, 'ends_at', c.ends_at, 'priority', c.priority,
               'created_by', (select p.full_name from identity.profiles p where p.user_id = c.created_by),
               'updated_at', c.updated_at,
               'viewers', (select count(distinct s.user_id) from ads.stats s where s.ad_id = c.id),
               'views', (select count(*) from ads.stats s where s.ad_id = c.id),
               'taps', (select count(*) from ads.stats s where s.ad_id = c.id and s.tapped))
             order by (ads.status_of(c) = 'live') desc, c.priority desc, c.created_at desc)
      from ads.campaigns c where ads.can_manage(c.institution_id)), '[]'::jsonb));
end;
$$;

-- Reserves a public path for one ad photo, GIF, video or cover image. The media function signs an
-- upload for exactly this path, type and size, then checks its first bytes (api.ad_upload_checked).
create or replace function api.begin_ad_upload(p_kind text, p_mime text, p_size integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_video boolean := p_mime in ('video/mp4', 'video/quicktime');
  v_path text;
begin
  if not ads.is_admin() then
    raise exception 'Only Uni Era admins manage ads.' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('media', 'poster') then
    raise exception 'Unknown upload.' using errcode = '22023';
  end if;
  if p_mime is null or p_mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime')
     or (p_kind = 'poster' and (v_video or p_mime = 'image/gif')) then
    raise exception 'Use a JPEG, PNG, WebP or GIF photo, or an MP4 or MOV video. The cover is a photo.' using errcode = '22023';
  end if;
  if p_size is null or p_size <= 0 or p_size > (case when v_video then 25000000 else 5000000 end) then
    raise exception '%', (case when v_video then 'Videos can be up to 25 MB.' else 'Photos and GIFs can be up to 5 MB.' end)
      using errcode = '22023';
  end if;
  perform messaging.hit_limit('ad_upload', 100, 'You have uploaded a lot today. Try again tomorrow.');
  v_path := 'ads/' || ops.uuid_v7() || '.' || (case p_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png'
    when 'image/webp' then 'webp' when 'image/gif' then 'gif' when 'video/mp4' then 'mp4' else 'mov' end);
  insert into ads.uploads (path, user_id, kind, mime, size) values (v_path, (select auth.uid()), p_kind, p_mime, p_size);
  return jsonb_build_object('path', v_path, 'mime', p_mime);
end;
$$;

-- For the media function: the caller's own upload waiting for its check.
create or replace function api.ad_upload_to_check(p_path text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('path', u.path, 'mime', u.mime, 'size', u.size)
  from ads.uploads u
  where u.path = p_path and u.user_id = (select auth.uid()) and not u.checked and ads.is_admin();
$$;

-- The media function's verdict (service role).
create or replace function api.ad_upload_checked(p_path text, p_ok boolean)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update ads.uploads u set checked = true where u.path = p_path and p_ok;
  delete from ads.uploads u where u.path = p_path and not p_ok;
$$;

-- Creates (no p_ad_id) or edits an ad. p_ad: name, sponsor, headline, body, cta_label, link_url,
-- media_kind ('image' or 'video'), media_path, poster_path (videos), institution_id (null: every
-- university), starts_at, ends_at, priority (0 to 100), active.
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
                               institution_id, starts_at, ends_at, priority, active, created_by, updated_by)
    values (v_name, v_sponsor, v_headline, v_body, v_cta, v_link, v_kind, v_media, v_poster,
            v_institution, v_starts, v_ends, v_priority, v_active, v_uid, v_uid)
    returning * into v_row;
  else
    update ads.campaigns c set name = v_name, sponsor = v_sponsor, headline = v_headline, body = v_body, cta_label = v_cta,
      link_url = v_link, media_kind = v_kind, media_path = v_media, poster_path = v_poster, institution_id = v_institution,
      starts_at = v_starts, ends_at = v_ends, priority = v_priority, active = v_active, updated_by = v_uid
    where c.id = v_old.id
    returning * into v_row;
  end if;
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (v_uid, case when v_old.id is null then 'ads.created' else 'ads.changed' end, 'ads.campaigns', v_row.id::text,
          ads.slide_json(v_row) || jsonb_build_object('name', v_name, 'institution_id', v_institution, 'starts_at', v_starts,
                                                      'ends_at', v_ends, 'priority', v_priority, 'active', v_active));
  return ads.slide_json(v_row) || jsonb_build_object('status', ads.status_of(v_row));
end;
$$;

-- Switches an ad on or off.
create or replace function api.set_ad_active(p_ad_id uuid, p_active boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v ads.campaigns;
begin
  select * into v from ads.campaigns c where c.id = p_ad_id for update;
  if v.id is null or not ads.can_manage(v.institution_id) then
    raise exception 'This ad is not available.' using errcode = '42501';
  end if;
  update ads.campaigns c set active = coalesce(p_active, false), updated_by = (select auth.uid()) where c.id = v.id;
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values ((select auth.uid()), case when p_active then 'ads.resumed' else 'ads.paused' end, 'ads.campaigns', v.id::text, '{}'::jsonb);
end;
$$;

-- Deletes an ad (its numbers go with it).
create or replace function api.delete_ad(p_ad_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v ads.campaigns;
begin
  select * into v from ads.campaigns c where c.id = p_ad_id for update;
  if v.id is null or not ads.can_manage(v.institution_id) then
    raise exception 'This ad is not available.' using errcode = '42501';
  end if;
  delete from ads.campaigns c where c.id = v.id;
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values ((select auth.uid()), 'ads.deleted', 'ads.campaigns', v.id::text, ads.slide_json(v) || jsonb_build_object('name', v.name));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'ads' and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end;
$$;

revoke execute on function api.home_ads() from public, anon;
revoke execute on function api.ad_event(uuid, boolean) from public, anon;
revoke execute on function api.admin_ads() from public, anon;
revoke execute on function api.begin_ad_upload(text, text, integer) from public, anon;
revoke execute on function api.ad_upload_to_check(text) from public, anon;
revoke execute on function api.save_ad(jsonb, uuid) from public, anon;
revoke execute on function api.set_ad_active(uuid, boolean) from public, anon;
revoke execute on function api.delete_ad(uuid) from public, anon;
revoke execute on function api.ad_upload_checked(text, boolean) from public, anon, authenticated;

grant execute on function api.home_ads() to authenticated;
grant execute on function api.ad_event(uuid, boolean) to authenticated;
grant execute on function api.admin_ads() to authenticated;
grant execute on function api.begin_ad_upload(text, text, integer) to authenticated;
grant execute on function api.ad_upload_to_check(text) to authenticated;
grant execute on function api.save_ad(jsonb, uuid) to authenticated;
grant execute on function api.set_ad_active(uuid, boolean) to authenticated;
grant execute on function api.delete_ad(uuid) to authenticated;
grant execute on function api.ad_upload_checked(text, boolean) to service_role;
