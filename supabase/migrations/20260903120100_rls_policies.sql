-- =============================================================================
-- HM2 Sales Command Center - Stage 1: Row Level Security policies
-- -----------------------------------------------------------------------------
-- Access model
--   MANAGER  full read/write across all internal application data.
--   PA       read everything internal; write the operational data a PA owns
--            (HM records, the sales calendar, monthly/weekly performance,
--            group SHI). Destructive deletes of performance history and of HM
--            master records are reserved for the manager - a PA deactivates an
--            HM instead of deleting one.
--   HM       has no authenticated database role in V1. The read-only HM
--            dashboard arrives in a later stage; nothing here exposes data to
--            `anon`.
--
-- Every policy is scoped `to authenticated` and gated on public.is_staff() /
-- public.is_manager(), which resolve the caller's role from an *active*
-- profile. A deactivated profile therefore loses all access immediately.
--
-- One behaviour worth knowing when writing mutations against these tables: a
-- USING clause that fails does NOT raise. SELECT, UPDATE and DELETE simply see
-- no matching rows, so a PA's delete succeeds having removed nothing. Only
-- INSERT and UPDATE ... WITH CHECK raise on violation. Application code must
-- therefore treat "0 rows affected" on a delete as a permission failure rather
-- than assuming success.
-- =============================================================================

-- Belt and braces: Supabase grants table privileges to `anon` by default. RLS
-- already denies anonymous reads because no policy targets `anon`, but with the
-- grants revoked the tables are unreachable even if a policy is ever widened by
-- accident.
revoke all on table public.profiles               from anon;
revoke all on table public.hms                    from anon;
revoke all on table public.months                 from anon;
revoke all on table public.sales_weeks            from anon;
revoke all on table public.hm_monthly_performance from anon;
revoke all on table public.hm_weekly_performance  from anon;
revoke all on table public.group_monthly_metrics  from anon;

-- Supabase's default privileges would grant these to `authenticated` anyway,
-- but spelling them out keeps the migration self-contained: applied to a plain
-- Postgres the schema still works, and it is obvious that table-level DML is
-- open to every signed-in user with RLS - not the grants - deciding the rest.
grant select, insert, update, delete on table public.profiles               to authenticated;
grant select, insert, update, delete on table public.hms                    to authenticated;
grant select, insert, update, delete on table public.months                 to authenticated;
grant select, insert, update, delete on table public.sales_weeks            to authenticated;
grant select, insert, update, delete on table public.hm_monthly_performance to authenticated;
grant select, insert, update, delete on table public.hm_weekly_performance  to authenticated;
grant select, insert, update, delete on table public.group_monthly_metrics  to authenticated;

-- The role helpers are only ever called from policies on behalf of a logged-in
-- user.
revoke all on function public.current_profile_role() from public, anon;
revoke all on function public.is_manager()           from public, anon;
revoke all on function public.is_staff()             from public, anon;

grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.is_manager()           to authenticated;
grant execute on function public.is_staff()             to authenticated;

-- -----------------------------------------------------------------------------
-- profiles
--
-- A user always sees their own profile (the app needs it to resolve role on
-- every request). Managers see and administer the whole team. The column guard
-- trigger from the previous migration stops a PA from self-promoting through
-- the self-update policy.
-- -----------------------------------------------------------------------------

drop policy if exists profiles_select_self_or_manager on public.profiles;
create policy profiles_select_self_or_manager
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()) or public.is_manager());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists profiles_manager_insert on public.profiles;
create policy profiles_manager_insert
  on public.profiles for insert
  to authenticated
  with check (public.is_manager());

drop policy if exists profiles_manager_update on public.profiles;
create policy profiles_manager_update
  on public.profiles for update
  to authenticated
  using (public.is_manager())
  with check (public.is_manager());

drop policy if exists profiles_manager_delete on public.profiles;
create policy profiles_manager_delete
  on public.profiles for delete
  to authenticated
  using (public.is_manager());

-- -----------------------------------------------------------------------------
-- hms - PA manages HM records; only a manager may delete one outright.
-- -----------------------------------------------------------------------------

drop policy if exists hms_select_staff on public.hms;
create policy hms_select_staff
  on public.hms for select
  to authenticated
  using (public.is_staff());

drop policy if exists hms_insert_staff on public.hms;
create policy hms_insert_staff
  on public.hms for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists hms_update_staff on public.hms;
create policy hms_update_staff
  on public.hms for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists hms_delete_manager on public.hms;
create policy hms_delete_manager
  on public.hms for delete
  to authenticated
  using (public.is_manager());

-- -----------------------------------------------------------------------------
-- months - PA opens a reporting month; deleting one cascades into performance
-- history, so that stays with the manager.
-- -----------------------------------------------------------------------------

drop policy if exists months_select_staff on public.months;
create policy months_select_staff
  on public.months for select
  to authenticated
  using (public.is_staff());

drop policy if exists months_insert_staff on public.months;
create policy months_insert_staff
  on public.months for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists months_update_staff on public.months;
create policy months_update_staff
  on public.months for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists months_delete_manager on public.months;
create policy months_delete_manager
  on public.months for delete
  to authenticated
  using (public.is_manager());

-- -----------------------------------------------------------------------------
-- sales_weeks - configuring Coway's official calendar is squarely a PA task,
-- including removing a period that was entered by mistake.
-- -----------------------------------------------------------------------------

drop policy if exists sales_weeks_select_staff on public.sales_weeks;
create policy sales_weeks_select_staff
  on public.sales_weeks for select
  to authenticated
  using (public.is_staff());

drop policy if exists sales_weeks_insert_staff on public.sales_weeks;
create policy sales_weeks_insert_staff
  on public.sales_weeks for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists sales_weeks_update_staff on public.sales_weeks;
create policy sales_weeks_update_staff
  on public.sales_weeks for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists sales_weeks_delete_staff on public.sales_weeks;
create policy sales_weeks_delete_staff
  on public.sales_weeks for delete
  to authenticated
  using (public.is_staff());

-- -----------------------------------------------------------------------------
-- hm_monthly_performance - PA keys the data in and corrects it; deletions are
-- manager-only so history cannot quietly disappear.
-- -----------------------------------------------------------------------------

drop policy if exists hm_monthly_performance_select_staff on public.hm_monthly_performance;
create policy hm_monthly_performance_select_staff
  on public.hm_monthly_performance for select
  to authenticated
  using (public.is_staff());

drop policy if exists hm_monthly_performance_insert_staff on public.hm_monthly_performance;
create policy hm_monthly_performance_insert_staff
  on public.hm_monthly_performance for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists hm_monthly_performance_update_staff on public.hm_monthly_performance;
create policy hm_monthly_performance_update_staff
  on public.hm_monthly_performance for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists hm_monthly_performance_delete_manager on public.hm_monthly_performance;
create policy hm_monthly_performance_delete_manager
  on public.hm_monthly_performance for delete
  to authenticated
  using (public.is_manager());

-- -----------------------------------------------------------------------------
-- hm_weekly_performance
-- -----------------------------------------------------------------------------

drop policy if exists hm_weekly_performance_select_staff on public.hm_weekly_performance;
create policy hm_weekly_performance_select_staff
  on public.hm_weekly_performance for select
  to authenticated
  using (public.is_staff());

drop policy if exists hm_weekly_performance_insert_staff on public.hm_weekly_performance;
create policy hm_weekly_performance_insert_staff
  on public.hm_weekly_performance for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists hm_weekly_performance_update_staff on public.hm_weekly_performance;
create policy hm_weekly_performance_update_staff
  on public.hm_weekly_performance for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists hm_weekly_performance_delete_manager on public.hm_weekly_performance;
create policy hm_weekly_performance_delete_manager
  on public.hm_weekly_performance for delete
  to authenticated
  using (public.is_manager());

-- -----------------------------------------------------------------------------
-- group_monthly_metrics - the eTrust group SHI figure.
-- -----------------------------------------------------------------------------

drop policy if exists group_monthly_metrics_select_staff on public.group_monthly_metrics;
create policy group_monthly_metrics_select_staff
  on public.group_monthly_metrics for select
  to authenticated
  using (public.is_staff());

drop policy if exists group_monthly_metrics_insert_staff on public.group_monthly_metrics;
create policy group_monthly_metrics_insert_staff
  on public.group_monthly_metrics for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists group_monthly_metrics_update_staff on public.group_monthly_metrics;
create policy group_monthly_metrics_update_staff
  on public.group_monthly_metrics for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists group_monthly_metrics_delete_manager on public.group_monthly_metrics;
create policy group_monthly_metrics_delete_manager
  on public.group_monthly_metrics for delete
  to authenticated
  using (public.is_manager());
