-- =============================================================================
-- HM2 Sales Command Center - Stage 8: HM Code
-- -----------------------------------------------------------------------------
-- Stage 8 imports HP-level performance from the PA's Excel, and the column that
-- ties a row of that spreadsheet to a person in this database is the HM CODE -
-- not the name. Names change, names are spelled three ways in three exports,
-- and two Health Managers can legitimately share one. The code is the
-- authoritative identifier Coway itself uses, so it becomes a first-class
-- column here rather than something the import guesses at.
--
-- -----------------------------------------------------------------------------
-- Why the column has a DEFAULT
-- -----------------------------------------------------------------------------
-- `hms` already holds real records. A NOT NULL column with no default cannot be
-- added to a populated table without a backfill, and a backfill that invents a
-- code per row still leaves every future INSERT having to supply one - which
-- would break the day somebody adds an HM through psql or a seed script.
--
-- So the column is NOT NULL, UNIQUE, and defaults to the next value of a
-- sequence: `HM00001`, `HM00002`, ... Every existing row is backfilled from the
-- same sequence, so the placeholder codes are unique, obviously provisional,
-- and immediately editable. The application's own form REQUIRES the field and
-- validates it before saving (see `hmSchema`), so the default is a safety net
-- for direct database access, never the path the app takes.
--
-- Normalisation is a trigger rather than a convention: `hm10321`, ` HM10321 `
-- and `HM10321` are one code, and the Excel import has to be able to match on
-- it without knowing how the PA typed it that morning.
--
-- Additive: no existing column, constraint, policy or trigger is altered.
-- =============================================================================

create sequence if not exists public.hms_hm_code_seq;

comment on sequence public.hms_hm_code_seq is
  'Supplies the provisional HM code (HM00001, HM00002, ...) for a row inserted without one. Real Coway codes are keyed in through HM Management.';

alter table public.hms
  add column if not exists hm_code text;

-- Backfill BEFORE the NOT NULL: existing HMs get a provisional code each.
update public.hms
   set hm_code = 'HM' || lpad(nextval('public.hms_hm_code_seq')::text, 5, '0')
 where hm_code is null;

alter table public.hms
  alter column hm_code set default ('HM' || lpad(nextval('public.hms_hm_code_seq')::text, 5, '0'));

alter table public.hms
  alter column hm_code set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hms_hm_code_key'
  ) then
    alter table public.hms add constraint hms_hm_code_key unique (hm_code);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'hms_hm_code_format'
  ) then
    -- Uppercase letters, digits and the few separators a code plausibly
    -- carries. No spaces: a code with a space in it cannot be matched reliably
    -- against a spreadsheet cell, and the PA is told so at the field rather
    -- than discovering it during an import.
    alter table public.hms add constraint hms_hm_code_format
      check (hm_code ~ '^[A-Z0-9][A-Z0-9._/-]{0,31}$');
  end if;
end
$$;

comment on column public.hms.hm_code is
  'The authoritative Coway identifier for this HM. Unique, uppercased and trimmed by trigger. The Stage 8 Excel import matches on this column and NEVER on the name.';

-- The DEFAULT calls nextval() as the INSERTING user, so a PA adding an HM needs
-- USAGE on the sequence. Without this grant the column's own default is what
-- refuses the insert - "permission denied for sequence" - which is a confusing
-- way to discover a missing grant.
--
-- `anon` gets nothing: it cannot reach the table at all.
revoke all on sequence public.hms_hm_code_seq from public, anon;
grant usage, select on sequence public.hms_hm_code_seq to authenticated;

-- Normalises the code so matching is deterministic. Runs before the CHECK, so
-- a lowercase code entered in the form is accepted and stored uppercase rather
-- than rejected.
create or replace function public.tg_hms_normalize_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.hm_code is not null then
    new.hm_code := upper(btrim(new.hm_code));
  end if;

  return new;
end;
$$;

comment on function public.tg_hms_normalize_code() is
  'BEFORE INSERT/UPDATE trigger: uppercases and trims hms.hm_code so the Excel import can match on it.';

drop trigger if exists hms_normalize_code on public.hms;
create trigger hms_normalize_code
  before insert or update on public.hms
  for each row execute function public.tg_hms_normalize_code();
