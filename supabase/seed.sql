-- =============================================================================
-- HM2 Sales Command Center - LOCAL DEVELOPMENT SEED
-- -----------------------------------------------------------------------------
-- Runs automatically on `npm run db:reset` (supabase db reset) against the
-- LOCAL stack only. It is never applied to a hosted project by `db push`.
--
-- What it seeds, and what it deliberately does not:
--
--   HMs       four obviously fictional records (Sample HM A-D) so the UI has
--             something to render. The real HM team is added through the app.
--
--   Months    the twelve reporting months of the current year. Calendar facts,
--             not invented business data - quarter and label are derived by the
--             database trigger.
--
--   Weeks     NOT seeded. Coway's weekly periods are official and irregular;
--             inventing date ranges here would be indistinguishable from real
--             configuration once it is in the database. A PA configures them.
--
--   Perf data NOT seeded. No fabricated net units, SHI or Key-In figures.
--
--   HP data  NOT seeded. HP rows arrive through the Excel import, and inventing
--            them here would put fabricated Active HP figures on the dashboard.
--
-- Everything below is idempotent, so re-running is safe.
-- =============================================================================

-- `hms` now has a natural unique key - hm_code - but the guard still keys on
-- the name: a developer who has already edited a sample record's code should
-- not get a second copy of it on the next reset.
--
-- The codes are obviously fictional and obviously placeholders. They exist so
-- the Stage 8 HP import has something to match against locally; the real Coway
-- codes are keyed in through HM Management.
insert into public.hms (name, hm_code, office, status, display_order)
select sample.name, sample.hm_code, sample.office, sample.status, sample.display_order
from (values
  ('Sample HM A', 'HMSAMPLEA', 'Sample Office', 'active',   1),
  ('Sample HM B', 'HMSAMPLEB', 'Sample Office', 'active',   2),
  ('Sample HM C', 'HMSAMPLEC', 'Sample Office', 'active',   3),
  ('Sample HM D', 'HMSAMPLED', 'Sample Office', 'inactive', 4)
) as sample (name, hm_code, office, status, display_order)
where not exists (
  select 1 from public.hms existing where existing.name = sample.name
);

insert into public.months (year, month, label, quarter)
select
  extract(year from current_date)::int,
  m,
  '',  -- derived by tg_months_set_derived
  1    -- derived by tg_months_set_derived
from generate_series(1, 12) as m
on conflict (year, month) do nothing;
