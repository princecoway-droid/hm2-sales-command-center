-- Minimal stand-in for the parts of a Supabase database that the HM2
-- migrations depend on. Enough to actually execute the schema and exercise the
-- constraints/triggers under a real Postgres.

create role anon;
create role authenticated;
create role service_role;

-- ---- auth -------------------------------------------------------------------
create schema if not exists auth;

create table auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text,
  raw_user_meta_data  jsonb not null default '{}'::jsonb
);

-- Supabase grants USAGE on the auth schema to the API roles, and auth.uid() is
-- called from ordinary (non-SECURITY DEFINER) triggers on behalf of a signed-in
-- user - tg_set_audit_fields does exactly that. Without this grant those
-- triggers raise "permission denied for schema auth" the first time they are
-- planned under `authenticated`, so whether a test passed depended on whether
-- the same trigger had already been executed once as the superuser and had its
-- plan cached. Granting it here makes the stand-in match a real project and the
-- results independent of statement order.
--
-- Table privileges on auth.users are deliberately NOT granted: usage on the
-- schema is what auth.uid() needs, and nothing in this application reads the
-- users table as anon or authenticated.
grant usage on schema auth to anon, authenticated, service_role;

-- Supabase reads the subject out of the request JWT; here it comes from a GUC
-- so a test can impersonate a user with set_config('request.jwt.claim.sub', ...).
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- ---- storage ----------------------------------------------------------------
create schema if not exists storage;

create table storage.buckets (
  id                  text primary key,
  name                text not null,
  public              boolean not null default false,
  file_size_limit     bigint,
  allowed_mime_types  text[]
);

create table storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text
);

alter table storage.objects enable row level security;
