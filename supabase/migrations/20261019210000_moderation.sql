-- Moderation: the reports queue, graduated penalties with a written reason, and appeals.
--
--   Queue       open reports grouped by what was reported, in the moderator's universities (all
--               for national admins): ragging, threats, self-harm and leaked exams first, with a
--               2-hour target; everything else 24 hours. Each group shows the evidence snapshot,
--               who it is about and their strikes in the last 90 days, never who reported it.
--               Moderators do not see reports about their own batchmates (conflict rule); a
--               colleague or a national admin handles those.
--   Actions     dismiss; remove the content; warn; mute (no sending, posting or commenting for 1 to
--               30 days); suspend (1 to 365 days); ban. Every action except dismiss is a strike and
--               needs a reason the student sees. Three strikes in 90 days and the app suggests a
--               suspension; nothing is automatic. Only national admins act on staff.
--   Standing    the student sees every action on their account, its reason and end, and can appeal
--               each one once within 30 days, even while suspended.
--   Appeals     decided by a different moderator from the one who acted. Overturning lifts the
--               mute or suspension and removes the strike. Everything is audited.

alter table identity.profiles
  add column muted_until timestamptz,
  add column suspended_until timestamptz;

alter table safety.moderation_actions
  add column institution_id bigint references identity.institutions (id) on delete set null,
  add column target_kind text,
  add column target_id text,
  add column revoked_at timestamptz,
  add column revoked_by uuid references identity.profiles (user_id) on delete set null;
alter table safety.moderation_actions drop constraint moderation_actions_action_check;
alter table safety.moderation_actions add constraint moderation_actions_action_check
  check (action in ('dismiss', 'remove_content', 'warn', 'mute', 'suspend', 'ban'));
create index moderation_actions_institution_idx on safety.moderation_actions (institution_id, created_at desc);
create index moderation_actions_revoked_by_idx on safety.moderation_actions (revoked_by);

alter table safety.appeals add column decision_note text check (char_length(decision_note) <= 1000);
create index appeals_open_idx on safety.appeals (created_at) where status = 'open';

-- Who a report is about, worked out once when it is made.
alter table safety.reports add column subject_user_id uuid references identity.profiles (user_id) on delete set null;
create index reports_subject_idx on safety.reports (subject_user_id);

create or replace function safety.report_subject(p_kind text, p_target_id text, p_snapshot jsonb)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return case p_kind
    when 'profile' then p_target_id::uuid
    when 'message' then (p_snapshot #>> '{message,sender_id}')::uuid
    when 'post' then (select p.author_id from feed.posts p where p.id = p_target_id::bigint)
    when 'post_comment' then (select c.author_id from feed.comments c where c.id = p_target_id::bigint)
    when 'fresher_question' then (select q.asker_id from freshers.questions q where q.id = p_target_id::bigint)
    when 'fresher_answer' then (select a.author_id from freshers.answers a where a.id = p_target_id::bigint)
    when 'listing' then (select l.seller_id from shop.listings l where l.id = p_target_id::uuid)
    when 'resource' then (select r.uploader_id from content.resources r where r.id = p_target_id::uuid)
    when 'comment' then (select c.author_id from content.comments c where c.id = p_target_id::uuid)
    when 'kuppi' then (select s.host_id from kuppi.sessions s where s.id = p_target_id::uuid)
    when 'kuppi_request' then (select r.requester_id from kuppi.requests r where r.id = p_target_id::uuid)
  end;
exception when others then
  return null;
end;
$$;
revoke execute on function safety.report_subject(text, text, jsonb) from public, anon, authenticated;

create or replace function safety.fill_report_subject()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.subject_user_id := coalesce(new.subject_user_id, safety.report_subject(new.target_kind, new.target_id, new.snapshot));
  return new;
end;
$$;
revoke execute on function safety.fill_report_subject() from public, anon, authenticated;
create trigger reports_subject before insert on safety.reports
  for each row execute function safety.fill_report_subject();

update safety.reports r set subject_user_id = safety.report_subject(r.target_kind, r.target_id, r.snapshot)
where r.subject_user_id is null;

-- Strikes in the last 90 days: every action except dismiss, unless overturned.
create or replace function safety.strikes(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from safety.moderation_actions a
  where a.subject_user_id = p_user_id and a.action <> 'dismiss' and a.revoked_at is null
    and a.created_at > now() - interval '90 days';
$$;
revoke execute on function safety.strikes(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Muted students cannot send, post or comment (every path: triggers)
-- ---------------------------------------------------------------------------------------------

create or replace function safety.refuse_muted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_until timestamptz;
begin
  select p.muted_until into v_until from identity.profiles p where p.user_id = (select auth.uid());
  if v_until > now() then
    raise exception 'You are muted until %. You can still read; see Your standing on your account.',
      to_char(v_until at time zone 'Asia/Colombo', 'FMDD Mon, HH12:MI am') using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function safety.refuse_muted() from public, anon, authenticated;

create trigger refuse_muted before insert on messaging.messages for each row execute function safety.refuse_muted();
create trigger refuse_muted before insert on feed.posts for each row execute function safety.refuse_muted();
create trigger refuse_muted before insert on feed.comments for each row execute function safety.refuse_muted();
create trigger refuse_muted before insert on content.comments for each row execute function safety.refuse_muted();
create trigger refuse_muted before insert on freshers.questions for each row execute function safety.refuse_muted();
create trigger refuse_muted before insert on freshers.answers for each row execute function safety.refuse_muted();
create trigger refuse_muted before insert on kuppi.requests for each row execute function safety.refuse_muted();
create trigger refuse_muted before insert on shop.listings for each row execute function safety.refuse_muted();

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- The caller's moderation scope: national, or these universities. Null when not staff.
create or replace function safety.scope(out is_national boolean, out institution_ids bigint[])
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(bool_or(s.role = 'admin' and s.institution_id is null), false),
    coalesce(array_agg(s.institution_id) filter (where s.institution_id is not null), '{}')
  from identity.staff_roles s
  join identity.profiles p on p.user_id = s.user_id and p.account_status = 'active'
  where s.user_id = (select auth.uid());
$$;
revoke execute on function safety.scope() from public, anon, authenticated;

-- Removes reported content where it lives. Returns false for kinds handled on their own screens.
create or replace function safety.remove_target(p_kind text, p_target_id text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_message record;
begin
  if p_kind = 'post' then
    update feed.posts p set status = 'removed' where p.id = p_target_id::bigint;
  elsif p_kind = 'post_comment' then
    delete from feed.comments c where c.id = p_target_id::bigint;
  elsif p_kind = 'fresher_question' then
    delete from freshers.questions q where q.id = p_target_id::bigint;
  elsif p_kind = 'fresher_answer' then
    delete from freshers.answers a where a.id = p_target_id::bigint;
  elsif p_kind = 'comment' then
    update content.comments c set deleted_at = now() where c.id = p_target_id::uuid;
  elsif p_kind = 'resource' then
    update content.resources r set status = 'removed', deleted_at = now() where r.id = p_target_id::uuid;
  elsif p_kind = 'listing' then
    update shop.listings l set status = 'removed' where l.id = p_target_id::uuid;
  elsif p_kind = 'message' then
    select m.id, m.conversation_id, m.created_at into v_message
    from messaging.messages m where m.id = p_target_id::uuid and m.deleted_at is null;
    if v_message.id is null then
      return true;
    end if;
    update messaging.messages m set deleted_at = clock_timestamp(), body = '', attachment = null, link = null, reply = null
    where m.id = v_message.id and m.created_at = v_message.created_at;
    delete from messaging.message_reactions x where x.message_id = v_message.id;
    delete from messaging.starred_messages s where s.message_id = v_message.id;
    update messaging.conversations c set last_message_preview = 'This message was removed'
    where c.id = v_message.conversation_id and c.last_message_id = v_message.id;
    update messaging.conversations c set pinned_message_id = null, pinned_at = null, pinned_by = null
    where c.id = v_message.conversation_id and c.pinned_message_id = v_message.id;
    perform messaging.broadcast(v_message.conversation_id, 'delete',
      jsonb_build_object('conversation_id', v_message.conversation_id, 'message_id', v_message.id));
  else
    return false;
  end if;
  return true;
end;
$$;
revoke execute on function safety.remove_target(text, text) from public, anon, authenticated;

-- Lifts a mute or suspension when the actions behind it are gone (expired or overturned).
create or replace function safety.recompute_penalties(p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_mute timestamptz;
  v_suspend record;
  v_status text;
begin
  select max(a.expires_at) into v_mute from safety.moderation_actions a
  where a.subject_user_id = p_user_id and a.action = 'mute' and a.revoked_at is null and a.expires_at > now();
  update identity.profiles set muted_until = v_mute where user_id = p_user_id and muted_until is distinct from v_mute;

  select bool_or(a.action = 'ban') as ban, max(a.expires_at) as until, count(*) as n into v_suspend
  from safety.moderation_actions a
  where a.subject_user_id = p_user_id and a.action in ('suspend', 'ban') and a.revoked_at is null
    and (a.action = 'ban' or a.expires_at > now());
  select p.account_status into v_status from identity.profiles p where p.user_id = p_user_id;
  if v_suspend.n = 0 and v_status = 'suspended' and exists (
       -- Only lift suspensions made through moderation actions (not older manual ones).
       select 1 from safety.moderation_actions a
       where a.subject_user_id = p_user_id and a.action in ('suspend', 'ban')) then
    update identity.profiles set account_status = 'active', suspended_until = null where user_id = p_user_id;
    insert into identity.account_reviews (user_id, decision, reviewed_by) values (p_user_id, 'reinstated', (select auth.uid()));
  elsif v_suspend.n > 0 then
    update identity.profiles
    set account_status = 'suspended', suspended_until = case when v_suspend.ban then null else v_suspend.until end
    where user_id = p_user_id;
  end if;
end;
$$;
revoke execute on function safety.recompute_penalties(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The queue
-- ---------------------------------------------------------------------------------------------

create or replace function api.reports_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_scope record;
  v_cohort bigint;
begin
  select * into v_scope from safety.scope();
  if not v_scope.is_national and cardinality(v_scope.institution_ids) = 0 then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select m.cohort_id into v_cohort from academics.cohort_members m where m.user_id = v_uid;

  return (
    select coalesce(jsonb_agg(g order by (g ->> 'priority')::integer, g ->> 'first_at'), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'target_kind', r.target_kind,
        'target_id', r.target_id,
        'institution', (select coalesce(i.short_name, i.name) from identity.institutions i where i.id = r.institution_id),
        'priority', min(rc.priority),
        'categories', jsonb_agg(distinct rc.label),
        'reports', count(*),
        'first_at', min(r.created_at),
        'due_at', min(r.created_at) + case when min(rc.priority) = 1 then interval '2 hours' else interval '24 hours' end,
        'details', coalesce(jsonb_agg(r.details order by r.created_at) filter (where r.details is not null), '[]'::jsonb),
        'snapshot', (array_agg(r.snapshot order by r.created_at desc))[1],
        'subject', case when r.subject_user_id is null then null else (
          select jsonb_build_object('user_id', p.user_id, 'name', p.full_name, 'avatar_path', p.avatar_path,
                                    'status', p.account_status, 'strikes', safety.strikes(p.user_id),
                                    'muted_until', p.muted_until, 'staff', exists (select 1 from identity.staff_roles s where s.user_id = p.user_id))
          from identity.profiles p where p.user_id = r.subject_user_id) end
      ) as g
      from safety.reports r
      join safety.report_categories rc on rc.code = r.category_code
      where r.status = 'open'
        and (v_scope.is_national or r.institution_id = any (v_scope.institution_ids))
        and r.subject_user_id is distinct from v_uid
        -- Conflict rule: not about the moderator's own batchmates (national admins see everything).
        and (v_scope.is_national or v_cohort is null or not exists (
          select 1 from academics.cohort_members m where m.user_id = r.subject_user_id and m.cohort_id = v_cohort))
      group by r.target_kind, r.target_id, r.institution_id, r.subject_user_id
      order by min(rc.priority), min(r.created_at)
      limit 50
    ) x
  );
end;
$$;
revoke execute on function api.reports_queue() from public, anon;
grant execute on function api.reports_queue() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Acting
-- ---------------------------------------------------------------------------------------------

create or replace function api.take_action(
  p_action text,
  p_user_id uuid default null,
  p_reason text default null,
  p_days integer default null,
  p_target_kind text default null,
  p_target_id text default null,
  p_remove boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_scope record;
  v_reason text := nullif(btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g')), '');
  v_subject uuid := p_user_id;
  v_institution bigint;
  v_report uuid;
  v_until timestamptz;
  v_removed boolean := false;
  v_action uuid;
  v_strikes integer;
  v_cohort bigint;
begin
  select * into v_scope from safety.scope();
  if not v_scope.is_national and cardinality(v_scope.institution_ids) = 0 then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_action not in ('dismiss', 'remove_content', 'warn', 'mute', 'suspend', 'ban') then
    raise exception 'Unknown action.' using errcode = '22023';
  end if;

  if p_target_kind is not null then
    select r.id, r.institution_id, coalesce(v_subject, r.subject_user_id) into v_report, v_institution, v_subject
    from safety.reports r
    where r.target_kind = p_target_kind and r.target_id = p_target_id and r.status = 'open'
    order by r.created_at limit 1;
    if v_report is null then
      raise exception 'These reports were already handled.' using errcode = '22023';
    end if;
  elsif p_action in ('dismiss', 'remove_content') then
    raise exception 'Choose the report first.' using errcode = '22023';
  end if;
  if v_subject is not null then
    select coalesce(v_institution, p.institution_id) into v_institution from identity.profiles p where p.user_id = v_subject;
  end if;
  if v_institution is null or not (v_scope.is_national or v_institution = any (v_scope.institution_ids)) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if v_subject = v_uid then
    raise exception 'Someone else must handle reports about you.' using errcode = '42501';
  end if;
  if v_subject is not null and not v_scope.is_national then
    if exists (select 1 from identity.staff_roles s where s.user_id = v_subject) then
      raise exception 'Only a national admin acts on a staff account.' using errcode = '42501';
    end if;
    select m.cohort_id into v_cohort from academics.cohort_members m where m.user_id = v_uid;
    if v_cohort is not null and exists (select 1 from academics.cohort_members m where m.user_id = v_subject and m.cohort_id = v_cohort) then
      raise exception 'This is about your batchmate. Another moderator must handle it.' using errcode = '42501';
    end if;
  end if;

  if p_action <> 'dismiss' then
    if v_reason is null or char_length(v_reason) not between 3 and 1000 then
      raise exception 'Write the reason. The student sees it.' using errcode = '22023';
    end if;
    if v_subject is null and p_action <> 'remove_content' then
      raise exception 'This report is not about one student.' using errcode = '22023';
    end if;
  end if;
  if p_action = 'mute' and (p_days is null or p_days not between 1 and 30) then
    raise exception 'Mute for 1 to 30 days.' using errcode = '22023';
  end if;
  if p_action = 'suspend' and (p_days is null or p_days not between 1 and 365) then
    raise exception 'Suspend for 1 to 365 days.' using errcode = '22023';
  end if;

  if p_target_kind is not null and (p_remove or p_action = 'remove_content') then
    v_removed := safety.remove_target(p_target_kind, p_target_id);
    if not v_removed and p_action = 'remove_content' then
      raise exception 'Remove this from its own screen.' using errcode = '22023';
    end if;
  end if;

  v_until := case p_action when 'mute' then now() + make_interval(days => p_days) when 'suspend' then now() + make_interval(days => p_days) end;
  insert into safety.moderation_actions
    (report_id, moderator_id, subject_user_id, action, reason, expires_at, institution_id, target_kind, target_id)
  values (v_report, v_uid, v_subject, p_action, coalesce(v_reason, 'Not against the community guidelines.'), v_until,
          v_institution, p_target_kind, p_target_id)
  returning id into v_action;

  if p_target_kind is not null then
    update safety.reports r set status = case when p_action = 'dismiss' then 'dismissed' else 'actioned' end, resolved_at = now()
    where r.target_kind = p_target_kind and r.target_id = p_target_id and r.status = 'open';
    -- A post hidden after reports comes back when the reports are dismissed.
    if p_action = 'dismiss' and p_target_kind = 'post' then
      update feed.posts p set status = 'live' where p.id = p_target_id::bigint and p.status = 'hidden';
    elsif p_action = 'dismiss' and p_target_kind = 'fresher_question' then
      update freshers.questions q set status = 'live' where q.id = p_target_id::bigint and q.status = 'hidden';
    end if;
  end if;

  if p_action in ('mute', 'suspend', 'ban') then
    perform safety.recompute_penalties(v_subject);
    if p_action in ('suspend', 'ban') then
      insert into identity.account_reviews (user_id, decision, reason, reviewed_by) values (v_subject, 'suspended', v_reason, v_uid);
    end if;
  end if;

  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (v_uid, 'moderation.' || p_action, 'safety.moderation_actions', v_action::text,
          jsonb_build_object('subject', v_subject, 'target_kind', p_target_kind, 'target_id', p_target_id,
                             'days', p_days, 'removed', v_removed, 'reason', v_reason));

  if v_subject is not null and p_action <> 'dismiss' then
    perform messaging.notify(
      array[v_subject], 'account',
      case p_action
        when 'warn' then 'You got a warning'
        when 'mute' then format('You are muted for %s %s', p_days, case when p_days = 1 then 'day' else 'days' end)
        when 'suspend' then format('Your account is suspended for %s %s', p_days, case when p_days = 1 then 'day' else 'days' end)
        when 'ban' then 'Your account is closed'
        else 'We removed something you posted' end,
      left(v_reason, 140) || ' You can appeal from Your standing.',
      jsonb_build_object('href', '/'), 'account', null, null, true);
  end if;

  v_strikes := case when v_subject is null then 0 else safety.strikes(v_subject) end;
  return jsonb_build_object(
    'action_id', v_action,
    'strikes', v_strikes,
    'suggest_suspend', p_action in ('warn', 'mute', 'remove_content') and v_strikes >= 3
  );
end;
$$;
revoke execute on function api.take_action(text, uuid, text, integer, text, text, boolean) from public, anon;
grant execute on function api.take_action(text, uuid, text, integer, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The student's side (works while suspended)
-- ---------------------------------------------------------------------------------------------

create or replace function api.my_standing()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status', p.account_status,
    'muted_until', case when p.muted_until > now() then p.muted_until end,
    'suspended_until', p.suspended_until,
    'strikes', safety.strikes(p.user_id),
    'actions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'action', a.action,
        'reason', a.reason,
        'created_at', a.created_at,
        'expires_at', a.expires_at,
        'revoked', a.revoked_at is not null,
        'appeal', (select jsonb_build_object('status', ap.status, 'created_at', ap.created_at, 'note', ap.decision_note)
                   from safety.appeals ap where ap.action_id = a.id),
        'can_appeal', a.revoked_at is null and a.created_at > now() - interval '30 days'
                      and not exists (select 1 from safety.appeals ap where ap.action_id = a.id)
      ) order by a.created_at desc)
      from (select * from safety.moderation_actions x
            where x.subject_user_id = p.user_id and x.action <> 'dismiss'
            order by x.created_at desc limit 50) a
    ), '[]'::jsonb)
  )
  from identity.profiles p
  where p.user_id = (select auth.uid());
$$;
revoke execute on function api.my_standing() from public, anon;
grant execute on function api.my_standing() to authenticated;

create or replace function api.appeal(p_action_id uuid, p_statement text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_statement text := btrim(coalesce(p_statement, ''));
  v_action safety.moderation_actions;
  v_id uuid;
begin
  select * into v_action from safety.moderation_actions a where a.id = p_action_id;
  if v_uid is null or v_action.id is null or v_action.subject_user_id is distinct from v_uid or v_action.action = 'dismiss' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if v_action.revoked_at is not null then
    raise exception 'This was already overturned.' using errcode = '22023';
  end if;
  if v_action.created_at < now() - interval '30 days' then
    raise exception 'Appeals are open for 30 days.' using errcode = '22023';
  end if;
  if exists (select 1 from safety.appeals ap where ap.action_id = p_action_id) then
    raise exception 'You already appealed this.' using errcode = '22023';
  end if;
  if char_length(v_statement) not between 10 and 2000 then
    raise exception 'Explain in 10 to 2,000 characters.' using errcode = '22023';
  end if;
  perform messaging.hit_limit('appeal', 5, 'You have sent a lot of appeals today. Try again tomorrow.');
  insert into safety.appeals (action_id, statement) values (p_action_id, v_statement) returning id into v_id;
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (v_uid, 'appeal.opened', 'safety.appeals', v_id::text, jsonb_build_object('action_id', p_action_id));
  return v_id;
end;
$$;
revoke execute on function api.appeal(uuid, text) from public, anon;
grant execute on function api.appeal(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Appeals (decided by someone other than the moderator who acted)
-- ---------------------------------------------------------------------------------------------

create or replace function api.appeals_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_scope record;
begin
  select * into v_scope from safety.scope();
  if not v_scope.is_national and cardinality(v_scope.institution_ids) = 0 then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', ap.id,
      'statement', ap.statement,
      'created_at', ap.created_at,
      'action', jsonb_build_object('id', a.id, 'action', a.action, 'reason', a.reason, 'created_at', a.created_at,
                                   'expires_at', a.expires_at, 'target_kind', a.target_kind),
      'moderator', (select p.full_name from identity.profiles p where p.user_id = a.moderator_id),
      'subject', (select jsonb_build_object('user_id', p.user_id, 'name', p.full_name, 'strikes', safety.strikes(p.user_id))
                  from identity.profiles p where p.user_id = a.subject_user_id),
      'snapshot', (select r.snapshot from safety.reports r where r.id = a.report_id)
    ) order by ap.created_at), '[]'::jsonb)
    from safety.appeals ap
    join safety.moderation_actions a on a.id = ap.action_id
    where ap.status = 'open'
      and a.moderator_id is distinct from v_uid
      and a.subject_user_id is distinct from v_uid
      and (v_scope.is_national or a.institution_id = any (v_scope.institution_ids))
  );
end;
$$;
revoke execute on function api.appeals_queue() from public, anon;
grant execute on function api.appeals_queue() to authenticated;

create or replace function api.decide_appeal(p_appeal_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_scope record;
  v_appeal safety.appeals;
  v_action safety.moderation_actions;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v_scope from safety.scope();
  select * into v_appeal from safety.appeals ap where ap.id = p_appeal_id for update;
  select * into v_action from safety.moderation_actions a where a.id = v_appeal.action_id;
  if v_appeal.id is null or (not v_scope.is_national and not (v_action.institution_id = any (v_scope.institution_ids))) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if v_action.moderator_id = v_uid then
    raise exception 'A different moderator must decide this appeal.' using errcode = '42501';
  end if;
  if v_action.subject_user_id = v_uid then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if v_appeal.status <> 'open' then
    raise exception 'This appeal was already decided.' using errcode = '22023';
  end if;
  if p_decision not in ('upheld', 'overturned') then
    raise exception 'Uphold or overturn.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'Keep the note under 1,000 characters.' using errcode = '22023';
  end if;

  update safety.appeals set status = p_decision, reviewed_by = v_uid, decided_at = now(), decision_note = v_note
  where id = p_appeal_id;
  if p_decision = 'overturned' then
    update safety.moderation_actions set revoked_at = now(), revoked_by = v_uid where id = v_action.id;
    perform safety.recompute_penalties(v_action.subject_user_id);
  end if;
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values (v_uid, 'appeal.' || p_decision, 'safety.appeals', p_appeal_id::text, jsonb_build_object('note', v_note));

  perform messaging.notify(
    array[v_action.subject_user_id], 'account',
    case when p_decision = 'overturned' then 'Your appeal was accepted' else 'Your appeal was turned down' end,
    coalesce(left(v_note, 140), case when p_decision = 'overturned' then 'The action is removed from your account.'
                                     else 'A second moderator reviewed it and the action stays.' end),
    jsonb_build_object('href', '/'), 'account', null, null, true);
end;
$$;
revoke execute on function api.decide_appeal(uuid, text, text) from public, anon;
grant execute on function api.decide_appeal(uuid, text, text) to authenticated;

-- Suspensions end by themselves (the student hears "active again" from the account trigger).
create or replace function safety.end_penalties()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  for v_user in
    select p.user_id from identity.profiles p
    where (p.account_status = 'suspended' and p.suspended_until < now())
       or (p.muted_until is not null and p.muted_until < now())
  loop
    perform safety.recompute_penalties(v_user);
  end loop;
end;
$$;
revoke execute on function safety.end_penalties() from public, anon, authenticated;
create index profiles_suspended_until_idx on identity.profiles (suspended_until) where suspended_until is not null;
create index profiles_muted_until_idx on identity.profiles (muted_until) where muted_until is not null;

select cron.schedule('moderation-end-penalties', '*/10 * * * *', $$select safety.end_penalties()$$);
