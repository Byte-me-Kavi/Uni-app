-- The app is renamed from Gansiya to Uni Era. The only user-facing name stored in the database is
-- the waitlist message in the sign-up hook; everything else in this function is unchanged.
-- create or replace keeps the function's owner and its grants to supabase_auth_admin.

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
      'http_code', 403, 'message', 'Uni Era is not open at your university yet. We will let you know when it is.'));
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
