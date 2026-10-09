-- Auth hooks and the new-user trigger.
--
-- Sign-up flow:
--   1. before_user_created (Auth hook) rejects anything that is not a live institution's student
--      email domain, or that lacks the required confirmations. Runs before the user row exists.
--   2. handle_new_user (trigger) creates the profile as 'pending', its privacy settings and the
--      sign-up consents, in the same transaction as the auth.users insert.
--   3. The student confirms their email with a 6-digit code (Supabase Auth).
--   4. A moderator or admin approves the account (api.review_account) before it can use the app.
--   5. custom_access_token (Auth hook) puts account status, institution and staff role into the
--      access token, so the app can route without a network call. Authorisation never trusts these
--      claims: RLS reads the tables.

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
  v_name text := btrim(coalesce(v_meta ->> 'full_name', ''));
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
      'http_code', 403, 'message', 'Gansiya is not open at your university yet. We will let you know when it is.'));
  end if;

  if char_length(v_name) not between 2 and 80 then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 400, 'message', 'Enter your full name (2 to 80 characters).'));
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
begin
  select d.institution_id into v_institution_id
  from identity.institution_email_domains d
  where d.domain = split_part(lower(new.email), '@', 2);

  if v_institution_id is null then
    -- Only reachable if the before_user_created hook is switched off. Fail closed.
    raise exception 'email domain is not a registered institution domain'
      using errcode = 'check_violation';
  end if;

  insert into identity.profiles (user_id, institution_id, full_name)
  values (new.id, v_institution_id, btrim(new.raw_user_meta_data ->> 'full_name'));

  insert into identity.privacy_settings (user_id) values (new.id);

  insert into identity.consents (user_id, purpose_code, policy_version, granted, source)
  select new.id, cp.code, cp.current_version, true, 'signup'
  from identity.consent_purposes cp
  where cp.required;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function identity.handle_new_user();

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
begin
  select p.account_status, p.institution_id into v_status, v_institution_id
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

  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

-- Hook permissions, as the Supabase auth-hooks guide prescribes.
grant usage on schema identity to supabase_auth_admin;
grant execute on function identity.before_user_created(jsonb) to supabase_auth_admin;
grant execute on function identity.custom_access_token(jsonb) to supabase_auth_admin;
revoke execute on function identity.before_user_created(jsonb) from authenticated, anon, public;
revoke execute on function identity.custom_access_token(jsonb) from authenticated, anon, public;
revoke execute on function identity.handle_new_user() from authenticated, anon, public;

grant select on identity.institutions, identity.institution_email_domains,
  identity.profiles, identity.staff_roles to supabase_auth_admin;

create policy "auth admin reads institutions" on identity.institutions
  for select to supabase_auth_admin using (true);
create policy "auth admin reads domains" on identity.institution_email_domains
  for select to supabase_auth_admin using (true);
create policy "auth admin reads profiles" on identity.profiles
  for select to supabase_auth_admin using (true);
create policy "auth admin reads staff roles" on identity.staff_roles
  for select to supabase_auth_admin using (true);
