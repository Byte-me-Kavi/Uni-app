-- Freshers' questions, answered by ambassadors.
--
-- Freshers have questions before they arrive (registration, hostels, what to bring) and today ask
-- them in open WhatsApp groups that seniors join. Here a fresher asks the Uni Era ambassadors of
-- their university: verified seniors appointed by the university's moderators (identity.ambassadors,
-- made with fresher accounts).
--
--   Asking      freshers only, up to 5 questions a day. A question shows as "A fresher, <their
--               programme>": ambassadors are seniors, and freshers are shielded from seniors.
--               Moderators can see who asked.
--   Seeing      every fresher at the university sees the answered questions, so the same one is not
--               asked fifty times; a question waiting for an answer is seen by its asker,
--               ambassadors and moderators. Ambassadors cannot see batch member lists (they are not
--               in fresher batches and have no other way in).
--   Answering   ambassadors and moderators of that university. Answers carry the ambassador's name
--               and badge. The asker hears about each answer; ambassadors hear about new questions
--               (at most once every 30 minutes).
--   Safety      report like a feed post (3 students: hidden until a moderator looks); askers and
--               answerers delete their own; moderators remove anything.

create schema if not exists freshers;
revoke all on schema freshers from public, anon, authenticated;

create table freshers.questions (
  id bigint generated always as identity primary key,
  institution_id bigint not null references identity.institutions (id) on delete cascade,
  asker_id uuid references identity.profiles (user_id) on delete set null,
  -- The asker's programme when they asked ("BSc in Computer Science"), shown instead of a name.
  programme text,
  body text not null check (char_length(btrim(body)) between 10 and 500),
  answer_count integer not null default 0,
  status text not null default 'live' check (status in ('live', 'hidden')),
  created_at timestamptz not null default now(),
  answered_at timestamptz
);
-- Freshers' list (answered, newest first) and ambassadors' list (waiting first).
create index questions_answered_idx on freshers.questions (institution_id, answered_at desc) where status = 'live';
create index questions_waiting_idx on freshers.questions (institution_id, created_at) where status = 'live' and answer_count = 0;
create index questions_asker_idx on freshers.questions (asker_id);
alter table freshers.questions enable row level security;

create table freshers.answers (
  id bigint generated always as identity primary key,
  question_id bigint not null references freshers.questions (id) on delete cascade,
  author_id uuid references identity.profiles (user_id) on delete set null,
  body text not null check (char_length(btrim(body)) between 2 and 1500),
  created_at timestamptz not null default now()
);
create index answers_question_idx on freshers.answers (question_id, created_at);
create index answers_author_idx on freshers.answers (author_id);
alter table freshers.answers enable row level security;
-- No grants or policies: only through the functions below.

-- Counts kept by trigger, so lists never count.
create or replace function freshers.count_answers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update freshers.questions q
    set answer_count = q.answer_count + 1, answered_at = coalesce(q.answered_at, now())
    where q.id = new.question_id;
  else
    update freshers.questions q
    set answer_count = greatest(q.answer_count - 1, 0),
        answered_at = case when q.answer_count <= 1 then null else q.answered_at end
    where q.id = old.question_id;
  end if;
  return null;
end;
$$;
revoke execute on function freshers.count_answers() from public, anon, authenticated;
create trigger answers_count after insert or delete on freshers.answers
  for each row execute function freshers.count_answers();

alter table safety.reports drop constraint if exists reports_target_kind_check;
alter table safety.reports add constraint reports_target_kind_check
  check (target_kind in ('profile', 'message', 'resource', 'kuppi', 'conversation', 'kuppi_request', 'comment', 'listing',
                         'post', 'post_comment', 'fresher_question', 'fresher_answer'));

alter table messaging.app_pushes drop constraint app_pushes_kind_check;
alter table messaging.app_pushes add constraint app_pushes_kind_check check (kind in (
  'kuppi_answered', 'kuppi_new', 'kuppi_cancelled', 'kuppi_starting',
  'exam_set', 'exam_tomorrow',
  'order_cancelled', 'listing_hidden', 'merch_lead', 'merch_closing', 'listing_expiring',
  'file_checked', 'file_comment', 'comment_reply',
  'account',
  'post_comment', 'post_reply', 'post_likes', 'post_hidden', 'post_removed',
  'fresher_question', 'fresher_answer'));

-- ---------------------------------------------------------------------------------------------
-- Who is who
-- ---------------------------------------------------------------------------------------------

-- The caller's part in their university's freshers' questions: 'fresher', 'ambassador', 'staff' or
-- null, with the university.
create or replace function freshers.my_role(out role text, out institution_id bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile record;
begin
  select p.institution_id, p.account_kind into v_profile
  from identity.profiles p
  where p.user_id = v_uid and p.account_status = 'active';
  if v_profile.institution_id is null or not (select identity.is_active_user()) then
    return;
  end if;
  institution_id := v_profile.institution_id;
  if v_profile.account_kind = 'fresher' then
    role := 'fresher';
  elsif identity.is_staff_for(v_profile.institution_id) then
    role := 'staff';
  elsif exists (select 1 from identity.ambassadors a where a.user_id = v_uid and a.institution_id = v_profile.institution_id) then
    role := 'ambassador';
  end if;
end;
$$;
revoke execute on function freshers.my_role() from public, anon, authenticated;

create or replace function freshers.question_json(q freshers.questions, p_role text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', q.id,
    'body', q.body,
    'programme', q.programme,
    'answer_count', q.answer_count,
    'created_at', q.created_at,
    'answered_at', q.answered_at,
    'mine', q.asker_id = (select auth.uid()),
    -- Staff only: who asked, for moderation.
    'asker', case when p_role = 'staff' then (select p.full_name from identity.profiles p where p.user_id = q.asker_id) end
  );
$$;
revoke execute on function freshers.question_json(freshers.questions, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- api
-- ---------------------------------------------------------------------------------------------

-- The questions list. Freshers: their own first, then answered ones, newest first. Ambassadors and
-- staff: waiting ones (oldest first), then answered ones. Pages of 30 by answered time.
create or replace function api.fresher_questions(p_before timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me record;
  v_uid uuid := (select auth.uid());
begin
  select * into v_me from freshers.my_role();
  if v_me.role is null then
    raise exception 'Freshers'' questions are for freshers and ambassadors.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'role', v_me.role,
    'university', (select coalesce(i.short_name, i.name) from identity.institutions i where i.id = v_me.institution_id),
    -- Only on the first page.
    'waiting', case when p_before is not null then '[]'::jsonb else (
      select coalesce(jsonb_agg(freshers.question_json(q, v_me.role) order by q.created_at), '[]'::jsonb)
      from (
        select * from freshers.questions q
        where q.institution_id = v_me.institution_id and q.status = 'live' and q.answer_count = 0
          and (v_me.role <> 'fresher' or q.asker_id = v_uid)
        order by q.created_at
        limit 50
      ) q
    ) end,
    'answered', (
      select coalesce(jsonb_agg(freshers.question_json(q, v_me.role) order by q.answered_at desc), '[]'::jsonb)
      from (
        select * from freshers.questions q
        where q.institution_id = v_me.institution_id and q.status = 'live' and q.answered_at is not null
          and (p_before is null or q.answered_at < p_before)
        order by q.answered_at desc
        limit 30
      ) q
    )
  );
end;
$$;
revoke execute on function api.fresher_questions(timestamptz) from public, anon;
grant execute on function api.fresher_questions(timestamptz) to authenticated;

-- One question with its answers.
create or replace function api.fresher_question(p_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me record;
  v_q freshers.questions;
begin
  select * into v_me from freshers.my_role();
  select * into v_q from freshers.questions q where q.id = p_id;
  if v_me.role is null or v_q.id is null or v_q.institution_id <> v_me.institution_id
     or (v_q.status <> 'live' and v_me.role <> 'staff')
     or (v_me.role = 'fresher' and v_q.answer_count = 0 and v_q.asker_id is distinct from (select auth.uid())) then
    raise exception 'This question is not available.' using errcode = '42501';
  end if;
  return freshers.question_json(v_q, v_me.role) || jsonb_build_object(
    'role', v_me.role,
    'answers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id,
        'body', a.body,
        'created_at', a.created_at,
        'mine', a.author_id = (select auth.uid()),
        'author', jsonb_build_object(
          'name', coalesce(p.full_name, 'Former ambassador'),
          'avatar_path', p.avatar_path,
          'role', case when exists (select 1 from identity.ambassadors am where am.user_id = a.author_id) then 'Ambassador' else 'Uni Era team' end,
          'programme', (select pr.name from academics.cohort_members m
                        join academics.cohorts c on c.id = m.cohort_id
                        join academics.programmes pr on pr.id = c.programme_id
                        where m.user_id = a.author_id)
        )
      ) order by a.created_at), '[]'::jsonb)
      from freshers.answers a
      left join identity.profiles p on p.user_id = a.author_id
      where a.question_id = v_q.id
    )
  );
end;
$$;
revoke execute on function api.fresher_question(bigint) from public, anon;
grant execute on function api.fresher_question(bigint) to authenticated;

create or replace function api.ask_freshers(p_body text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_me record;
  v_body text := btrim(regexp_replace(coalesce(p_body, ''), '\n{3,}', E'\n\n', 'g'));
  v_programme text;
  v_q freshers.questions;
begin
  select * into v_me from freshers.my_role();
  if v_me.role is distinct from 'fresher' then
    raise exception 'Only freshers ask here.' using errcode = '42501';
  end if;
  if char_length(v_body) not between 10 and 500 then
    raise exception 'Write your question in 10 to 500 characters.' using errcode = '22023';
  end if;
  if not ops.feature_on('feature.posting') then
    raise exception 'Asking is paused for now. Try again later.' using errcode = 'P0001';
  end if;
  perform messaging.hit_limit('fresher_question', 5, 'You can ask 5 questions a day. Try again tomorrow.');

  select pr.name into v_programme
  from academics.cohort_members m
  join academics.cohorts c on c.id = m.cohort_id
  join academics.programmes pr on pr.id = c.programme_id
  where m.user_id = v_uid;

  insert into freshers.questions (institution_id, asker_id, programme, body)
  values (v_me.institution_id, v_uid, v_programme, v_body)
  returning * into v_q;

  -- Ambassadors hear there is something to answer, at most once every 30 minutes.
  perform messaging.notify(
    array(select a.user_id from identity.ambassadors a where a.institution_id = v_me.institution_id),
    'fresher_question', 'A fresher has a question', left(v_body, 120),
    jsonb_build_object('href', '/freshers/' || v_q.id), 'feed',
    'fresher_question:' || v_me.institution_id, interval '30 minutes');

  return freshers.question_json(v_q, 'fresher');
end;
$$;
revoke execute on function api.ask_freshers(text) from public, anon;
grant execute on function api.ask_freshers(text) to authenticated;

create or replace function api.answer_fresher(p_question_id bigint, p_body text)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_me record;
  v_q freshers.questions;
  v_body text := btrim(coalesce(p_body, ''));
  v_id bigint;
begin
  select * into v_me from freshers.my_role();
  select * into v_q from freshers.questions q where q.id = p_question_id and q.status = 'live';
  if v_me.role not in ('ambassador', 'staff') or v_q.id is null or v_q.institution_id <> v_me.institution_id then
    raise exception 'Only ambassadors answer freshers here.' using errcode = '42501';
  end if;
  if char_length(v_body) not between 2 and 1500 then
    raise exception 'Write your answer in up to 1,500 characters.' using errcode = '22023';
  end if;
  perform messaging.hit_limit('fresher_answer', 100, 'You have answered a lot today. Thank you! Try again tomorrow.');
  insert into freshers.answers (question_id, author_id, body) values (v_q.id, v_uid, v_body) returning id into v_id;
  if v_q.asker_id is not null then
    perform messaging.notify(array[v_q.asker_id], 'fresher_answer', 'Your question has an answer', left(v_body, 120),
      jsonb_build_object('href', '/freshers/' || v_q.id), 'feed', 'fresher_answer:' || v_q.id, interval '10 minutes');
  end if;
  return v_id;
end;
$$;
revoke execute on function api.answer_fresher(bigint, text) from public, anon;
grant execute on function api.answer_fresher(bigint, text) to authenticated;

-- Delete your own question or answer; moderators remove anyone's (audited).
create or replace function api.delete_fresher_item(p_kind text, p_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
  v_institution bigint;
begin
  if p_kind = 'question' then
    select q.asker_id, q.institution_id into v_owner, v_institution from freshers.questions q where q.id = p_id;
  elsif p_kind = 'answer' then
    select a.author_id, q.institution_id into v_owner, v_institution
    from freshers.answers a join freshers.questions q on q.id = a.question_id where a.id = p_id;
  else
    raise exception 'Unknown item.' using errcode = '22023';
  end if;
  if v_institution is null then
    return;
  end if;
  if v_owner is distinct from v_uid then
    if not identity.is_staff_for(v_institution) then
      raise exception 'Not allowed.' using errcode = '42501';
    end if;
    insert into ops.audit_log (actor_id, action, target_table, target_id, details)
    values (v_uid, 'freshers.removed', 'freshers.' || p_kind || 's', p_id::text, '{}'::jsonb);
  end if;
  if p_kind = 'question' then
    delete from freshers.questions q where q.id = p_id;
  else
    delete from freshers.answers a where a.id = p_id;
  end if;
end;
$$;
revoke execute on function api.delete_fresher_item(text, bigint) from public, anon;
grant execute on function api.delete_fresher_item(text, bigint) to authenticated;

create or replace function api.report_fresher_item(p_kind text, p_id bigint, p_category text, p_details text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_me record;
  v_q freshers.questions;
  v_answer freshers.answers;
  v_author uuid;
  v_target text := case p_kind when 'question' then 'fresher_question' when 'answer' then 'fresher_answer' end;
  v_id uuid;
begin
  select * into v_me from freshers.my_role();
  if v_target is null then
    raise exception 'Unknown report.' using errcode = '22023';
  end if;
  if p_kind = 'answer' then
    select * into v_answer from freshers.answers a where a.id = p_id;
    select * into v_q from freshers.questions q where q.id = v_answer.question_id;
    v_author := v_answer.author_id;
  else
    select * into v_q from freshers.questions q where q.id = p_id;
    v_author := v_q.asker_id;
  end if;
  if v_me.role is null or v_q.id is null or v_q.institution_id <> v_me.institution_id then
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
  where r.reporter_id = v_uid and r.target_kind = v_target and r.target_id = p_id::text and r.status = 'open';
  if v_id is not null then
    return v_id;
  end if;
  perform messaging.hit_limit('report', 20, 'You have sent a lot of reports today. Our team will look at them first.');
  insert into safety.reports (reporter_id, institution_id, target_kind, target_id, category_code, details, snapshot)
  values (v_uid, v_q.institution_id, v_target, p_id::text, p_category, nullif(btrim(coalesce(p_details, '')), ''),
          case when p_kind = 'answer' then to_jsonb(v_answer) || jsonb_build_object('question', to_jsonb(v_q)) else to_jsonb(v_q) end)
  returning id into v_id;

  -- Three students: hidden (a question) or removed (an answer) until a moderator looks.
  if (select count(distinct r.reporter_id) from safety.reports r
      where r.target_kind = v_target and r.target_id = p_id::text and r.status = 'open') >= 3 then
    if p_kind = 'question' then
      update freshers.questions q set status = 'hidden' where q.id = v_q.id;
    else
      delete from freshers.answers a where a.id = v_answer.id;
      update safety.reports r set status = 'actioned', resolved_at = now()
      where r.target_kind = 'fresher_answer' and r.target_id = p_id::text and r.status = 'open';
    end if;
    insert into ops.audit_log (actor_id, action, target_table, target_id, details)
    values (null, 'freshers.hidden_after_reports', 'freshers.' || p_kind || 's', p_id::text, '{}'::jsonb);
  end if;
  return v_id;
end;
$$;
revoke execute on function api.report_fresher_item(text, bigint, text, text) from public, anon;
grant execute on function api.report_fresher_item(text, bigint, text, text) to authenticated;

-- Moderators (and admins) of a university appoint its ambassadors: verified students there.
create or replace function api.set_ambassador(p_user_id uuid, p_on boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_target record;
begin
  select p.institution_id, p.account_kind, p.account_status into v_target
  from identity.profiles p where p.user_id = p_user_id;
  if v_target.institution_id is null or not identity.is_staff_for(v_target.institution_id) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_on then
    if v_target.account_kind <> 'student' or v_target.account_status <> 'active' then
      raise exception 'Ambassadors are verified students.' using errcode = '22023';
    end if;
    insert into identity.ambassadors (user_id, institution_id, appointed_by)
    values (p_user_id, v_target.institution_id, (select auth.uid()))
    on conflict (user_id) do nothing;
  else
    delete from identity.ambassadors a where a.user_id = p_user_id;
  end if;
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values ((select auth.uid()), case when p_on then 'ambassador.appointed' else 'ambassador.removed' end,
          'identity.ambassadors', p_user_id::text, '{}'::jsonb);
  if p_on then
    perform messaging.notify(array[p_user_id], 'account', 'You are a Uni Era ambassador',
      'Freshers at your university can now ask you questions. Find them under Answer freshers on your account.',
      jsonb_build_object('href', '/freshers'), 'account');
  end if;
  return p_on;
end;
$$;
revoke execute on function api.set_ambassador(uuid, boolean) from public, anon;
grant execute on function api.set_ambassador(uuid, boolean) to authenticated;

-- What the app needs to show the way in: the caller's role and how many questions wait.
create or replace function api.freshers_badge()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me record;
begin
  select * into v_me from freshers.my_role();
  if v_me.role is null then
    return null;
  end if;
  return jsonb_build_object(
    'role', v_me.role,
    'waiting', case when v_me.role = 'fresher' then 0 else (
      select count(*)::integer from freshers.questions q
      where q.institution_id = v_me.institution_id and q.status = 'live' and q.answer_count = 0) end
  );
end;
$$;
revoke execute on function api.freshers_badge() from public, anon;
grant execute on function api.freshers_badge() to authenticated;
