-- Messaging: conversations (DMs, groups, batch, module and kuppi chats), members and messages.
-- Messages are partitioned by month from day one: the largest table by far at national scale.
-- All writes go through api functions (task D1); live delivery uses Realtime Broadcast (task A7).

create table messaging.conversations (
  id uuid primary key default ops.uuid_v7(),
  kind text not null check (kind in ('direct', 'group', 'cohort', 'module', 'kuppi')),
  title text check (char_length(title) between 1 and 80),
  -- Exactly one scope column is set for cohort, module and kuppi chats; none for direct or group.
  cohort_id bigint unique references academics.cohorts (id) on delete cascade,
  module_id bigint unique references academics.modules (id) on delete cascade,
  session_id uuid unique references kuppi.sessions (id) on delete cascade,
  slow_mode_seconds smallint not null default 0 check (slow_mode_seconds between 0 and 3600),
  announcement_only boolean not null default false,
  created_by uuid references identity.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  constraint conversations_scope check (
    (kind = 'cohort') = (cohort_id is not null)
    and (kind = 'module') = (module_id is not null)
    and (kind = 'kuppi') = (session_id is not null)
  )
);
create index conversations_created_by_idx on messaging.conversations (created_by);

-- One DM per pair of students; also carries the message-request state.
create table messaging.direct_conversations (
  conversation_id uuid primary key references messaging.conversations (id) on delete cascade,
  user_low uuid not null references identity.profiles (user_id) on delete cascade,
  user_high uuid not null references identity.profiles (user_id) on delete cascade,
  initiated_by uuid not null,
  request_status text not null default 'pending' check (request_status in ('pending', 'accepted', 'ignored')),
  decided_at timestamptz,
  constraint direct_pair_ordered check (user_low < user_high),
  constraint direct_initiator_is_member check (initiated_by in (user_low, user_high)),
  unique (user_low, user_high)
);
create index direct_conversations_user_high_idx on messaging.direct_conversations (user_high);

create table messaging.conversation_members (
  conversation_id uuid not null references messaging.conversations (id) on delete cascade,
  user_id uuid not null references identity.profiles (user_id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'admin')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  muted_until timestamptz,
  primary key (conversation_id, user_id)
);
-- "My chats" list.
create index conversation_members_user_idx on messaging.conversation_members (user_id, conversation_id);

create table messaging.messages (
  id uuid not null default ops.uuid_v7(),
  conversation_id uuid not null references messaging.conversations (id) on delete cascade,
  sender_id uuid references identity.profiles (user_id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  -- No foreign key: a reply may point into another monthly partition.
  reply_to_id uuid,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  primary key (id, created_at)
) partition by range (created_at);
-- Load a chat newest-first with cursor pagination.
create index messages_conversation_created_idx on messaging.messages (conversation_id, created_at desc);
create index messages_sender_idx on messaging.messages (sender_id);

alter table messaging.messages enable row level security;

-- Creates monthly partitions from the current month to p_months_ahead months ahead (UTC).
-- Partitions get RLS and no grants, so they are only reachable through the parent table.
create or replace function messaging.ensure_message_partitions(p_months_ahead integer default 3)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_base timestamp := date_trunc('month', now() at time zone 'utc');
  v_from timestamptz;
  v_to timestamptz;
  v_name text;
begin
  for i in 0..greatest(p_months_ahead, 0) loop
    v_from := (v_base + make_interval(months => i)) at time zone 'utc';
    v_to := (v_base + make_interval(months => i + 1)) at time zone 'utc';
    v_name := 'messages_' || to_char(v_base + make_interval(months => i), 'YYYY_MM');
    if to_regclass('messaging.' || v_name) is null then
      execute format(
        'create table messaging.%I partition of messaging.messages for values from (%L) to (%L)',
        v_name, v_from, v_to
      );
      execute format('alter table messaging.%I enable row level security', v_name);
    end if;
  end loop;
end;
$$;

select messaging.ensure_message_partitions(3);
select cron.schedule('messaging-ensure-partitions', '0 2 * * *', $$select messaging.ensure_message_partitions(3)$$);

-- True when the caller is an active member of the conversation.
create or replace function messaging.is_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from messaging.conversation_members m
    where m.conversation_id = p_conversation_id and m.user_id = (select auth.uid())
  ) and (select identity.is_active_user());
$$;
grant execute on function messaging.is_member(uuid) to authenticated, service_role;

alter table messaging.conversations enable row level security;
alter table messaging.direct_conversations enable row level security;
alter table messaging.conversation_members enable row level security;

grant select on messaging.conversations, messaging.direct_conversations,
  messaging.conversation_members, messaging.messages to authenticated;
grant update (last_read_at, muted_until) on messaging.conversation_members to authenticated;

create policy "member conversations" on messaging.conversations
  for select to authenticated using (messaging.is_member(id));

create policy "member direct pairs" on messaging.direct_conversations
  for select to authenticated using (messaging.is_member(conversation_id));

create policy "members of my conversations" on messaging.conversation_members
  for select to authenticated using (messaging.is_member(conversation_id));

create policy "own membership: update" on messaging.conversation_members
  for update to authenticated
  using (user_id = (select auth.uid()) and (select identity.is_active_user()))
  with check (user_id = (select auth.uid()));

create policy "messages in my conversations" on messaging.messages
  for select to authenticated
  using (deleted_at is null and messaging.is_member(conversation_id));
