-- Getting help: the anti-ragging route and wellbeing contacts.
--
-- Ragging is a criminal offence (Prohibition of Ragging and Other Forms of Violence in Educational
-- Institutions Act No. 20 of 1998). Besides reporting in the app, a student should be able to reach
-- their university's anti-ragging committee, the UGC's complaint channel, campus security and
-- someone to talk to, in one tap. Contacts are kept as data, not in the app, because they differ per
-- university and change: national ones (police, helplines, the UGC) by national admins, each
-- university's own by its moderators. Nothing is shown for a university until its staff fill it
-- in, so the app never shows a wrong number.
--
-- Shown on Account, Get help, and after a report of ragging, threats or self-harm.

alter table identity.institutions
  add column help_contacts jsonb not null default '[]'::jsonb check (jsonb_typeof(help_contacts) = 'array');

-- Seeded with the numbers already shown in the app; the UGC's channel is added by national admins
-- once confirmed.
insert into ops.settings (key, value) values ('safety.contacts', '[
  {"kind": "emergency", "label": "Police emergency", "phone": "119"},
  {"kind": "wellbeing", "label": "National mental health helpline (NIMH)", "phone": "1926"},
  {"kind": "wellbeing", "label": "CCCline: someone to talk to, any time", "phone": "1333"}
]'::jsonb)
on conflict (key) do nothing;

-- Checks and tidies a list of contacts: up to 8, each with a kind, a label and at least one of a
-- phone number, an email address or an https link.
create or replace function safety.clean_contacts(p_contacts jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  c jsonb;
  v_out jsonb := '[]'::jsonb;
  v_label text;
  v_phone text;
  v_email text;
  v_url text;
  v_note text;
begin
  if jsonb_typeof(p_contacts) is distinct from 'array' then
    raise exception 'Send a list of contacts.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_contacts) > 8 then
    raise exception 'Up to 8 contacts.' using errcode = '22023';
  end if;
  for c in select * from jsonb_array_elements(p_contacts) loop
    if coalesce(c ->> 'kind', '') not in ('ragging', 'security', 'wellbeing', 'emergency') then
      raise exception 'Each contact is for ragging, security, wellbeing or emergencies.' using errcode = '22023';
    end if;
    v_label := btrim(coalesce(c ->> 'label', ''));
    if char_length(v_label) not between 2 and 80 then
      raise exception 'Name each contact (2 to 80 characters).' using errcode = '22023';
    end if;
    v_phone := nullif(regexp_replace(coalesce(c ->> 'phone', ''), '[^0-9+]', '', 'g'), '');
    if v_phone is not null and v_phone !~ '^\+?[0-9]{3,15}$' then
      raise exception 'Check the phone number for %.', v_label using errcode = '22023';
    end if;
    v_email := nullif(lower(btrim(coalesce(c ->> 'email', ''))), '');
    if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'Check the email address for %.', v_label using errcode = '22023';
    end if;
    v_url := nullif(btrim(coalesce(c ->> 'url', '')), '');
    if v_url is not null and (v_url !~ '^https://[^\s]+$' or char_length(v_url) > 300) then
      raise exception 'Links start with https:// (for %).', v_label using errcode = '22023';
    end if;
    if v_phone is null and v_email is null and v_url is null then
      raise exception 'Add a phone number, email or link for %.', v_label using errcode = '22023';
    end if;
    v_note := nullif(btrim(coalesce(c ->> 'note', '')), '');
    if v_note is not null and char_length(v_note) > 160 then
      raise exception 'Keep the note for % under 160 characters.', v_label using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'kind', c ->> 'kind', 'label', v_label, 'phone', v_phone, 'email', v_email, 'url', v_url, 'note', v_note)));
  end loop;
  return v_out;
end;
$$;
revoke execute on function safety.clean_contacts(jsonb) from public, anon, authenticated;

-- For any signed-in student, whatever their account's state (help is needed most when something is
-- wrong): their university's contacts and the national ones.
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
    -- Whether the caller may edit their university's list (and, for national admins, the national one).
    'can_edit', p.institution_id is not null and identity.is_staff_for(p.institution_id),
    'can_edit_national', identity.is_national_admin()
  )
  from identity.profiles p
  where p.user_id = (select auth.uid());
$$;
revoke execute on function api.help_contacts() from public, anon;
grant execute on function api.help_contacts() to authenticated;

-- Staff set their university's list; national admins any university's, and the national one (null).
create or replace function api.set_help_contacts(p_institution_id bigint, p_contacts jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_clean jsonb := safety.clean_contacts(p_contacts);
begin
  if p_institution_id is null then
    if not identity.is_national_admin() then
      raise exception 'Only national admins change the national contacts.' using errcode = '42501';
    end if;
    update ops.settings set value = v_clean where key = 'safety.contacts';
  else
    if not identity.is_staff_for(p_institution_id) then
      raise exception 'Not allowed.' using errcode = '42501';
    end if;
    update identity.institutions set help_contacts = v_clean where id = p_institution_id;
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
