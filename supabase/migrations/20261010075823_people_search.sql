-- Find students by name, across every university.
--
-- Search answers every keystroke, so it has to stay at a few milliseconds with 500,000 students.
-- Measured on this project's database (Postgres 17, free-tier compute) with 500,000 generated Sri
-- Lankan names, server time per search (Oct 2026):
--
--   pg_trgm GIN, LIKE ranked by similarity     110-210 ms typical, 590 ms worst
--   pg_trgm GiST nearest neighbour             1-170 ms typical, 200 ms worst
--   full-text prefix (tsvector 'kav:*')        7-37 ms typical, 97 ms worst
--   word and word-pair keys (this design)      1-3 ms typical; 95% under 5 ms for one or two words
--
-- The others have to find every match before they can rank and keep the top few ("ka" matches tens
-- of thousands of names). Here each findable student is stored as sorted keys: every word of the
-- name ("kavisha") and every pair of words in name order ("kavisha munasinghe", skipping middle
-- names). A search is then a B-tree range scan that reads keys in order and stops after 20 rows,
-- however many students share the prefix. Size: about 4 keys per student.
--
-- Results come in three tiers, each its own scan: batchmates, then the student's own university,
-- then everyone else. Typos ("kvaisha") are corrected against a dictionary of name words, only
-- when a search finds nobody, so normal searches never pay for it.

-- ---------------------------------------------------------------------------------------------
-- Who can find me. Default: every verified student, since the app exists to connect students
-- across universities. Search shows name, university and batch only; never email.
-- ---------------------------------------------------------------------------------------------
alter table identity.privacy_settings
  add column findable_by text not null default 'everyone'
    check (findable_by in ('everyone', 'my_institution', 'nobody'));
grant update (findable_by) on identity.privacy_settings to authenticated;

-- Lower case; anything that is not a letter or digit becomes a space. Sinhala and Tamil letters,
-- vowel signs and the joiners used in Sinhala conjuncts are kept ([[:alnum:]] alone drops signs).
create or replace function identity.search_text(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(lower(coalesce(p_text, '')),
    '[^[:alnum:]஀-௿඀-෿‌‍]+', ' ', 'g'));
$$;

-- ' kavisha dilshan munasinghe': the leading space lets '% mun%' match the start of any word.
alter table identity.profiles
  add column search_name text generated always as (' ' || identity.search_text(full_name)) stored;

-- Distinct words of two or more letters, in name order (initials such as "W.M." are skipped).
create or replace function identity.name_words(p_full_name text)
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(array_agg(s.w order by s.n), '{}')
  from (
    select x.w, min(x.n) as n
    from unnest(string_to_array(identity.search_text(p_full_name), ' ')) with ordinality as x (w, n)
    where char_length(x.w) >= 2
    group by x.w
    order by min(x.n)
    limit 8
  ) s;
$$;

-- ---------------------------------------------------------------------------------------------
-- Search keys. Only findable, active students have rows; the triggers below keep them current.
-- No primary key on purpose: rows are replaced per student, and a unique index on every key
-- would cost as much again as the table.
-- ---------------------------------------------------------------------------------------------
create table identity.search_keys (
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  institution_id bigint not null,
  -- 1: one word ("kavisha"); 2: two words in name order ("kavisha munasinghe").
  kind smallint not null check (kind in (1, 2)),
  -- Findable by students at other universities (findable_by = 'everyone').
  national boolean not null,
  -- Byte order ("C"), so prefix ranges are plain index range scans.
  key text collate "C" not null
);
create index search_keys_institution_idx on identity.search_keys (institution_id, kind, key);
create index search_keys_national_idx on identity.search_keys (kind, key) where national;
create index search_keys_user_idx on identity.search_keys (user_id);
alter table identity.search_keys enable row level security;

-- How many findable students have each word. Used to correct typos; nothing else.
create table identity.search_words (
  word text collate "C" primary key,
  people integer not null check (people >= 0)
);
create index search_words_trgm_idx on identity.search_words using gist (word extensions.gist_trgm_ops);
alter table identity.search_words enable row level security;

-- Rebuilds one student's keys from their profile and privacy setting. Removes them when the
-- account is not active, the student is not findable, or the profile is being deleted.
create or replace function identity.sync_search_keys(p_user_id uuid, p_removing boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_institution bigint;
  v_full_name text;
  v_findable text;
  v_old text[];
  v_new text[] := '{}';
begin
  select coalesce(array_agg(k.key), '{}') into v_old
  from identity.search_keys k where k.user_id = p_user_id and k.kind = 1;
  delete from identity.search_keys k where k.user_id = p_user_id;

  if not p_removing then
    select p.institution_id, p.full_name,
      case when p.account_status = 'active' then coalesce(s.findable_by, 'everyone') else 'nobody' end
    into v_institution, v_full_name, v_findable
    from identity.profiles p
    left join identity.privacy_settings s on s.user_id = p.user_id
    where p.user_id = p_user_id;
  end if;

  if v_findable in ('everyone', 'my_institution') then
    v_new := identity.name_words(v_full_name);
    insert into identity.search_keys (user_id, institution_id, kind, national, key)
    select p_user_id, v_institution, 1, v_findable = 'everyone', w from unnest(v_new) w
    union all
    select p_user_id, v_institution, 2, v_findable = 'everyone', v_new[i] || ' ' || v_new[j]
    from generate_series(1, least(cardinality(v_new), 5)) i,
         generate_series(1, least(cardinality(v_new), 5)) j
    where i < j;
  end if;

  update identity.search_words w set people = w.people - 1
  where w.word = any (v_old) and not w.word = any (v_new);
  delete from identity.search_words w where w.people = 0 and w.word = any (v_old);
  insert into identity.search_words as w (word, people)
  select x, 1 from unnest(v_new) x where not x = any (v_old)
  on conflict (word) do update set people = w.people + 1;
end;
$$;

create or replace function identity.search_keys_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Before the delete, so the dictionary counts are still known (the keys cascade anyway).
    perform identity.sync_search_keys(old.user_id, true);
    return old;
  end if;
  perform identity.sync_search_keys(new.user_id);
  return null;
end;
$$;

create trigger profiles_search_keys_insert after insert on identity.profiles
  for each row execute function identity.search_keys_trigger();
create trigger profiles_search_keys_update after update of full_name, account_status, institution_id on identity.profiles
  for each row
  when (old.full_name is distinct from new.full_name
    or old.account_status is distinct from new.account_status
    or old.institution_id is distinct from new.institution_id)
  execute function identity.search_keys_trigger();
create trigger profiles_search_keys_delete before delete on identity.profiles
  for each row execute function identity.search_keys_trigger();
create trigger privacy_search_keys after insert or update of findable_by on identity.privacy_settings
  for each row execute function identity.search_keys_trigger();

revoke execute on function identity.sync_search_keys(uuid, boolean) from public, anon, authenticated;
revoke execute on function identity.search_keys_trigger() from public, anon, authenticated;

-- Students who are already active.
select identity.sync_search_keys(p.user_id) from identity.profiles p;

-- ---------------------------------------------------------------------------------------------
-- The search itself. Returns at most 8 students, best first: batchmates, the caller's university,
-- then other universities. Excludes the caller and anyone blocked in either direction.
-- ---------------------------------------------------------------------------------------------
create or replace function identity.find_people(p_me uuid, p_institution bigint, p_cohort bigint, p_words text[])
returns uuid[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_patterns text[] := array(select '% ' || w || '%' from unnest(p_words) w);
  v_kind smallint := least(cardinality(p_words), 2);
  -- One word: its prefix. Two or more: the first word complete, then the start of the second.
  v_key text := array_to_string(p_words[1:2], ' ');
  v_hi text := v_key || chr(1114111);
  v_more boolean := cardinality(p_words) > 2;
  v_probe text;
  v_ids uuid[];
begin
  select array_agg(x.user_id order by x.tier, x.key) into v_ids from (
    select c.user_id, min(c.tier) as tier, min(c.key) as key
    from (
      (select m.user_id, 0 as tier, p.search_name as key
        from academics.cohort_members m
        join identity.profiles p on p.user_id = m.user_id
        where m.cohort_id = p_cohort
          and p.search_name like all (v_patterns)
          and exists (select 1 from identity.search_keys k where k.user_id = m.user_id)
        order by p.search_name
        limit 20)
      union all
      (select k.user_id, 1, k.key
        from identity.search_keys k
        where k.institution_id = p_institution and k.kind = v_kind and k.key >= v_key and k.key < v_hi
          and (not v_more or exists (
            select 1 from identity.profiles p where p.user_id = k.user_id and p.search_name like all (v_patterns)))
        order by k.key
        limit 20)
      union all
      (select k.user_id, 2, k.key
        from identity.search_keys k
        where k.national and k.kind = v_kind and k.key >= v_key and k.key < v_hi
          and (not v_more or exists (
            select 1 from identity.profiles p where p.user_id = k.user_id and p.search_name like all (v_patterns)))
        order by k.key
        limit 20)
    ) c
    where c.user_id <> p_me
      and not exists (select 1 from safety.blocks b where b.blocker_id = p_me and b.blocked_id = c.user_id)
      and not exists (select 1 from safety.blocks b where b.blocker_id = c.user_id and b.blocked_id = p_me)
    group by c.user_id
    order by min(c.tier), min(c.key)
    limit 8
  ) x;
  v_ids := coalesce(v_ids, '{}');

  -- Words out of name order ("munasinghe kav") or a shortened first word ("kav mun"): look up the
  -- longest word and check the rest against the full name. The first 300 keys per tier are the
  -- budget, so this stays bounded however common the word is.
  if cardinality(v_ids) < 8 and cardinality(p_words) > 1 then
    select w into v_probe from unnest(p_words) w order by char_length(w) desc limit 1;
    select array_agg(x.user_id order by x.tier, x.key) into v_ids from (
      select c.user_id, min(c.tier) as tier, min(c.key) as key
      from (
        select f.id as user_id, -1 as tier, lpad(f.n::text, 4, '0') as key
        from unnest(v_ids) with ordinality as f (id, n)
        union all
        (select t.user_id, 1, t.key
          from (select k.user_id, k.key from identity.search_keys k
                where k.institution_id = p_institution and k.kind = 1
                  and k.key >= v_probe and k.key < v_probe || chr(1114111)
                order by k.key limit 300) t
          join identity.profiles p on p.user_id = t.user_id and p.search_name like all (v_patterns)
          limit 20)
        union all
        (select t.user_id, 2, t.key
          from (select k.user_id, k.key from identity.search_keys k
                where k.national and k.kind = 1
                  and k.key >= v_probe and k.key < v_probe || chr(1114111)
                order by k.key limit 300) t
          join identity.profiles p on p.user_id = t.user_id and p.search_name like all (v_patterns)
          limit 20)
      ) c
      where c.user_id <> p_me
        and not exists (select 1 from safety.blocks b where b.blocker_id = p_me and b.blocked_id = c.user_id)
        and not exists (select 1 from safety.blocks b where b.blocker_id = c.user_id and b.blocked_id = p_me)
      group by c.user_id
      order by min(c.tier), min(c.key)
      limit 8
    ) x;
    v_ids := coalesce(v_ids, '{}');
  end if;

  return v_ids;
end;
$$;

-- Replaces each word of three or more letters that no findable student's name starts with by the
-- closest dictionary word ("kvaisha" -> "kavisha"). Words that already match stay as typed.
-- Word similarity of common slips, measured: perrera/perera 0.67, dilshn/dilshan 0.71,
-- munsinghe/munasinghe 0.62, nmal/nimal 0.40, kvaisha/kavisha 0.38 (swapped letters break the most
-- trigrams). It only runs when nothing matched and takes the single closest word, so the bar is
-- low: 0.35.
create or replace function identity.correct_words(p_words text[])
returns text[]
language sql
stable
set search_path = ''
as $$
  select array_agg(coalesce(
    case
      when char_length(x.w) < 3 then x.w
      when exists (select 1 from identity.search_words s where s.word >= x.w and s.word < x.w || chr(1114111)) then x.w
    end,
    (select c.word from (
       select s.word, x.w operator(extensions.<<->) s.word as distance
       from identity.search_words s
       order by distance
       limit 1
     ) c where c.distance <= 0.65),
    x.w) order by x.n)
  from unnest(p_words) with ordinality as x (w, n);
$$;

revoke execute on function identity.find_people(uuid, bigint, bigint, text[]) from public, anon, authenticated;
revoke execute on function identity.correct_words(text[]) from public, anon, authenticated;

-- 120 searches a minute per student: far above typing speed, low enough to stop scraping the
-- directory. Over the limit answers HTTP 429.
create or replace function api.search_people(p_query text)
returns table (
  user_id uuid,
  full_name text,
  institution text,
  programme text,
  intake_year integer,
  relation text,
  corrected boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_institution bigint;
  v_cohort bigint;
  v_hits integer;
  v_words text[];
  v_fixed text[];
  v_ids uuid[];
  v_corrected boolean := false;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  v_words := (array(
    select w from unnest(string_to_array(identity.search_text(left(p_query, 100)), ' ')) w where w <> ''
  ))[1:4];
  if coalesce(char_length(array_to_string(v_words, '')), 0) < 2 then
    return;
  end if;

  insert into ops.rate_limits as r (user_id, action, window_start, hits)
  values (v_uid, 'search_people', date_trunc('minute', now()), 1)
  on conflict on constraint rate_limits_pkey do update set hits = r.hits + 1
  returning r.hits into v_hits;
  if v_hits > 120 then
    raise exception 'Too many searches. Try again in a minute.' using errcode = 'PT429';
  end if;

  select p.institution_id, m.cohort_id into v_institution, v_cohort
  from identity.profiles p
  left join academics.cohort_members m on m.user_id = p.user_id
  where p.user_id = v_uid;

  v_ids := identity.find_people(v_uid, v_institution, v_cohort, v_words);
  if cardinality(v_ids) = 0 then
    v_fixed := identity.correct_words(v_words);
    if v_fixed is distinct from v_words then
      v_ids := identity.find_people(v_uid, v_institution, v_cohort, v_fixed);
      v_corrected := true;
    end if;
  end if;

  return query
  select p.user_id, p.full_name, coalesce(i.short_name, i.name), pr.name, c.intake_year::integer,
    case
      when v_cohort is not null and m.cohort_id = v_cohort then 'batchmate'
      when p.institution_id = v_institution then 'university'
    end,
    v_corrected
  from unnest(v_ids) with ordinality as f (id, n)
  join identity.profiles p on p.user_id = f.id
  join identity.institutions i on i.id = p.institution_id
  left join academics.cohort_members m on m.user_id = p.user_id
  left join academics.cohorts c on c.id = m.cohort_id
  left join academics.programmes pr on pr.id = c.programme_id
  order by f.n;
end;
$$;
grant execute on function api.search_people(text) to authenticated;

-- One student's public card: name, university, batch, how they relate to the caller. Null when
-- the caller may not see them (not findable to the caller, blocked either way, or not active).
create or replace function api.person(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_institution bigint;
  v_cohort bigint;
  v_result jsonb;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  select p.institution_id, m.cohort_id into v_institution, v_cohort
  from identity.profiles p
  left join academics.cohort_members m on m.user_id = p.user_id
  where p.user_id = v_uid;

  select jsonb_build_object(
    'user_id', p.user_id,
    'full_name', p.full_name,
    'bio', p.bio,
    'institution', jsonb_build_object('name', i.name, 'short_name', i.short_name),
    'batch', case when c.id is null then null
      else jsonb_build_object('programme', pr.name, 'intake_year', c.intake_year) end,
    'relation', case
      when p.user_id = v_uid then 'you'
      when v_cohort is not null and m.cohort_id = v_cohort then 'batchmate'
      when p.institution_id = v_institution then 'university'
    end
  ) into v_result
  from identity.profiles p
  join identity.institutions i on i.id = p.institution_id
  left join academics.cohort_members m on m.user_id = p.user_id
  left join academics.cohorts c on c.id = m.cohort_id
  left join academics.programmes pr on pr.id = c.programme_id
  where p.user_id = p_user_id
    and (
      p.user_id = v_uid
      or (
        exists (select 1 from identity.search_keys k
                where k.user_id = p.user_id and (k.national or k.institution_id = v_institution))
        and not exists (select 1 from safety.blocks b where b.blocker_id = v_uid and b.blocked_id = p.user_id)
        and not exists (select 1 from safety.blocks b where b.blocker_id = p.user_id and b.blocked_id = v_uid)
      )
    );

  return v_result;
end;
$$;
grant execute on function api.person(uuid) to authenticated;

-- Rate-limit windows are only needed for a minute; clear old ones hourly.
select cron.schedule('ops-clear-rate-limits', '17 * * * *',
  $$delete from ops.rate_limits where window_start < now() - interval '1 hour'$$);
