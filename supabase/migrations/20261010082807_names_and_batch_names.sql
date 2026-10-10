-- Two changes.
--
-- 1. Students choose their name after a moderator approves them, not at sign-up. Sign-up is
--    shorter, and the name is typed when the student first opens the app. Until then the profile
--    holds a placeholder (the email's local part), the student is not searchable, and the access
--    token says name_confirmed = false so the app shows the name screen first. A student sets
--    their name once; changing it later goes through a moderator, so a verified account cannot
--    keep renaming itself to look like someone else.
--
-- 2. Batches are named with their university: "UCSC · BSc in Computer Science · 2023". The same
--    programme name exists at many universities, so the name alone does not tell their group
--    chats apart. One function builds the name; batch chat titles follow programme and
--    university renames.

-- ---------------------------------------------------------------------------------------------
-- 1. Names after approval
-- ---------------------------------------------------------------------------------------------
alter table identity.profiles add column name_confirmed_at timestamptz;

-- Existing accounts: a name with a space was typed by the student at sign-up. The rest hold an
-- email placeholder and will be asked.
update identity.profiles set name_confirmed_at = created_at where full_name ~ '\s';

-- The sign-up hook no longer requires a name.
create or replace function identity.before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_email text := lower(btrim(event -> 'user' ->> 'email'));
  v_meta jsonb := coalesce(event -> 'user' -> 'user_metadata', '{}'::jsonb);
  v_domain text;
  v_status text;
begin
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+$' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 400, 'message', 'Use your university student email address.'));
  end if;

  v_domain := split_part(v_email, '@', 2);

  select i.status into v_status
  from identity.institution_email_domains d
  join identity.institutions i on i.id = d.institution_id
  where d.domain = v_domain;

  if v_status is null or v_status = 'disabled' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Use your university student email address. Personal emails are not accepted.'));
  end if;

  if v_status <> 'live' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Uni Era is not open at your university yet. We will let you know when it is.'));
  end if;

  if v_meta -> 'age_confirmed' is distinct from 'true'::jsonb
     or v_meta -> 'guidelines_accepted' is distinct from 'true'::jsonb then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 400, 'message', 'Confirm you are 18 or older and accept the community guidelines.'));
  end if;

  return '{}'::jsonb;
end;
$$;

create or replace function identity.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_institution_id bigint;
  -- The student types their name after approval. Until then the profile holds a name given at
  -- sign-up (accounts created by the team) or the email's local part, and is not searchable.
  v_name text := nullif(btrim(regexp_replace(coalesce(new.raw_user_meta_data ->> 'full_name', ''), '\s+', ' ', 'g')), '');
  v_local text := split_part(lower(new.email), '@', 1);
  -- rpad also truncates, so pad only names shorter than the 2-character minimum.
  v_placeholder text := left(rpad(v_local, greatest(char_length(v_local), 2), '_'), 80);
begin
  if char_length(v_name) not between 2 and 80 then
    v_name := null;
  end if;

  select d.institution_id into v_institution_id
  from identity.institution_email_domains d
  where d.domain = split_part(lower(new.email), '@', 2);

  if v_institution_id is null then
    -- Only reachable if the before_user_created hook is switched off. Fail closed.
    raise exception 'email domain is not a registered institution domain'
      using errcode = 'check_violation';
  end if;

  insert into identity.profiles (user_id, institution_id, full_name)
  values (new.id, v_institution_id, coalesce(v_name, v_placeholder));

  insert into identity.privacy_settings (user_id) values (new.id);

  insert into identity.consents (user_id, purpose_code, policy_version, granted, source)
  select new.id, cp.code, cp.current_version, true, 'signup'
  from identity.consent_purposes cp
  where cp.required;

  return new;
end;
$$;

create or replace function identity.custom_access_token(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user_id uuid := (event ->> 'user_id')::uuid;
  v_claims jsonb := event -> 'claims';
  v_status text;
  v_institution_id bigint;
  v_staff_role text;
  v_name_confirmed boolean;
begin
  select p.account_status, p.institution_id, p.name_confirmed_at is not null
    into v_status, v_institution_id, v_name_confirmed
  from identity.profiles p
  where p.user_id = v_user_id;

  select case
           when bool_or(s.role = 'admin') then 'admin'
           when bool_or(s.role = 'moderator') then 'moderator'
         end
    into v_staff_role
  from identity.staff_roles s
  where s.user_id = v_user_id;

  if jsonb_typeof(v_claims -> 'app_metadata') is distinct from 'object' then
    v_claims := jsonb_set(v_claims, '{app_metadata}', '{}'::jsonb);
  end if;

  v_claims := jsonb_set(v_claims, '{app_metadata,account_status}', to_jsonb(coalesce(v_status, 'pending')));
  v_claims := jsonb_set(v_claims, '{app_metadata,institution_id}', coalesce(to_jsonb(v_institution_id), 'null'::jsonb));
  v_claims := jsonb_set(v_claims, '{app_metadata,staff_role}', coalesce(to_jsonb(v_staff_role), 'null'::jsonb));
  v_claims := jsonb_set(v_claims, '{app_metadata,name_confirmed}', to_jsonb(coalesce(v_name_confirmed, false)));

  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

create or replace function api.my_account()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', p.user_id,
    'full_name', p.full_name,
    'name_confirmed', p.name_confirmed_at is not null,
    'email', (select auth.jwt() ->> 'email'),
    'account_status', p.account_status,
    'institution', jsonb_build_object('id', i.id, 'name', i.name, 'short_name', i.short_name),
    'last_review', (
      select jsonb_build_object('decision', r.decision, 'reason', r.reason, 'at', r.created_at)
      from identity.account_reviews r
      where r.user_id = p.user_id
      order by r.created_at desc
      limit 1
    ),
    'staff_role', (
      select case when bool_or(s.role = 'admin') then 'admin' when bool_or(s.role = 'moderator') then 'moderator' end
      from identity.staff_roles s
      where s.user_id = p.user_id
    ),
    'findable_by', coalesce(
      (select s.findable_by from identity.privacy_settings s where s.user_id = p.user_id), 'everyone')
  )
  from identity.profiles p
  join identity.institutions i on i.id = p.institution_id
  where p.user_id = (select auth.uid());
$$;

-- First name entry, once. Letters in any script, spaces, dots, apostrophes and hyphens.
create or replace function api.set_my_name(p_full_name text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := btrim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g'));
  v_confirmed timestamptz;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  select p.name_confirmed_at into v_confirmed from identity.profiles p where p.user_id = v_uid for update;
  if v_confirmed is not null then
    raise exception 'Your name is already set. Ask a moderator if it needs changing.' using errcode = '22023';
  end if;

  if char_length(v_name) not between 2 and 80 then
    raise exception 'Enter your name (2 to 80 characters).' using errcode = '22023';
  end if;
  if v_name ~ '[][0-9@#$%^&*_=+<>/\\|{}~`!?:;"]' or v_name !~ '[[:alpha:]஀-௿඀-෿]' then
    raise exception 'Use letters only: your name as it is at your university.' using errcode = '22023';
  end if;

  update identity.profiles p set full_name = v_name, name_confirmed_at = now() where p.user_id = v_uid;
  return v_name;
end;
$$;
grant execute on function api.set_my_name(text) to authenticated;

-- Only students who have chosen their name are searchable.
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
      case when p.account_status = 'active' and p.name_confirmed_at is not null
        then coalesce(s.findable_by, 'everyone') else 'nobody' end
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

drop trigger profiles_search_keys_update on identity.profiles;
create trigger profiles_search_keys_update
  after update of full_name, account_status, institution_id, name_confirmed_at on identity.profiles
  for each row
  when (old.full_name is distinct from new.full_name
    or old.account_status is distinct from new.account_status
    or old.institution_id is distinct from new.institution_id
    or old.name_confirmed_at is distinct from new.name_confirmed_at)
  execute function identity.search_keys_trigger();

select identity.sync_search_keys(p.user_id) from identity.profiles p;

-- ---------------------------------------------------------------------------------------------
-- 2. Batch names with the university
-- ---------------------------------------------------------------------------------------------
create or replace function academics.batch_name(p_cohort_id bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(i.short_name, i.name) || ' · ' || pr.name || ' · ' || c.intake_year
  from academics.cohorts c
  join academics.programmes pr on pr.id = c.programme_id
  join identity.institutions i on i.id = pr.institution_id
  where c.id = p_cohort_id;
$$;
-- University and programme names are not private, and the function reveals nothing else.
grant execute on function academics.batch_name(bigint) to authenticated;

-- Batch chats take the batch name (conversation titles are limited to 80 characters).
create or replace function messaging.name_batch_chat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'cohort' then
    new.title := left(academics.batch_name(new.cohort_id), 80);
  end if;
  return new;
end;
$$;
create trigger conversations_batch_title before insert on messaging.conversations
  for each row execute function messaging.name_batch_chat();

-- Renaming a programme or a university renames its batch chats.
create or replace function messaging.rename_batch_chats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update messaging.conversations c set title = left(academics.batch_name(c.cohort_id), 80)
  from academics.cohorts co
  join academics.programmes pr on pr.id = co.programme_id
  where c.cohort_id = co.id
    and (case when tg_table_name = 'programmes' then pr.id else pr.institution_id end) = new.id;
  return null;
end;
$$;
create trigger programmes_rename_batch_chats after update of name on academics.programmes
  for each row when (old.name is distinct from new.name)
  execute function messaging.rename_batch_chats();
create trigger institutions_rename_batch_chats after update of name, short_name on identity.institutions
  for each row when (old.name is distinct from new.name or old.short_name is distinct from new.short_name)
  execute function messaging.rename_batch_chats();

revoke execute on function messaging.name_batch_chat() from public, anon, authenticated;
revoke execute on function messaging.rename_batch_chats() from public, anon, authenticated;

update messaging.conversations c set title = left(academics.batch_name(c.cohort_id), 80) where c.kind = 'cohort';

-- The batch name in the screens that show a batch.
create or replace function api.batch_suggestion()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_institution bigint;
  v_parsed record;
  v_programme_id bigint;
  v_programme_name text;
  v_current jsonb;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  select p.institution_id into v_institution from identity.profiles p where p.user_id = v_uid;
  select * into v_parsed from identity.parse_student_email((select auth.jwt() ->> 'email'));

  select jsonb_build_object(
      'name', academics.batch_name(c.id), 'programme', pr.name, 'intake_year', c.intake_year,
      'members', academics.cohort_size(c.id))
    into v_current
  from academics.cohort_members m
  join academics.cohorts c on c.id = m.cohort_id
  join academics.programmes pr on pr.id = c.programme_id
  where m.user_id = v_uid;

  if v_parsed.email_code is not null then
    select pr.id, pr.name into v_programme_id, v_programme_name
    from academics.programme_email_codes ec
    join academics.programmes pr on pr.id = ec.programme_id
    where ec.email_code = v_parsed.email_code
      and pr.institution_id = v_institution
      and pr.merged_into_id is null
    order by ec.confirmations desc, pr.id
    limit 1;
  end if;

  return jsonb_build_object(
    'email_code', v_parsed.email_code,
    'intake_year', v_parsed.intake_year,
    'programme', case when v_programme_id is not null then jsonb_build_object(
      'id', v_programme_id,
      'name', v_programme_name,
      'members', coalesce((
        select academics.cohort_size(c.id) from academics.cohorts c
        where c.programme_id = v_programme_id and c.intake_year = v_parsed.intake_year
      ), 0)
    ) end,
    'current_batch', v_current
  );
end;
$$;

create or replace function api.join_batch(
  p_programme_id bigint default null,
  p_programme_name text default null,
  p_intake_year integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_institution bigint;
  v_parsed record;
  v_programme_id bigint;
  v_programme_name text;
  v_suggested bigint;
  v_cohort_id bigint;
  v_conversation_id uuid;
  v_name text := btrim(regexp_replace(coalesce(p_programme_name, ''), '\s+', ' ', 'g'));
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select p.institution_id into v_institution from identity.profiles p where p.user_id = v_uid;

  if exists (select 1 from academics.cohort_members m where m.user_id = v_uid) then
    raise exception 'You are already in a batch. Ask a moderator if it needs changing.' using errcode = '22023';
  end if;

  if p_intake_year is null or p_intake_year not between 2000 and extract(year from now())::integer + 1 then
    raise exception 'Choose your intake year.' using errcode = '22023';
  end if;

  if p_programme_id is not null then
    -- Follow a merge to the programme it now lives under.
    select coalesce(pr.merged_into_id, pr.id) into v_programme_id
    from academics.programmes pr
    where pr.id = p_programme_id and pr.institution_id = v_institution;
    if v_programme_id is null then
      raise exception 'That programme is not at your university.' using errcode = '22023';
    end if;
  else
    if char_length(v_name) not between 2 and 120 then
      raise exception 'Type your degree programme (2 to 120 characters).' using errcode = '22023';
    end if;
    insert into academics.programmes (institution_id, name, created_by)
    values (v_institution, v_name, v_uid)
    on conflict (institution_id, name_key) do nothing;
    select coalesce(pr.merged_into_id, pr.id) into v_programme_id
    from academics.programmes pr
    where pr.institution_id = v_institution
      and pr.name_key = lower(regexp_replace(v_name, '[^[:alnum:]]+', '', 'g'));
  end if;

  select pr.name into v_programme_name from academics.programmes pr where pr.id = v_programme_id;

  insert into academics.cohorts (programme_id, intake_year)
  values (v_programme_id, p_intake_year)
  on conflict (programme_id, intake_year) do nothing;
  select c.id into v_cohort_id from academics.cohorts c
  where c.programme_id = v_programme_id and c.intake_year = p_intake_year;

  -- Compare with what the email suggested, and learn from the choice.
  select * into v_parsed from identity.parse_student_email((select auth.jwt() ->> 'email'));
  if v_parsed.email_code is not null then
    select ec.programme_id into v_suggested
    from academics.programme_email_codes ec
    join academics.programmes pr on pr.id = ec.programme_id
    where ec.email_code = v_parsed.email_code and pr.institution_id = v_institution and pr.merged_into_id is null
    order by ec.confirmations desc, pr.id
    limit 1;

    insert into academics.programme_email_codes (email_code, programme_id, confirmations)
    values (v_parsed.email_code, v_programme_id, 1)
    on conflict (email_code, programme_id)
    do update set confirmations = academics.programme_email_codes.confirmations + 1;
  end if;

  insert into academics.cohort_members (user_id, cohort_id, matches_email)
  values (
    v_uid,
    v_cohort_id,
    case
      when v_parsed.intake_year is null then null
      else v_parsed.intake_year = p_intake_year and (v_suggested is null or v_suggested = v_programme_id)
    end
  );

  -- The batch's group chat, created by the first student to join.
  insert into messaging.conversations (kind, cohort_id, created_by)
  values ('cohort', v_cohort_id, v_uid)
  on conflict (cohort_id) do nothing;
  select c.id into v_conversation_id from messaging.conversations c where c.cohort_id = v_cohort_id;

  insert into messaging.conversation_members (conversation_id, user_id)
  values (v_conversation_id, v_uid)
  on conflict do nothing;

  return jsonb_build_object(
    'name', academics.batch_name(v_cohort_id),
    'programme', v_programme_name,
    'intake_year', p_intake_year,
    'members', academics.cohort_size(v_cohort_id)
  );
end;
$$;

create or replace function api.my_home()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'full_name', p.full_name,
    'account_status', p.account_status,
    'institution', jsonb_build_object('name', i.name, 'short_name', i.short_name),
    'staff_role', (
      select case when bool_or(s.role = 'admin') then 'admin' when bool_or(s.role = 'moderator') then 'moderator' end
      from identity.staff_roles s
      where s.user_id = p.user_id
    ),
    'has_cohort', exists (select 1 from academics.cohort_members c where c.user_id = p.user_id),
    'batch', (
      select jsonb_build_object(
      'name', academics.batch_name(c.id), 'programme', pr.name, 'intake_year', c.intake_year,
      'members', academics.cohort_size(c.id))
      from academics.cohort_members m
      join academics.cohorts c on c.id = m.cohort_id
      join academics.programmes pr on pr.id = c.programme_id
      where m.user_id = p.user_id
    ),
    'module_count', (select count(*) from academics.module_enrolments e where e.user_id = p.user_id),
    'pending_accounts', (select identity.pending_account_count())
  )
  from identity.profiles p
  join identity.institutions i on i.id = p.institution_id
  where p.user_id = (select auth.uid());
$$;
