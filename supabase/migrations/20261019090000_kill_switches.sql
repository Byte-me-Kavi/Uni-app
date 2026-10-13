-- Kill switches and the minimum app version.
--
-- ops.settings already holds app.min_version and feature.signup, read by the app through
-- api.app_config. This adds a switch per risky feature, enforced by the database (a trigger on the
-- tables each feature writes, so every path that creates content is covered without rewriting the
-- functions), an optional notice the app shows on Home, and functions for national admins to read
-- and change them from the app. Every change is in the audit log.

insert into ops.settings (key, value) values
  ('feature.posting', 'true'),
  ('feature.shop', 'true'),
  ('feature.uploads', 'true'),
  ('feature.new_dms', 'true'),
  ('feature.kuppi', 'true'),
  ('feature.fresher_signup', 'true'),
  -- A short message on Home for every student (an incident, planned maintenance); null for none.
  ('app.notice', 'null')
on conflict (key) do nothing;

-- True unless the switch is set to false. A missing key counts as on, so a typo never pauses a feature.
create or replace function ops.feature_on(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.value <> 'false'::jsonb from ops.settings s where s.key = p_key), true);
$$;
revoke execute on function ops.feature_on(text) from public, anon;
grant execute on function ops.feature_on(text) to authenticated, service_role;

-- Trigger: refuses the insert while the feature named in the first trigger argument is off.
-- The second argument is the feature's name as students know it.
create or replace function ops.require_feature()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not ops.feature_on('feature.' || tg_argv[0]) then
    raise exception '% is paused for now. Try again later.', tg_argv[1] using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function ops.require_feature() from public, anon, authenticated;

create trigger require_posting before insert on feed.posts
  for each row execute function ops.require_feature('posting', 'Posting');
create trigger require_posting before insert on feed.comments
  for each row execute function ops.require_feature('posting', 'Commenting');

create trigger require_shop before insert on shop.listings
  for each row execute function ops.require_feature('shop', 'The Shop');
create trigger require_shop before insert on shop.orders
  for each row execute function ops.require_feature('shop', 'The Shop');
create trigger require_shop before insert on shop.interests
  for each row execute function ops.require_feature('shop', 'The Shop');

create trigger require_uploads before insert on messaging.uploads
  for each row execute function ops.require_feature('uploads', 'Uploading');
create trigger require_uploads before insert on feed.uploads
  for each row execute function ops.require_feature('uploads', 'Uploading');
create trigger require_uploads before insert on shop.uploads
  for each row execute function ops.require_feature('uploads', 'Uploading');
create trigger require_uploads before insert on content.resources
  for each row execute function ops.require_feature('uploads', 'Sharing files');

-- Only a new direct chat: existing chats keep working.
create trigger require_new_dms before insert on messaging.direct_conversations
  for each row execute function ops.require_feature('new_dms', 'Starting new chats');

create trigger require_kuppi before insert on kuppi.sessions
  for each row execute function ops.require_feature('kuppi', 'Kuppi');
create trigger require_kuppi before insert on kuppi.rsvps
  for each row execute function ops.require_feature('kuppi', 'Kuppi');
create trigger require_kuppi before insert on kuppi.requests
  for each row execute function ops.require_feature('kuppi', 'Kuppi');

-- ---------------------------------------------------------------------------------------------
-- Admin: read and change the switches (national admins only).
-- ---------------------------------------------------------------------------------------------

create or replace function api.admin_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not identity.is_national_admin() then
    raise exception 'Only national admins can change app switches.' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_object_agg(s.key, jsonb_build_object('value', s.value, 'updated_at', s.updated_at)), '{}'::jsonb)
    from ops.settings s
    where s.key like 'app.%' or s.key like 'feature.%'
  );
end;
$$;
revoke execute on function api.admin_settings() from public, anon;
grant execute on function api.admin_settings() to authenticated;

create or replace function api.set_setting(p_key text, p_value jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_value jsonb := p_value;
begin
  if not identity.is_national_admin() then
    raise exception 'Only national admins can change app switches.' using errcode = '42501';
  end if;

  if p_key like 'feature.%' then
    if jsonb_typeof(v_value) is distinct from 'boolean' then
      raise exception 'A switch is on or off.' using errcode = '22023';
    end if;
  elsif p_key = 'app.min_version' then
    if jsonb_typeof(v_value) is distinct from 'string' or (v_value #>> '{}') !~ '^\d{1,3}\.\d{1,3}\.\d{1,3}$' then
      raise exception 'Use a version like 1.2.0.' using errcode = '22023';
    end if;
  elsif p_key = 'app.notice' then
    if jsonb_typeof(v_value) = 'string' then
      v_value := nullif(to_jsonb(btrim(v_value #>> '{}')), '""'::jsonb);
      if v_value is not null and char_length(v_value #>> '{}') > 200 then
        raise exception 'Keep the notice under 200 characters.' using errcode = '22023';
      end if;
    elsif jsonb_typeof(v_value) is distinct from 'null' and v_value is not null then
      raise exception 'The notice is text.' using errcode = '22023';
    end if;
    v_value := coalesce(v_value, 'null'::jsonb);
  else
    raise exception 'Unknown setting.' using errcode = '22023';
  end if;

  select s.value into v_old from ops.settings s where s.key = p_key for update;
  if not found then
    raise exception 'Unknown setting.' using errcode = '22023';
  end if;
  if v_old = v_value then
    return;
  end if;

  update ops.settings set value = v_value where key = p_key;

  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values ((select auth.uid()), 'setting.change', 'ops.settings', p_key,
          jsonb_build_object('from', v_old, 'to', v_value));
end;
$$;
revoke execute on function api.set_setting(text, jsonb) from public, anon;
grant execute on function api.set_setting(text, jsonb) to authenticated;
