-- =============================================================================
-- HM2 Sales Command Center - Stage 7: the sales-week cascade, closed in the
-- database
-- -----------------------------------------------------------------------------
-- `sales_weeks.id` cascades into `hm_weekly_performance`, and an ON DELETE
-- CASCADE runs as the table owner rather than as the caller. So deleting a week
-- removes the Key-In recorded against it WITHOUT consulting
-- `hm_weekly_performance_delete_manager` - the policy that exists precisely to
-- keep performance history out of a PA's reach.
--
-- Stage 2 closed that door in the application (`deleteSalesWeekAction`: a week
-- holding Key-In is manager-only, and even a manager has to confirm after being
-- told how many rows go with it). That guard is correct and stays; what it is
-- not is a boundary. A PA holds a real `authenticated` JWT and the anon key, so
-- a single request to PostgREST reaches the table directly, and the application
-- rule is not in the path.
--
-- This trigger puts the same rule where the boundary actually is. It says
-- nothing new: exactly the cases the app already refuses are the cases Postgres
-- now refuses.
--
--   PA,      week with no Key-In    -> allowed  (the mistyped-period case)
--   PA,      week holding Key-In    -> refused  (42501)
--   manager, either                 -> allowed
--   no JWT (migration, seed, admin) -> allowed
--
-- Additive: no existing table, policy, trigger, constraint or grant is altered.
-- After applying it, `deleteSalesWeekAction` behaves exactly as it did - it
-- refuses first, with a better message, and never reaches this trigger.
-- =============================================================================

create or replace function public.tg_sales_weeks_guard_cascade()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor    uuid := (select auth.uid());
  keyin_rows integer;
begin
  -- No JWT means a service-role write, a migration or a seed. Those already
  -- bypass RLS entirely, so refusing them here would only break `db reset`
  -- while protecting nothing. Same reasoning as tg_set_audit_fields().
  if actor is null then
    return old;
  end if;

  if public.is_manager() then
    return old;
  end if;

  select count(*)
    into keyin_rows
    from public.hm_weekly_performance k
   where k.week_id = old.id;

  if keyin_rows > 0 then
    -- 42501 is what mapDatabaseError() already turns into "You do not have
    -- permission to do that.", so a direct API call gets the same answer the
    -- UI would have given, rather than an unmapped database error.
    raise exception
      'Only a manager can remove a sales week that holds Key-In (% record(s) would be deleted with it)',
      keyin_rows
      using errcode = '42501';
  end if;

  return old;
end;
$$;

comment on function public.tg_sales_weeks_guard_cascade() is
  'BEFORE DELETE trigger: a non-manager cannot delete a sales week whose ON DELETE CASCADE would remove hm_weekly_performance rows they are not permitted to delete.';

drop trigger if exists sales_weeks_guard_cascade on public.sales_weeks;
create trigger sales_weeks_guard_cascade
  before delete on public.sales_weeks
  for each row execute function public.tg_sales_weeks_guard_cascade();

-- The function is only ever reached through the trigger, which runs as the
-- table owner; nobody needs to call it directly.
revoke all on function public.tg_sales_weeks_guard_cascade() from public, anon, authenticated;
