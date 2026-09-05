-- =============================================================================
-- HM2 Sales Command Center - Stage 2: no overlapping sales weeks
-- -----------------------------------------------------------------------------
-- Stage 1 left overlap detection to the application (see findOverlappingWeeks
-- in src/lib/validation/sales-week.ts) because an ordinary CHECK or EXCLUDE
-- constraint would reject a legitimate mid-edit state: shifting W2..W5 forward
-- by a day means the first UPDATE momentarily overlaps its neighbour, even
-- though the finished set is clean.
--
-- A DEFERRABLE constraint trigger gets both properties at once. It fires at
-- COMMIT rather than per statement, so a PA can rewrite every week boundary in
-- one transaction, while the committed state can never contain two periods that
-- cover the same day. Stage 2 writes the whole calendar in one transaction, so
-- this is the correct enforcement point - the client check stays as the fast,
-- friendly first pass.
--
-- Additive only: no existing table, policy, trigger or constraint is altered.
-- =============================================================================

create or replace function public.tg_sales_weeks_no_overlap()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  clash record;
begin
  -- Any pair of periods in this month sharing at least one day. Inclusive on
  -- both ends: a week ending on the 12th and the next starting on the 12th is
  -- an overlap, whereas starting on the 13th is not.
  select least(a.week_number, b.week_number)    as first_week,
         greatest(a.week_number, b.week_number) as second_week
    into clash
    from public.sales_weeks a
    join public.sales_weeks b
      on  b.month_id = a.month_id
      and b.id      <> a.id
      and a.start_date <= b.end_date
      and b.start_date <= a.end_date
   where a.month_id = new.month_id
   order by 1, 2
   limit 1;

  if found then
    -- The constraint name is carried in the message on purpose: mapDatabaseError
    -- in src/lib/errors.ts matches on it to produce a field-level message, the
    -- same way it handles a real constraint violation.
    raise exception
      'sales_weeks_no_overlap: week % and week % cover the same dates',
      clash.first_week, clash.second_week
      using errcode = '23514';
  end if;

  return null;
end;
$$;

comment on function public.tg_sales_weeks_no_overlap() is
  'Deferred constraint trigger: rejects a COMMIT that leaves two sales weeks of one month covering the same day. Deferred so a multi-week reshuffle can pass through an overlapping intermediate state.';

drop trigger if exists sales_weeks_no_overlap on public.sales_weeks;
create constraint trigger sales_weeks_no_overlap
  after insert or update on public.sales_weeks
  deferrable initially deferred
  for each row execute function public.tg_sales_weeks_no_overlap();
