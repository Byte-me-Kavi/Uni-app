-- Help contacts are kept by the Uni Era team only. Universities' own staff do not use the app, so
-- moderators no longer edit their university's list: national admins keep every list, national and
-- per university. A university with no contacts yet shows a line saying so, with the app's report
-- route; nothing is invented.

-- The UGC's online complaint portal for ragging and sexual and gender-based violence, linked from
-- the UGC home page ("Ragging & SGBV Complaints").
update ops.settings
set value = value || '[{"kind": "ragging", "label": "UGC ragging and harassment complaints", "url": "https://eugc.ugc.ac.lk/complaint-portal/"}]'::jsonb
where key = 'safety.contacts'
  and not value @> '[{"url": "https://eugc.ugc.ac.lk/complaint-portal/"}]'::jsonb;

create or replace function api.help_contacts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'university', (select coalesce(i.short_name, i.name) from identity.institutions i where i.id = p.institution_id),
    'university_contacts', coalesce((select i.help_contacts from identity.institutions i where i.id = p.institution_id), '[]'::jsonb),
    'national', coalesce((select s.value from ops.settings s where s.key = 'safety.contacts'), '[]'::jsonb),
    -- Whether the caller keeps the contacts (national admins).
    'can_edit', identity.is_national_admin()
  )
  from identity.profiles p
  where p.user_id = (select auth.uid());
$$;
revoke execute on function api.help_contacts() from public, anon;
grant execute on function api.help_contacts() to authenticated;

-- National admins: the national list and every university's, for the editor.
create or replace function api.admin_help_contacts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not identity.is_national_admin() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'national', coalesce((select s.value from ops.settings s where s.key = 'safety.contacts'), '[]'::jsonb),
    'universities', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'name', coalesce(i.short_name, i.name), 'contacts', i.help_contacts)
                       order by coalesce(i.short_name, i.name))
      from identity.institutions i), '[]'::jsonb)
  );
end;
$$;
revoke execute on function api.admin_help_contacts() from public, anon;
grant execute on function api.admin_help_contacts() to authenticated;

-- National admins set the national list (null) or any university's.
create or replace function api.set_help_contacts(p_institution_id bigint, p_contacts jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_clean jsonb;
begin
  if not identity.is_national_admin() then
    raise exception 'Only the Uni Era team changes help contacts.' using errcode = '42501';
  end if;
  v_clean := safety.clean_contacts(p_contacts);
  if p_institution_id is null then
    update ops.settings set value = v_clean where key = 'safety.contacts';
  else
    update identity.institutions set help_contacts = v_clean where id = p_institution_id;
    if not found then
      raise exception 'No such university.' using errcode = 'P0002';
    end if;
  end if;
  insert into ops.audit_log (actor_id, action, target_table, target_id, details)
  values ((select auth.uid()), 'help.contacts_changed',
          case when p_institution_id is null then 'ops.settings' else 'identity.institutions' end,
          coalesce(p_institution_id::text, 'safety.contacts'), jsonb_build_object('contacts', v_clean));
  return v_clean;
end;
$$;
revoke execute on function api.set_help_contacts(bigint, jsonb) from public, anon;
grant execute on function api.set_help_contacts(bigint, jsonb) to authenticated;
