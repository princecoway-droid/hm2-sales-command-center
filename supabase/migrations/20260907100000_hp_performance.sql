-- =============================================================================
-- HM2 Sales Command Center - Stage 8: HP master + HP monthly performance
-- -----------------------------------------------------------------------------
-- The PA keeps an Excel of HP-level performance and shares it in the HM group
-- chat. Stage 8 does not replace that spreadsheet - it makes it the INPUT, so
-- the same figures stop being keyed in a second time by hand.
--
-- Three tables:
--
--   hps                      the HP master list. One row per HP Code, ever.
--   hp_monthly_performance   one row per HP per reporting month: W1-W4 Key-In,
--                            the month's Total Key-In and the month's Net.
--   hp_import_runs           what was imported, by whom, when. Lightweight.
--
-- -----------------------------------------------------------------------------
-- The rules that are enforced HERE rather than only in the application
-- -----------------------------------------------------------------------------
--   TOTAL KEY-IN IS DERIVED.  `total_key_in = w1 + w2 + w3 + w4` is a CHECK.
--                             The Excel carries its own TOTAL KEY-IN column and
--                             the import cross-checks against it, but the
--                             figure that gets STORED is the one the
--                             application computed - and the database refuses
--                             any other.
--
--   ONE MONTH AT A TIME.      unique (month_id, hp_id). An import targets one
--                             reporting month and can only ever rewrite that
--                             month's rows.
--
--   HP CODE IS THE IDENTITY.  Unique, uppercased and trimmed by trigger. A
--                             reactivated HP that Coway gives a NEW code is a
--                             NEW row - there is deliberately no merge path.
--
--   TOTAL NET IS THE MONTH'S. Not lifetime, not cumulative. The column is
--                             named total_net because that is what the business
--                             calls it; the comment is what stops the next
--                             reader assuming "accumulated".
--
-- Nothing here touches an existing table beyond one comment marking
-- `hm_monthly_performance.active_hp` deprecated - Active HP is derived from
-- these rows from Stage 8 onwards, and the old column is kept only so no
-- historical figure is destroyed by this migration.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- hps - the HP master list
-- -----------------------------------------------------------------------------

create table if not exists public.hps (
  id          uuid primary key default gen_random_uuid(),
  hp_code     text        not null,
  hp_name     text        not null,
  -- The HM who owns this HP TODAY. The month-by-month truth lives on
  -- hp_monthly_performance.hm_id, so moving an HP between HMs never rewrites
  -- what a previous month reported.
  hm_id       uuid        not null references public.hms (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid        references public.profiles (id) on delete set null,
  updated_by  uuid        references public.profiles (id) on delete set null,

  constraint hps_hp_code_key       unique (hp_code),
  constraint hps_hp_name_not_blank check (btrim(hp_name) <> ''),
  constraint hps_hp_code_format    check (hp_code ~ '^[A-Z0-9][A-Z0-9._/-]{0,31}$')
);

comment on table public.hps is
  'HP master list. One row per HP Code for the life of the code. An HP absent from a monthly import is never deleted; a reactivated HP with a new code is a new row.';
comment on column public.hps.hp_code is
  'The authoritative Coway identifier. Unique, uppercased and trimmed by trigger; the Excel import matches on this and never on the name.';
comment on column public.hps.hm_id is
  'The HM who owns this HP today. Historical ownership is hp_monthly_performance.hm_id, which is never rewritten by a later month.';

create index if not exists hps_hm_idx   on public.hps (hm_id);
create index if not exists hps_name_idx on public.hps (hp_name);

create or replace function public.tg_hps_normalize()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.hp_code is not null then
    new.hp_code := upper(btrim(new.hp_code));
  end if;

  if new.hp_name is not null then
    new.hp_name := btrim(new.hp_name);
  end if;

  return new;
end;
$fn$;

comment on function public.tg_hps_normalize() is
  'BEFORE INSERT/UPDATE trigger: uppercases and trims hps.hp_code and trims hps.hp_name so the Excel import can match on the code.';

drop trigger if exists hps_normalize on public.hps;
create trigger hps_normalize
  before insert or update on public.hps
  for each row execute function public.tg_hps_normalize();

drop trigger if exists hps_audit on public.hps;
create trigger hps_audit
  before insert or update on public.hps
  for each row execute function public.tg_set_audit_fields();

-- -----------------------------------------------------------------------------
-- hp_monthly_performance - one HP, one reporting month
-- -----------------------------------------------------------------------------

create table if not exists public.hp_monthly_performance (
  id            uuid        primary key default gen_random_uuid(),
  month_id      uuid        not null references public.months (id) on delete cascade,
  hp_id         uuid        not null references public.hps (id)    on delete cascade,
  -- Denormalised on purpose: this is which HM the HP reported to IN THIS MONTH,
  -- and it must not follow a later reassignment on the master record.
  hm_id         uuid        not null references public.hms (id)    on delete cascade,
  w1_key_in     integer     not null default 0,
  w2_key_in     integer     not null default 0,
  w3_key_in     integer     not null default 0,
  w4_key_in     integer     not null default 0,
  total_key_in  integer     not null default 0,
  total_net     integer     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid        references public.profiles (id) on delete set null,
  updated_by    uuid        references public.profiles (id) on delete set null,

  constraint hp_monthly_performance_month_hp_key unique (month_id, hp_id),

  constraint hp_monthly_performance_w1_natural        check (w1_key_in >= 0),
  constraint hp_monthly_performance_w2_natural        check (w2_key_in >= 0),
  constraint hp_monthly_performance_w3_natural        check (w3_key_in >= 0),
  constraint hp_monthly_performance_w4_natural        check (w4_key_in >= 0),
  constraint hp_monthly_performance_total_net_natural check (total_net >= 0),
  -- The application's calculated total is the only total this table accepts.
  constraint hp_monthly_performance_total_derived
    check (total_key_in = w1_key_in + w2_key_in + w3_key_in + w4_key_in)
);

comment on table public.hp_monthly_performance is
  'One row per HP per reporting month, imported from the PA Excel. A month can only be written by an import that targets it.';
comment on column public.hp_monthly_performance.total_key_in is
  'W1+W2+W3+W4, computed by the application and re-checked by hp_monthly_performance_total_derived. The Excel TOTAL KEY-IN column is a cross-check at import time and is never stored.';
comment on column public.hp_monthly_performance.total_net is
  'TOTAL NET for THIS MONTH only. Not lifetime, not accumulated across months, and not required to equal Total Key-In, Extrade or Non-Extrade.';
comment on constraint hp_monthly_performance_total_derived on public.hp_monthly_performance is
  'Total Key-In is derived from the four weekly figures. A row that disagrees with its own weeks cannot exist.';

create index if not exists hp_monthly_performance_month_idx    on public.hp_monthly_performance (month_id);
create index if not exists hp_monthly_performance_month_hm_idx on public.hp_monthly_performance (month_id, hm_id);
create index if not exists hp_monthly_performance_hp_idx       on public.hp_monthly_performance (hp_id);

-- Active HP is COUNT(*) WHERE total_key_in >= 1, per HM per month. A partial
-- index means that count reads only the active rows rather than the month.
create index if not exists hp_monthly_performance_active_idx
  on public.hp_monthly_performance (month_id, hm_id)
  where total_key_in >= 1;

drop trigger if exists hp_monthly_performance_audit on public.hp_monthly_performance;
create trigger hp_monthly_performance_audit
  before insert or update on public.hp_monthly_performance
  for each row execute function public.tg_set_audit_fields();

-- -----------------------------------------------------------------------------
-- hp_import_runs - what the PA uploaded, and when
-- -----------------------------------------------------------------------------

create table if not exists public.hp_import_runs (
  id                uuid        primary key default gen_random_uuid(),
  month_id          uuid        not null references public.months (id) on delete cascade,
  file_name         text        not null,
  rows_processed    integer     not null default 0,
  new_hp_count      integer     not null default 0,
  updated_hp_count  integer     not null default 0,
  active_hp_count   integer     not null default 0,
  inactive_hp_count integer     not null default 0,
  status            text        not null default 'success',
  imported_by       uuid        references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),

  constraint hp_import_runs_file_name_not_blank check (btrim(file_name) <> ''),
  constraint hp_import_runs_status_allowed      check (status in ('success')),
  constraint hp_import_runs_counts_natural      check (
    rows_processed >= 0 and new_hp_count >= 0 and updated_hp_count >= 0
    and active_hp_count >= 0 and inactive_hp_count >= 0
  )
);

comment on table public.hp_import_runs is
  'One row per successful HP import. A failed import writes nothing at all - including no run - because the whole commit happens inside one function call, and therefore inside one transaction.';

create index if not exists hp_import_runs_month_idx
  on public.hp_import_runs (month_id, created_at desc);

-- `imported_by` is stamped from the JWT, never trusted from the client - the
-- same rule tg_set_audit_fields applies to every other audited table.
create or replace function public.tg_hp_import_runs_set_actor()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  actor uuid := (select auth.uid());
begin
  new.created_at  := now();
  new.imported_by := coalesce(actor, new.imported_by);
  return new;
end;
$fn$;

comment on function public.tg_hp_import_runs_set_actor() is
  'BEFORE INSERT trigger: stamps hp_import_runs.imported_by from auth.uid().';

drop trigger if exists hp_import_runs_set_actor on public.hp_import_runs;
create trigger hp_import_runs_set_actor
  before insert on public.hp_import_runs
  for each row execute function public.tg_hp_import_runs_set_actor();

-- -----------------------------------------------------------------------------
-- The old manual Active HP column, marked deprecated
-- -----------------------------------------------------------------------------
-- Kept, not dropped: it holds real figures for months already recorded, and
-- dropping a column destroys them. It is no longer read by any calculation and
-- is no longer written by Data Entry - Active HP comes from the rows above.
comment on column public.hm_monthly_performance.active_hp is
  'DEPRECATED as of Stage 8. Active HP is now derived: COUNT of hp_monthly_performance rows for the HM and month with total_key_in >= 1 (see public.hm_monthly_hp_summary). This column is retained only so pre-Stage-8 figures are not destroyed; nothing reads it.';

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table public.hps                    enable row level security;
alter table public.hp_monthly_performance enable row level security;
alter table public.hp_import_runs         enable row level security;

revoke all on table public.hps                    from anon;
revoke all on table public.hp_monthly_performance from anon;
revoke all on table public.hp_import_runs         from anon;

grant select, insert, update, delete on table public.hps                    to authenticated;
grant select, insert, update, delete on table public.hp_monthly_performance to authenticated;
grant select, insert                 on table public.hp_import_runs         to authenticated;

-- The same access model as every other operational table: a PA maintains the
-- data, only a manager destroys it.
drop policy if exists hps_select_staff on public.hps;
create policy hps_select_staff
  on public.hps for select to authenticated using (public.is_staff());

drop policy if exists hps_insert_staff on public.hps;
create policy hps_insert_staff
  on public.hps for insert to authenticated with check (public.is_staff());

drop policy if exists hps_update_staff on public.hps;
create policy hps_update_staff
  on public.hps for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists hps_delete_manager on public.hps;
create policy hps_delete_manager
  on public.hps for delete to authenticated using (public.is_manager());

drop policy if exists hp_monthly_performance_select_staff on public.hp_monthly_performance;
create policy hp_monthly_performance_select_staff
  on public.hp_monthly_performance for select to authenticated using (public.is_staff());

drop policy if exists hp_monthly_performance_insert_staff on public.hp_monthly_performance;
create policy hp_monthly_performance_insert_staff
  on public.hp_monthly_performance for insert to authenticated with check (public.is_staff());

drop policy if exists hp_monthly_performance_update_staff on public.hp_monthly_performance;
create policy hp_monthly_performance_update_staff
  on public.hp_monthly_performance for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists hp_monthly_performance_delete_manager on public.hp_monthly_performance;
create policy hp_monthly_performance_delete_manager
  on public.hp_monthly_performance for delete to authenticated using (public.is_manager());

drop policy if exists hp_import_runs_select_staff on public.hp_import_runs;
create policy hp_import_runs_select_staff
  on public.hp_import_runs for select to authenticated using (public.is_staff());

drop policy if exists hp_import_runs_insert_staff on public.hp_import_runs;
create policy hp_import_runs_insert_staff
  on public.hp_import_runs for insert to authenticated with check (public.is_staff());

-- =============================================================================
-- Views
-- =============================================================================
-- Both are `security_invoker`, so the RLS above applies to the CALLER rather
-- than to the view's owner. A view that ran as its owner would be a hole
-- straight through every policy on the tables underneath it.

-- Active HP, per HM per month, computed in the database.
--
-- `hp_count` is what separates a real zero from no data at all: an HM with rows
-- this month and none of them active has Active HP 0, while an HM with no rows
-- has no Active HP figure - blank, not zero. Nothing downstream may collapse
-- those two.
create or replace view public.hm_monthly_hp_summary
with (security_invoker = true) as
  select p.month_id,
         p.hm_id,
         count(*)::int                                   as hp_count,
         count(*) filter (where p.total_key_in >= 1)::int as active_hp,
         sum(p.total_key_in)::int                        as hp_total_key_in,
         sum(p.total_net)::int                           as hp_total_net,
         -- Carried so the dashboard's "Updated ..." stamp moves when an import
         -- changes what is on screen, without the page reading HP rows.
         max(p.updated_at)                               as hp_updated_at
    from public.hp_monthly_performance p
   group by p.month_id, p.hm_id;

comment on view public.hm_monthly_hp_summary is
  'Active HP per HM per month: COUNT of HP rows with total_key_in >= 1. The single source of Active HP from Stage 8 onwards. No row for an HM means no HP data, which is blank rather than zero.';

-- The HP listing, joined once in the database so the page never fans out into
-- a query per row.
create or replace view public.hp_monthly_report
with (security_invoker = true) as
  select p.id,
         p.month_id,
         p.hp_id,
         p.hm_id,
         h.hp_code,
         h.hp_name,
         m.name    as hm_name,
         m.hm_code as hm_code,
         p.w1_key_in,
         p.w2_key_in,
         p.w3_key_in,
         p.w4_key_in,
         p.total_key_in,
         p.total_net,
         (p.total_key_in >= 1) as is_active,
         p.updated_at
    from public.hp_monthly_performance p
    join public.hps h on h.id = p.hp_id
    join public.hms m on m.id = p.hm_id;

comment on view public.hp_monthly_report is
  'One HP row of one reporting month, with the HP and HM identities already joined. Read-only; the HP listing reads this and nothing else.';

revoke all on public.hm_monthly_hp_summary from anon;
revoke all on public.hp_monthly_report     from anon;

grant select on public.hm_monthly_hp_summary to authenticated;
grant select on public.hp_monthly_report     to authenticated;
