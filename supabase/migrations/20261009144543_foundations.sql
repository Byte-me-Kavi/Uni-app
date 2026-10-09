-- Foundations: module schemas, extensions and shared helpers.
--
-- Access model (see readme.md):
--   * Only the `api` schema is exposed through the Data API (config.toml [api].schemas).
--   * Module schemas (identity, academics, content, kuppi, messaging, safety, ops) are private.
--     The app reaches them only through functions in `api`.
--   * Row-level security is enabled on every table, including private ones, as defence in depth.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create schema if not exists api;
create schema if not exists ops;
create schema if not exists identity;
create schema if not exists academics;
create schema if not exists content;
create schema if not exists kuppi;
create schema if not exists messaging;
create schema if not exists safety;

-- New functions are executable by PUBLIC by default. Turn that off for every schema we own,
-- so each function's callers are granted explicitly.
alter default privileges for role postgres in schema api revoke execute on functions from public;
alter default privileges for role postgres in schema ops revoke execute on functions from public;
alter default privileges for role postgres in schema identity revoke execute on functions from public;
alter default privileges for role postgres in schema academics revoke execute on functions from public;
alter default privileges for role postgres in schema content revoke execute on functions from public;
alter default privileges for role postgres in schema kuppi revoke execute on functions from public;
alter default privileges for role postgres in schema messaging revoke execute on functions from public;
alter default privileges for role postgres in schema safety revoke execute on functions from public;

grant usage on schema api to anon, authenticated, service_role;

-- Private schemas: usage is needed because RLS policies and column defaults call helper
-- functions as the querying role. Tables stay unreachable: the schemas are not exposed and
-- table privileges are granted one by one.
grant usage on schema ops, identity, academics, content, kuppi, messaging, safety to authenticated, service_role;

-- UUIDv7: time-ordered ids (unguessable like v4, but keeps large indexes compact).
-- Postgres 17 has no built-in uuidv7(); this sets the version bits on a random UUID whose first
-- 48 bits are replaced by the Unix time in milliseconds.
create or replace function ops.uuid_v7()
returns uuid
language sql
volatile
parallel safe
set search_path = ''
as $$
  select encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          placing substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
          from 1 for 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid;
$$;
grant execute on function ops.uuid_v7() to authenticated, service_role;

create or replace function ops.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Feature switches and the minimum supported app version, read by the app at start.
create table ops.settings (
  key text primary key check (key ~ '^[a-z0-9_.]+$'),
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table ops.settings enable row level security;
create trigger settings_touch before update on ops.settings
  for each row execute function ops.touch_updated_at();

insert into ops.settings (key, value) values
  ('app.min_version', '"1.0.0"'),
  ('feature.signup', 'true');

-- Append-only record of every privileged action.
create table ops.audit_log (
  id uuid primary key default ops.uuid_v7(),
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  target_table text not null,
  target_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table ops.audit_log enable row level security;
create index audit_log_actor_idx on ops.audit_log (actor_id);
create index audit_log_target_idx on ops.audit_log (target_table, target_id);
create index audit_log_created_idx on ops.audit_log using brin (created_at);

-- Fixed-window rate-limit counters, used by api functions.
create table ops.rate_limits (
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  window_start timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  primary key (user_id, action, window_start)
);
alter table ops.rate_limits enable row level security;
