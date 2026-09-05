-- =============================================================================
-- HM2 Sales Command Center - Stage 1: core schema
-- -----------------------------------------------------------------------------
-- Creates the relational foundation:
--   profiles, hms, months, sales_weeks,
--   hm_monthly_performance, hm_weekly_performance, group_monthly_metrics
--
-- Conventions used throughout:
--   * All application tables live in `public`.
--   * `updated_at` and the `created_by` / `updated_by` audit columns are
--     maintained by triggers, never trusted from the client.
--   * Derived values (months.quarter / months.label, sales_weeks.week_label)
--     are computed by triggers so the database is the single source of truth.
--   * RLS is enabled here but policies live in the next migration.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Shared trigger helpers
-- -----------------------------------------------------------------------------

-- Keeps `updated_at` honest for tables without full audit columns.
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.tg_set_updated_at() is
  'BEFORE UPDATE trigger: stamps updated_at with now().';

-- Stamps created_at/updated_at/created_by/updated_by on audited tables.
--
-- The authenticated user always wins over any client-supplied value, so a PA
-- cannot forge authorship by posting a different profile id. When there is no
-- JWT (service-role writes, seeding, migrations) the supplied value is kept.
--
-- This is the hook a richer change-history/audit-log table would extend later:
-- every audited table already routes its writes through this one function.
create or replace function public.tg_set_audit_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    new.created_by := coalesce(actor, new.created_by);
    new.updated_by := coalesce(actor, new.updated_by);
  elsif tg_op = 'UPDATE' then
    -- Creation metadata is immutable.
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := coalesce(actor, new.updated_by);
  end if;

  return new;
end;
$$;

comment on function public.tg_set_audit_fields() is
  'BEFORE INSERT/UPDATE trigger: maintains created_at/updated_at/created_by/updated_by from auth.uid().';

-- -----------------------------------------------------------------------------
-- profiles - application profile for an authenticated Supabase Auth user.
-- Only MANAGER and PA users exist here. HMs are not accounts (see hms table).
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text        not null,
  role        text        not null,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint profiles_full_name_not_blank check (btrim(full_name) <> ''),
  constraint profiles_role_allowed        check (role in ('manager', 'pa'))
);

comment on table public.profiles is
  'Application profile for an authenticated user. One row per auth.users row. Roles: manager | pa.';

create index if not exists profiles_role_idx on public.profiles (role) where is_active;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.tg_set_updated_at();

-- Guards the privileged columns. Row-level security decides *which rows* a user
-- may touch; this trigger decides *which columns*, which RLS cannot express.
create or replace function public.tg_profiles_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_is_manager boolean;
begin
  -- No JWT means a service-role / migration write; leave it alone.
  if actor is null then
    return new;
  end if;

  select p.role = 'manager' and p.is_active
    into actor_is_manager
    from public.profiles p
   where p.id = actor;

  if coalesce(actor_is_manager, false) then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'Only a manager can change a profile role'
      using errcode = '42501';
  end if;

  if new.is_active is distinct from old.is_active then
    raise exception 'Only a manager can activate or deactivate a profile'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.tg_profiles_guard_privileged_columns() is
  'BEFORE UPDATE trigger: blocks non-managers from changing profiles.role or profiles.is_active.';

drop trigger if exists profiles_guard_privileged_columns on public.profiles;
create trigger profiles_guard_privileged_columns
  before update on public.profiles
  for each row execute function public.tg_profiles_guard_privileged_columns();

-- Creates the profile row whenever a user is added through Supabase Auth
-- (dashboard, invite, or signup). Role/name come from user metadata; the role
-- falls back to the least-privileged option.
create or replace function public.tg_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'New user'
    ),
    case
      when new.raw_user_meta_data ->> 'role' in ('manager', 'pa')
        then new.raw_user_meta_data ->> 'role'
      else 'pa'
    end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.tg_handle_new_auth_user() is
  'AFTER INSERT ON auth.users: provisions the matching public.profiles row.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.tg_handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- Role helpers used by every RLS policy.
--
-- SECURITY DEFINER so that reading `profiles` from inside a `profiles` policy
-- does not recurse, and so a locked-down PA still resolves their own role.
-- -----------------------------------------------------------------------------

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
    from public.profiles p
   where p.id = (select auth.uid())
     and p.is_active
$$;

comment on function public.current_profile_role() is
  'Role (manager|pa) of the calling user, or NULL when unauthenticated/inactive/unprovisioned.';

-- The coalesce matters: for an unauthenticated or unprovisioned caller the role
-- is NULL, and both `NULL = 'manager'` and `NULL IN (...)` evaluate to NULL
-- rather than false. RLS happens to treat NULL as a denial, but anything else
-- reading these functions in a boolean context would not, so they return a hard
-- false instead of propagating NULL.
create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_profile_role() = 'manager', false)
$$;

comment on function public.is_manager() is 'True when the caller is an active manager.';

-- "Staff" = any active internal user (manager or PA). HMs are not staff.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_profile_role() in ('manager', 'pa'), false)
$$;

comment on function public.is_staff() is 'True when the caller is an active manager or PA.';

-- -----------------------------------------------------------------------------
-- hms - master list of Health Managers. Not user accounts.
-- -----------------------------------------------------------------------------

create table if not exists public.hms (
  id             uuid primary key default gen_random_uuid(),
  name           text        not null,
  office         text        not null,
  photo_url      text,
  status         text        not null default 'active',
  display_order  integer     not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint hms_name_not_blank        check (btrim(name) <> ''),
  constraint hms_office_not_blank      check (btrim(office) <> ''),
  constraint hms_status_allowed        check (status in ('active', 'inactive')),
  constraint hms_display_order_natural check (display_order >= 0)
);

comment on table public.hms is
  'Master list of Health Managers. HMs have no login in V1; read-only sharing arrives in a later stage.';
comment on column public.hms.photo_url is
  'Public URL or storage path in the hm-photos bucket. Binary data is never stored in the database.';

create index if not exists hms_display_idx on public.hms (status, display_order, name);

drop trigger if exists hms_set_updated_at on public.hms;
create trigger hms_set_updated_at
  before update on public.hms
  for each row execute function public.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- months - a sales reporting month.
-- -----------------------------------------------------------------------------

create table if not exists public.months (
  id          uuid primary key default gen_random_uuid(),
  year        integer     not null,
  month       integer     not null,
  label       text        not null,
  quarter     integer     not null,
  created_at  timestamptz not null default now(),

  constraint months_year_month_key    unique (year, month),
  constraint months_year_range        check (year between 2000 and 2100),
  constraint months_month_range       check (month between 1 and 12),
  constraint months_quarter_range     check (quarter between 1 and 4),
  -- Integer division: Jan-Mar -> 1, Apr-Jun -> 2, Jul-Sep -> 3, Oct-Dec -> 4.
  constraint months_quarter_derived   check (quarter = ((month - 1) / 3) + 1)
);

comment on table public.months is
  'A sales reporting month. quarter and label are derived from year/month.';

-- Derives quarter and label so callers only ever need to supply year + month.
create or replace function public.tg_months_set_derived()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Bail out on an out-of-range month so the CHECK constraint is what rejects
  -- the row. Calling make_date() first would raise an opaque "date field value
  -- out of range" from inside the trigger, which the application cannot map
  -- back to a field-level message.
  if new.year is null or new.month is null
     or new.month < 1 or new.month > 12
     or new.year < 2000 or new.year > 2100 then
    return new;
  end if;

  new.quarter := ((new.month - 1) / 3) + 1;

  if new.label is null or btrim(new.label) = '' then
    new.label := to_char(make_date(new.year, new.month, 1), 'FMMonth YYYY');
  end if;

  return new;
end;
$$;

comment on function public.tg_months_set_derived() is
  'BEFORE INSERT/UPDATE trigger: derives months.quarter and defaults months.label.';

drop trigger if exists months_set_derived on public.months;
create trigger months_set_derived
  before insert or update on public.months
  for each row execute function public.tg_months_set_derived();

-- -----------------------------------------------------------------------------
-- sales_weeks - Coway's OFFICIAL weekly sales calendar.
--
-- Coway weeks are not calendar weeks and are not a fixed 1-7 / 8-14 grid. Every
-- reporting month carries its own periods, and a month may have 4, 5 or more.
-- -----------------------------------------------------------------------------

create table if not exists public.sales_weeks (
  id           uuid primary key default gen_random_uuid(),
  month_id     uuid        not null references public.months (id) on delete cascade,
  week_number  integer     not null,
  week_label   text        not null default '',
  start_date   date        not null,
  end_date     date        not null,
  created_at   timestamptz not null default now(),

  constraint sales_weeks_month_week_key unique (month_id, week_number),
  -- Positive, with a sane ceiling so a typo cannot create week 400.
  constraint sales_weeks_number_range   check (week_number between 1 and 6),
  constraint sales_weeks_date_order     check (start_date <= end_date)
);

comment on table public.sales_weeks is
  'Coway official weekly sales periods, configured per month. Never assume four weeks or fixed date ranges.';

create index if not exists sales_weeks_month_idx on public.sales_weeks (month_id, week_number);

create or replace function public.tg_sales_weeks_set_derived()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.week_label is null or btrim(new.week_label) = '' then
    new.week_label := 'W' || new.week_number::text;
  end if;

  return new;
end;
$$;

comment on function public.tg_sales_weeks_set_derived() is
  'BEFORE INSERT/UPDATE trigger: defaults sales_weeks.week_label to W<n>.';

drop trigger if exists sales_weeks_set_derived on public.sales_weeks;
create trigger sales_weeks_set_derived
  before insert or update on public.sales_weeks
  for each row execute function public.tg_sales_weeks_set_derived();

-- -----------------------------------------------------------------------------
-- hm_monthly_performance - HM-level monthly KPIs.
--
-- Business rules baked in here:
--   * extrade_units + non_extrade_units = net_units  (percentages are derived
--     in the application, never stored).
--   * shi_percentage is keyed in manually from Coway eTrust. It is never
--     calculated, and HM SHI is never averaged into a group figure.
-- -----------------------------------------------------------------------------

create table if not exists public.hm_monthly_performance (
  id                 uuid primary key default gen_random_uuid(),
  hm_id              uuid          not null references public.hms (id)    on delete cascade,
  month_id           uuid          not null references public.months (id) on delete cascade,
  net_units          integer       not null default 0,
  target_net_units   integer       not null default 0,
  recruitment        integer       not null default 0,
  active_hp          integer       not null default 0,
  shi_percentage     numeric(5, 2) not null default 0,
  extrade_units      integer       not null default 0,
  non_extrade_units  integer       not null default 0,
  created_at         timestamptz   not null default now(),
  updated_at         timestamptz   not null default now(),
  created_by         uuid          references public.profiles (id) on delete set null,
  updated_by         uuid          references public.profiles (id) on delete set null,

  constraint hm_monthly_performance_hm_month_key unique (hm_id, month_id),

  constraint hm_monthly_performance_net_units_natural   check (net_units >= 0),
  constraint hm_monthly_performance_target_natural      check (target_net_units >= 0),
  constraint hm_monthly_performance_recruitment_natural check (recruitment >= 0),
  constraint hm_monthly_performance_active_hp_natural   check (active_hp >= 0),
  constraint hm_monthly_performance_extrade_natural     check (extrade_units >= 0),
  constraint hm_monthly_performance_non_extrade_natural check (non_extrade_units >= 0),
  constraint hm_monthly_performance_shi_range           check (shi_percentage between 0 and 100),
  constraint hm_monthly_performance_extrade_split       check (extrade_units + non_extrade_units = net_units)
);

comment on table public.hm_monthly_performance is
  'One row per HM per month. Extrade/non-extrade must sum to net units; percentages are computed by the application.';
comment on column public.hm_monthly_performance.shi_percentage is
  'Entered manually from Coway eTrust. Never calculated and never rolled up into the group figure.';
comment on constraint hm_monthly_performance_extrade_split on public.hm_monthly_performance is
  'Extrade + Non-Extrade must equal Net. Partial form state is held client-side, so a half-filled form never reaches this constraint.';

create index if not exists hm_monthly_performance_month_idx on public.hm_monthly_performance (month_id);
create index if not exists hm_monthly_performance_hm_idx    on public.hm_monthly_performance (hm_id);

drop trigger if exists hm_monthly_performance_audit on public.hm_monthly_performance;
create trigger hm_monthly_performance_audit
  before insert or update on public.hm_monthly_performance
  for each row execute function public.tg_set_audit_fields();

-- -----------------------------------------------------------------------------
-- hm_weekly_performance - weekly Key-In units per HM.
--
-- Monthly Key-In is deliberately NOT a second stored column: later stages sum
-- these weekly rows, so the two figures can never drift apart.
-- -----------------------------------------------------------------------------

create table if not exists public.hm_weekly_performance (
  id           uuid primary key default gen_random_uuid(),
  hm_id        uuid        not null references public.hms (id)         on delete cascade,
  week_id      uuid        not null references public.sales_weeks (id) on delete cascade,
  keyin_units  integer     not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid        references public.profiles (id) on delete set null,
  updated_by   uuid        references public.profiles (id) on delete set null,

  constraint hm_weekly_performance_hm_week_key   unique (hm_id, week_id),
  constraint hm_weekly_performance_keyin_natural check (keyin_units >= 0)
);

comment on table public.hm_weekly_performance is
  'Weekly Key-In units per HM. Total Key-In is always SUM(keyin_units), never a separately keyed figure.';

create index if not exists hm_weekly_performance_week_idx on public.hm_weekly_performance (week_id);
create index if not exists hm_weekly_performance_hm_idx   on public.hm_weekly_performance (hm_id);

drop trigger if exists hm_weekly_performance_audit on public.hm_weekly_performance;
create trigger hm_weekly_performance_audit
  before insert or update on public.hm_weekly_performance
  for each row execute function public.tg_set_audit_fields();

-- -----------------------------------------------------------------------------
-- group_monthly_metrics - the official group SHI, keyed in from eTrust.
--
-- Deliberately narrow: every other group KPI (total key-in, total net, total
-- recruitment, total active HP, total target, achievement, net ratio) is
-- calculated from the HM/week rows above. No redundant manual group totals.
-- -----------------------------------------------------------------------------

create table if not exists public.group_monthly_metrics (
  id              uuid primary key default gen_random_uuid(),
  month_id        uuid          not null unique references public.months (id) on delete cascade,
  shi_percentage  numeric(5, 2) not null default 0,
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now(),
  created_by      uuid          references public.profiles (id) on delete set null,
  updated_by      uuid          references public.profiles (id) on delete set null,

  constraint group_monthly_metrics_shi_range check (shi_percentage between 0 and 100)
);

comment on table public.group_monthly_metrics is
  'Official group-level SHI per month, keyed in from eTrust. Never derived from HM SHI values.';

drop trigger if exists group_monthly_metrics_audit on public.group_monthly_metrics;
create trigger group_monthly_metrics_audit
  before insert or update on public.group_monthly_metrics
  for each row execute function public.tg_set_audit_fields();

-- -----------------------------------------------------------------------------
-- Row Level Security: on by default everywhere. Policies land in the next
-- migration; until then these tables deny all client access, which is the
-- correct failure mode.
-- -----------------------------------------------------------------------------

alter table public.profiles               enable row level security;
alter table public.hms                    enable row level security;
alter table public.months                 enable row level security;
alter table public.sales_weeks            enable row level security;
alter table public.hm_monthly_performance enable row level security;
alter table public.hm_weekly_performance  enable row level security;
alter table public.group_monthly_metrics  enable row level security;
