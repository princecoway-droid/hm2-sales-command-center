-- =============================================================================
-- HM2 Sales Command Center - Extrade and Non-Extrade become independent inputs
-- -----------------------------------------------------------------------------
-- The core schema encoded an identity that turned out not to be the business
-- rule:
--
--   extrade_units + non_extrade_units = net_units
--
-- Extrade and Non-Extrade are two figures the PA keys in from separate Coway
-- reports. They are NOT a partition of Net. They need not come to Net, they need
-- not come to Total Key-In, and they need not come to each other - so the CHECK
-- refused perfectly ordinary months. With Total Key-In 72, Net 65, Extrade 27
-- and Non-Extrade 24, the row above is exactly what the PA has in front of them
-- and exactly what the constraint rejected.
--
-- The only relationship either figure has is for display, and it is computed in
-- the application, never stored:
--
--   Extrade %      = extrade_units     / TOTAL KEY-IN x 100
--   Non-Extrade %  = non_extrade_units / TOTAL KEY-IN x 100
--
-- Total Key-In is itself derived (SUM of the weekly rows), so it is not a column
-- this table could constrain against even if there were a rule to enforce.
--
-- What this migration does NOT touch: the natural-number CHECKs on both columns
-- (a negative split is still refused), net_units, the weekly tables, the
-- triggers, the RLS policies and every other constraint. Dropping a CHECK only
-- widens what is accepted, so every row already stored stays valid.
-- =============================================================================

alter table public.hm_monthly_performance
  drop constraint if exists hm_monthly_performance_extrade_split;

comment on table public.hm_monthly_performance is
  'One row per HM per month. Extrade and Non-Extrade are independent keyed figures - they are not required to sum to net units; their percentages are computed by the application against TOTAL KEY-IN.';

comment on column public.hm_monthly_performance.extrade_units is
  'Keyed in manually. Independent of net_units and of non_extrade_units. Shown as a share of total Key-In (the sum of the weekly rows), which is computed in the application.';

comment on column public.hm_monthly_performance.non_extrade_units is
  'Keyed in manually. Independent of net_units and of extrade_units. Shown as a share of total Key-In (the sum of the weekly rows), which is computed in the application.';
