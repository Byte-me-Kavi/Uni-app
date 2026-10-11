-- Who voted for what in a poll, as in WhatsApp's "View votes". Any member of the chat can see it;
-- votes were never secret (the counts were already shown to everyone).

create or replace function api.poll_voters(p_conversation_id uuid, p_message_id uuid)
returns table (option smallint, user_id uuid, full_name text, avatar_path text, voted_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not messaging.is_member(p_conversation_id) then
    raise exception 'You are not in this chat.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from messaging.messages m
    where m.id = p_message_id and m.conversation_id = p_conversation_id and m.kind = 'poll' and m.deleted_at is null
  ) then
    raise exception 'That poll is not in this chat.' using errcode = 'P0002';
  end if;
  return query
  select o::smallint, p.user_id, p.full_name, p.avatar_path, v.voted_at
  from messaging.poll_votes v
  cross join lateral unnest(v.options) o
  join identity.profiles p on p.user_id = v.user_id
  where v.message_id = p_message_id and v.conversation_id = p_conversation_id
  order by o, v.voted_at desc
  limit 2000;
end;
$$;
revoke execute on function api.poll_voters(uuid, uuid) from public, anon;
grant execute on function api.poll_voters(uuid, uuid) to authenticated;
