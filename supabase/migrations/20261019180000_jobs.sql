-- Feed: part-time jobs.
--
-- Students post part-time work for other students: tutoring, events, cafes, data entry. A job is
-- a post with tag 'job' and details: what the job is, pay (an amount per hour, day, week, month or
-- for the task; optional), where (or remote), hours, a phone number (optional; "Message" always
-- works) and a closing day. The author marks it filled; a filled job, or one past its closing
-- day, sinks to the bottom like a taken bodim. Jobs decay slowly, like bodim.
--
-- Scams aimed at students (pay a "registration fee", a "deposit for the uniform") are the risk. The
-- app shows "Never pay to get a job" on every job and puts Scam first when reporting one; three
-- reports hide a job until a moderator looks, as for any post. Freshers cannot post jobs (they
-- cannot post at all).

alter table feed.posts drop constraint posts_tag_check;
alter table feed.posts add constraint posts_tag_check check (tag in ('question', 'lost_found', 'notice', 'bodim', 'job'));
alter table feed.posts drop constraint posts_has_content;
alter table feed.posts add constraint posts_has_content
  check (char_length(btrim(body)) > 0 or jsonb_array_length(photos) > 0 or tag in ('bodim', 'job'));
alter table feed.posts drop constraint posts_details_fit;
alter table feed.posts add constraint posts_details_fit
  check (coalesce(tag in ('lost_found', 'bodim', 'job'), false) = (details is not null));

create index posts_job_idx on feed.posts (institution_id, created_at desc) where status = 'live' and tag = 'job';

-- ---------------------------------------------------------------------------------------------
-- Details: jobs added (the rest as before)
-- ---------------------------------------------------------------------------------------------

create or replace function feed.clean_details(p_tag text, p_details jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  d jsonb := coalesce(p_details, '{}'::jsonb);
  v_area text;
  v_where text;
  v_phone text;
  v_facilities jsonb;
  v_role text;
  v_hours text;
  v_remote boolean;
begin
  if jsonb_typeof(d) <> 'object' then
    raise exception 'Fill in the details again.' using errcode = '22023';
  end if;
  if p_tag = 'lost_found' then
    if coalesce(d ->> 'kind', '') not in ('lost', 'found') then
      raise exception 'Say whether you lost or found it.' using errcode = '22023';
    end if;
    v_where := nullif(btrim(coalesce(d ->> 'where', '')), '');
    if v_where is not null and char_length(v_where) > 80 then
      raise exception 'Keep "where" under 80 characters.' using errcode = '22023';
    end if;
    return jsonb_strip_nulls(jsonb_build_object('kind', d ->> 'kind', 'where', v_where));
  elsif p_tag = 'bodim' then
    if coalesce(d ->> 'rent', '') !~ '^[0-9]{1,7}$' or (d ->> 'rent')::integer not between 1000 and 500000 then
      raise exception 'Enter the monthly rent in rupees (1,000 to 500,000).' using errcode = '22023';
    end if;
    if coalesce(d ->> 'gender', '') not in ('girls', 'boys', 'anyone') then
      raise exception 'Say who the place is for.' using errcode = '22023';
    end if;
    if coalesce(d ->> 'room', '') not in ('single', 'shared', 'annex', 'house') then
      raise exception 'Choose the kind of place.' using errcode = '22023';
    end if;
    v_area := btrim(coalesce(d ->> 'area', ''));
    if char_length(v_area) not between 2 and 80 then
      raise exception 'Say where it is (2 to 80 characters), like "Near Gate 2, Dalugama".' using errcode = '22023';
    end if;
    if d ? 'walk' and d ->> 'walk' is not null
       and (coalesce(d ->> 'walk', '') !~ '^[0-9]{1,3}$' or (d ->> 'walk')::integer > 180) then
      raise exception 'Minutes to campus: 0 to 180.' using errcode = '22023';
    end if;
    if d ? 'facilities' and jsonb_typeof(d -> 'facilities') = 'array' then
      select coalesce(jsonb_agg(distinct f), '[]'::jsonb) into v_facilities
      from jsonb_array_elements_text(d -> 'facilities') f
      where f in ('wifi', 'meals', 'attached_bath', 'kitchen', 'ac', 'furnished', 'parking', 'bills_included', 'laundry', 'study_area');
    end if;
    if nullif(btrim(coalesce(d ->> 'phone', '')), '') is not null then
      v_phone := shop.clean_phone(d ->> 'phone');
      if v_phone is null then
        raise exception 'Check the phone number.' using errcode = '22023';
      end if;
    end if;
    if d ? 'available_from' and d ->> 'available_from' is not null and coalesce(d ->> 'available_from', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Choose the day it is free from again.' using errcode = '22023';
    end if;
    return jsonb_strip_nulls(jsonb_build_object(
      'rent', (d ->> 'rent')::integer,
      'gender', d ->> 'gender',
      'room', d ->> 'room',
      'area', v_area,
      'walk', case when coalesce(d ->> 'walk', '') ~ '^[0-9]{1,3}$' then (d ->> 'walk')::integer end,
      'facilities', case when jsonb_array_length(coalesce(v_facilities, '[]'::jsonb)) > 0 then v_facilities end,
      'phone', v_phone,
      'available_from', d ->> 'available_from'));
  elsif p_tag = 'job' then
    v_role := btrim(coalesce(d ->> 'role', ''));
    if char_length(v_role) not between 2 and 80 then
      raise exception 'Say what the job is (2 to 80 characters), like "Maths tutor for O/L".' using errcode = '22023';
    end if;
    if d ? 'pay' and d ->> 'pay' is not null then
      if coalesce(d ->> 'pay', '') !~ '^[0-9]{1,7}$' or (d ->> 'pay')::integer not between 100 and 1000000 then
        raise exception 'Enter the pay in rupees (100 to 1,000,000), or leave it empty.' using errcode = '22023';
      end if;
      if coalesce(d ->> 'per', '') not in ('hour', 'day', 'week', 'month', 'task') then
        raise exception 'Say what the pay is for: an hour, a day, a week, a month or the whole task.' using errcode = '22023';
      end if;
    end if;
    v_remote := coalesce(d ->> 'remote', 'false') = 'true';
    v_area := nullif(btrim(coalesce(d ->> 'area', '')), '');
    if not v_remote and (v_area is null or char_length(v_area) not between 2 and 80) then
      raise exception 'Say where the work is (2 to 80 characters), or mark it remote.' using errcode = '22023';
    end if;
    if v_area is not null and char_length(v_area) > 80 then
      raise exception 'Keep "where" under 80 characters.' using errcode = '22023';
    end if;
    v_hours := nullif(btrim(coalesce(d ->> 'hours', '')), '');
    if v_hours is not null and char_length(v_hours) > 60 then
      raise exception 'Keep the hours under 60 characters, like "Weekends, 4 hours".' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(d ->> 'phone', '')), '') is not null then
      v_phone := shop.clean_phone(d ->> 'phone');
      if v_phone is null then
        raise exception 'Check the phone number.' using errcode = '22023';
      end if;
    end if;
    if d ? 'closes_on' and d ->> 'closes_on' is not null and coalesce(d ->> 'closes_on', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Choose the closing day again.' using errcode = '22023';
    end if;
    return jsonb_strip_nulls(jsonb_build_object(
      'role', v_role,
      'pay', case when d ->> 'pay' ~ '^[0-9]{1,7}$' then (d ->> 'pay')::integer end,
      'per', case when d ->> 'pay' ~ '^[0-9]{1,7}$' then d ->> 'per' end,
      'remote', case when v_remote then true end,
      'area', v_area,
      'hours', v_hours,
      'phone', v_phone,
      'closes_on', d ->> 'closes_on'));
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- The feed, posting, editing and marking done: 'job' added (the rest as before)
-- ---------------------------------------------------------------------------------------------

create or replace function api.feed(p_seen bigint[] default null, p_tag text default null)
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
  v_window interval := case when p_tag = 'bodim' then interval '90 days' else interval '30 days' end;
begin
  if v_uid is null or v_institution is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_tag is not null and p_tag not in ('question', 'lost_found', 'notice', 'bodim', 'job') then
    raise exception 'Unknown filter.' using errcode = '22023';
  end if;
  perform feed.mark_seen(p_seen);
  select c.id into v_cohort from academics.my_cohort() c;

  with candidates as (
    (select p.* from feed.posts p
     where p.status = 'live' and p.institution_id = v_institution and p.created_at > now() - v_window
       and (p_tag is null or p.tag = p_tag)
     order by p.created_at desc limit 400)
    union all
    (select p.* from feed.posts p
     where p.status = 'live' and p.audience = 'everyone' and p.institution_id <> v_institution
       and p.created_at > now() - least(v_window, interval '7 days')
       and (p_tag is null or p.tag = p_tag)
     order by p.created_at desc limit 100)
  ), disliked as (
    select p.tag from feed.hidden h join feed.posts p on p.id = h.post_id
    where h.user_id = v_uid and h.created_at > now() - interval '30 days' and p.tag is not null
    group by p.tag having count(*) >= 2
  ), scored as (
    select c.id, c.author_id,
      case when c.author_id = v_uid and c.created_at > now() - interval '1 hour'
        then 1e12 + extract(epoch from c.created_at)
      else power(c.like_count + 3 * c.comment_count + 2, 0.8)
           / power(extract(epoch from now() - c.created_at) / 3600 + 2, case when c.tag in ('bodim', 'job') then 1.1 else 1.4 end)
           * case when v_cohort is not null and c.cohort_id = v_cohort then 1.5 else 1 end
           * case when c.institution_id <> v_institution then 0.8 else 1 end
           * case when c.tag = 'question' and c.comment_count = 0 and c.resolved_at is null then 1.2 else 1 end
           * case when c.tag = 'notice' then 1.5 else 1 end
           * case when c.tag = 'job' and c.details ->> 'closes_on' < to_char(now() at time zone 'Asia/Colombo', 'YYYY-MM-DD') then 0.1
                  when c.resolved_at is null then 1 when c.tag in ('bodim', 'job') then 0.1 else 0.3 end
           * case when p_tag is null and c.tag in (select d.tag from disliked d) then 0.5 else 1 end
           * case when exists (select 1 from feed.seen s where s.user_id = v_uid and s.post_id = c.id) then 0.15 else 1 end
      end as score
    from candidates c
    where not exists (select 1 from feed.hidden h where h.user_id = v_uid and h.post_id = c.id)
      and not exists (select 1 from feed.mutes m where m.user_id = v_uid and m.author_id = c.author_id)
      and not feed.blocked(c.author_id, v_uid)
  ), spread as (
    select s.id, s.score * power(0.6, row_number() over (partition by s.author_id order by s.score desc) - 1) as score
    from scored s
  )
  select coalesce(array_agg(x.id order by x.score desc, x.id desc), '{}') into v_ids
  from (select * from spread order by score desc, id desc limit 200) x;

  if p_tag is not null then
    return jsonb_build_object(
      'ids', to_jsonb(v_ids),
      'posts', feed.posts_for(v_ids[1:15], v_uid, v_institution),
      'notice_as', feed.notice_as(v_uid, v_cohort),
      'ads', '[]'::jsonb, 'shop', '[]'::jsonb, 'kuppi', '[]'::jsonb, 'files', '[]'::jsonb);
  end if;

  select coalesce(array_agg(m.module_id), '{}') into v_modules from content.my_modules_for(v_uid) m;
  v_subjects := kuppi.my_subjects(v_uid);

  return jsonb_build_object(
    'ids', to_jsonb(v_ids),
    'posts', feed.posts_for(v_ids[1:15], v_uid, v_institution),
    'notice_as', feed.notice_as(v_uid, v_cohort),
    'ads', coalesce((
      select jsonb_agg(ads.slide_json(c) order by c.priority desc, c.created_at desc)
      from (select * from ads.campaigns c
            where c.active and 'feed' = any (c.placements) and c.starts_at <= now() and (c.ends_at is null or c.ends_at > now())
              and (c.institution_id is null or c.institution_id = v_institution)
            order by c.priority desc, c.created_at desc limit 3) c), '[]'::jsonb),
    -- New in the shop in the last 30 days: the caller's university, and other universities'
    -- listings open to everyone (not their own).
    'shop', coalesce((
      select jsonb_agg(shop.listing_json(l, false) order by (l.institution_id = v_institution) desc, l.created_at desc)
      from (select * from shop.listings x
            where x.status = 'open'
              and ((x.institution_id = v_institution and (x.audience in ('university', 'everyone') or x.cohort_id = v_cohort))
                   or (x.institution_id <> v_institution and x.audience = 'everyone'))
              and x.seller_id <> v_uid
              and x.created_at > now() - interval '30 days'
              and (x.expires_at is null or x.expires_at > now())
              and (x.closes_at is null or x.closes_at > now())
              and not feed.blocked(x.seller_id, v_uid)
            order by (x.institution_id = v_institution) desc, x.created_at desc limit 10) l), '[]'::jsonb),
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
  v_details jsonb;
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
  v_body := regexp_replace(v_body, '\n{3,}', E'\n\n', 'g');
  if char_length(v_body) > 1000 then
    raise exception 'Keep it under 1,000 characters.' using errcode = '22023';
  end if;
  if v_audience not in ('university', 'everyone') then
    raise exception 'Choose who sees it.' using errcode = '22023';
  end if;
  if v_tag is not null and v_tag not in ('question', 'lost_found', 'notice', 'bodim', 'job') then
    raise exception 'Unknown tag.' using errcode = '22023';
  end if;
  v_details := feed.clean_details(v_tag, p_post -> 'details');
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
  if char_length(v_body) = 0 and cardinality(v_ids) = 0 and coalesce(v_tag not in ('bodim', 'job'), true) then
    raise exception 'Write something or add a photo.' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'w', u.width, 'h', u.height) order by x.n), '[]'::jsonb)
  into v_photos
  from unnest(v_ids) with ordinality as x(id, n) join feed.uploads u on u.id = x.id;

  perform messaging.hit_limit('post', 10, 'You have posted 10 times today. Try again tomorrow.');
  insert into feed.posts (author_id, institution_id, cohort_id, audience, tag, notice_from, details, body, photos)
  values (v_uid, v_institution, v_cohort, v_audience, v_tag, v_from, v_details, v_body, v_photos)
  returning * into v_row;
  update feed.uploads u set post_id = v_row.id where u.id = any (v_ids);
  return feed.post_json(v_row, v_uid, v_institution);
end;
$$;

create or replace function api.edit_post(p_post_id bigint, p_post jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v feed.posts;
  v_body text := btrim(regexp_replace(coalesce(p_post ->> 'body', ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'));
  v_audience text := coalesce(nullif(p_post ->> 'audience', ''), 'university');
  v_details jsonb;
  v_row feed.posts;
begin
  select * into v from feed.posts p where p.id = p_post_id for update;
  if v.id is null or v_uid is null or v.author_id <> v_uid or v.status = 'removed' then
    raise exception 'You can only edit your own posts.' using errcode = '42501';
  end if;
  if p_post is null or jsonb_typeof(p_post) <> 'object' then
    raise exception 'Write something first.' using errcode = '22023';
  end if;
  v_body := regexp_replace(v_body, '\n{3,}', E'\n\n', 'g');
  if char_length(v_body) > 1000 then
    raise exception 'Keep it under 1,000 characters.' using errcode = '22023';
  end if;
  if v_audience not in ('university', 'everyone') then
    raise exception 'Choose who sees it.' using errcode = '22023';
  end if;
  v_details := feed.clean_details(v.tag, p_post -> 'details');
  if char_length(v_body) = 0 and jsonb_array_length(v.photos) = 0 and coalesce(v.tag not in ('bodim', 'job'), true) then
    raise exception 'Write something or add a photo.' using errcode = '22023';
  end if;
  perform messaging.hit_limit('post_edit', 50, 'You have edited a lot today. Try again tomorrow.');
  update feed.posts p set body = v_body, details = v_details, audience = v_audience,
    edited_at = case when p.body is distinct from v_body or p.details is distinct from v_details then now() else p.edited_at end
  where p.id = v.id
  returning * into v_row;
  return feed.post_json(v_row, v_uid, (select identity.current_institution_id()));
end;
$$;

create or replace function api.set_post_resolved(p_post_id bigint, p_resolved boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v feed.posts;
  v_row feed.posts;
begin
  select * into v from feed.posts p where p.id = p_post_id for update;
  if v.id is null or v_uid is null or v.author_id <> v_uid then
    raise exception 'You can only change your own posts.' using errcode = '42501';
  end if;
  if v.tag is null or v.tag not in ('question', 'lost_found', 'bodim', 'job') then
    raise exception 'Only questions, lost & found, bodim and jobs can be marked done.' using errcode = '22023';
  end if;
  update feed.posts p set resolved_at = case when coalesce(p_resolved, false) then coalesce(p.resolved_at, now()) end
  where p.id = v.id
  returning * into v_row;
  return feed.post_json(v_row, v_uid, (select identity.current_institution_id()));
end;
$$;
