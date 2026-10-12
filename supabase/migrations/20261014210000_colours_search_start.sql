-- Resources, easier to find your way around: a colour per module (each student's own choice, kept
-- on every phone they use), search across kuppi and kuppi requests, and what the first-week
-- checklist needs.

-- ---------------------------------------------------------------------------------------------
-- Module colours. The app picks a distinct colour for each module by default; a row here is the
-- student's own choice.
-- ---------------------------------------------------------------------------------------------

create table academics.module_colours (
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  module_id bigint not null references academics.modules (id) on delete cascade,
  colour text not null check (colour in ('teal', 'green', 'amber', 'clay', 'rose', 'violet', 'indigo', 'slate')),
  updated_at timestamptz not null default now(),
  primary key (user_id, module_id)
);
create index module_colours_module_idx on academics.module_colours (module_id);
alter table academics.module_colours enable row level security;

-- The student's chosen colours: {"<module id>": "teal", ...}.
create or replace function api.module_colours()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_object_agg(c.module_id::text, c.colour) from academics.module_colours c where c.user_id = v_uid),
                  '{}'::jsonb);
end;
$$;
grant execute on function api.module_colours() to authenticated;

-- Sets the colour of one of the student's modules; null goes back to the app's choice. Answers with
-- all their colours.
create or replace function api.set_module_colour(p_module_id bigint, p_colour text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_module academics.modules;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  v_module := content.my_module(p_module_id);
  if p_colour is null then
    delete from academics.module_colours c where c.user_id = v_uid and c.module_id = v_module.id;
  else
    if p_colour not in ('teal', 'green', 'amber', 'clay', 'rose', 'violet', 'indigo', 'slate') then
      raise exception 'Choose one of the colours.' using errcode = '22023';
    end if;
    perform messaging.hit_limit('module_colour', 200, 'You have changed colours a lot today. Try again tomorrow.');
    insert into academics.module_colours (user_id, module_id, colour) values (v_uid, v_module.id, p_colour)
    on conflict (user_id, module_id) do update set colour = excluded.colour, updated_at = now();
  end if;
  return api.module_colours();
end;
$$;
grant execute on function api.set_module_colour(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Search: upcoming kuppi and open kuppi requests the student can see (their university, and ones
-- open to all universities on a subject they take), by topic, module code or module name.
-- ---------------------------------------------------------------------------------------------

create or replace function api.kuppi_search(p_query text, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_institution bigint;
  v_subjects bigint[];
  v_query text := btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g'));
  v_like text;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if char_length(v_query) < 2 then
    return jsonb_build_object('sessions', '[]'::jsonb, 'requests', '[]'::jsonb);
  end if;
  v_institution := (select identity.current_institution_id());
  v_subjects := kuppi.my_subjects(v_uid);
  v_like := '%' || replace(replace(replace(left(v_query, 100), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return jsonb_build_object(
    'sessions', coalesce((
      select jsonb_agg(kuppi.session_json(x.s, v_uid) order by x.starts_at)
      from (
        select s, s.starts_at from kuppi.sessions s
        join academics.modules m on m.id = s.module_id
        where s.ends_at > now() and s.cancelled_at is null
          and (s.institution_id = v_institution
               or (s.scope = 'national' and academics.subject_of(s.module_id) = any (v_subjects)))
          and (s.title ilike v_like or m.name ilike v_like or m.code ilike v_like or s.description ilike v_like
               or extensions.word_similarity(v_query, s.title) > 0.5)
          and not exists (select 1 from safety.blocks b
                          where (b.blocker_id = v_uid and b.blocked_id = s.host_id) or (b.blocker_id = s.host_id and b.blocked_id = v_uid))
        order by s.starts_at
        limit v_limit
      ) x), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(kuppi.request_json(x.r, v_uid) order by x.votes desc)
      from (
        select r, r.votes from kuppi.requests r
        join academics.modules m on m.id = r.module_id
        where r.closed_at is null
          and (r.institution_id = v_institution
               or (r.scope = 'national' and academics.subject_of(r.module_id) = any (v_subjects)))
          and (r.topic ilike v_like or m.name ilike v_like or m.code ilike v_like
               or extensions.word_similarity(v_query, r.topic) > 0.5)
        order by r.votes desc, r.created_at desc
        limit v_limit
      ) x), '[]'::jsonb));
end;
$$;
grant execute on function api.kuppi_search(text, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- First-week checklist: the batch chat, and whether the student has opened it.
-- ---------------------------------------------------------------------------------------------

create or replace function api.resources_start()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_chat uuid;
  v_opened boolean;
begin
  if v_uid is null or not (select identity.is_active_user()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select c.id, cm.last_read_at is not null into v_chat, v_opened
  from academics.cohort_members m
  join messaging.conversations c on c.cohort_id = m.cohort_id and c.kind = 'cohort'
  join messaging.conversation_members cm on cm.conversation_id = c.id and cm.user_id = v_uid
  where m.user_id = v_uid
  limit 1;
  return jsonb_build_object('batch_chat_id', v_chat, 'batch_chat_opened', coalesce(v_opened, false));
end;
$$;
grant execute on function api.resources_start() to authenticated;
