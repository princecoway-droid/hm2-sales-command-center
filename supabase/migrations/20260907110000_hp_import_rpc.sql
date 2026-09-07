-- =============================================================================
-- HM2 Sales Command Center - Stage 8: the atomic HP import
-- -----------------------------------------------------------------------------
-- `import_hp_month` is the ONLY way HP performance gets written. It exists
-- because of one requirement that the Supabase client cannot satisfy on its
-- own: an import either lands completely or not at all.
--
-- PostgREST gives every statement its own transaction. Creating the new HPs,
-- rewriting the month's figures and recording the run would therefore be three
-- independent commits, and a failure between them would leave a month half
-- imported - the exact state a PA has no way to diagnose or undo. A plpgsql
-- function is one statement to the client and one transaction to the database,
-- so the "no partial commit" rule is structural rather than something the
-- application has to be careful about.
--
-- -----------------------------------------------------------------------------
-- What it is NOT
-- -----------------------------------------------------------------------------
-- NOT `security definer`. Every statement below runs as the caller, under the
-- Stage 8 RLS policies, exactly as the rest of the application does. A PA can
-- import because the policies say a PA may write these tables - not because
-- this function elevates them.
--
-- NOT the only place the rules live. The application validates the whole file
-- first and shows the PA a preview; this repeats the checks because a Server
-- Action is not a boundary. A direct POST to `/rest/v1/rpc/import_hp_month`
-- meets the same rules, with the same messages.
--
-- The raises carry a stable `hp_import_*` prefix so `mapDatabaseError()` can
-- turn them into something a PA can act on, the same way it handles a named
-- constraint violation.
-- =============================================================================

create or replace function public.import_hp_month(
  p_month_id  uuid,
  p_file_name text,
  p_rows      jsonb
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  -- The rows again, with every code uppercased and trimmed and every figure
  -- cast once. Normalising up front is what lets the matching below be a plain
  -- equality join rather than a function call per row.
  v_norm      jsonb;
  v_rows      integer;
  v_offenders text;
  v_new       integer;
  v_updated   integer;
  v_active    integer;
  v_inactive  integer;
  v_run_id    uuid;
begin
  -- ---------------------------------------------------------------------------
  -- Who, and what month
  -- ---------------------------------------------------------------------------
  if not public.is_staff() then
    raise exception 'hp_import_not_permitted: only an active manager or PA can import HP data'
      using errcode = '42501';
  end if;

  if p_month_id is null
     or not exists (select 1 from public.months m where m.id = p_month_id) then
    raise exception 'hp_import_unknown_month: that reporting month does not exist'
      using errcode = '23503';
  end if;

  if btrim(coalesce(p_file_name, '')) = '' then
    raise exception 'hp_import_no_file_name: the import must record the file it came from'
      using errcode = '23514';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'hp_import_no_rows: the import carried no rows'
      using errcode = '22023';
  end if;

  v_rows := jsonb_array_length(p_rows);

  if v_rows = 0 then
    raise exception 'hp_import_no_rows: the import carried no rows'
      using errcode = '22023';
  end if;

  -- A ceiling, not a target. Well past a real monthly file, and low enough that
  -- a malformed or hostile payload cannot turn one request into an hour of
  -- work.
  if v_rows > 5000 then
    raise exception 'hp_import_too_many_rows: an import is limited to 5000 rows (% supplied)', v_rows
      using errcode = '22023';
  end if;

  -- ---------------------------------------------------------------------------
  -- Normalise once
  -- ---------------------------------------------------------------------------
  select jsonb_agg(
           jsonb_build_object(
             'row_no',       coalesce(nullif(e.value ->> 'row_no', '')::int, e.ordinality::int),
             'hm_code',      upper(btrim(coalesce(e.value ->> 'hm_code', ''))),
             'hp_code',      upper(btrim(coalesce(e.value ->> 'hp_code', ''))),
             'hp_name',      btrim(coalesce(e.value ->> 'hp_name', '')),
             'w1',           coalesce(nullif(e.value ->> 'w1', '')::int, 0),
             'w2',           coalesce(nullif(e.value ->> 'w2', '')::int, 0),
             'w3',           coalesce(nullif(e.value ->> 'w3', '')::int, 0),
             'w4',           coalesce(nullif(e.value ->> 'w4', '')::int, 0),
             'total_key_in', coalesce(nullif(e.value ->> 'total_key_in', '')::int, 0),
             'total_net',    coalesce(nullif(e.value ->> 'total_net', '')::int, 0)
           )
           order by e.ordinality
         )
    into v_norm
    from jsonb_array_elements(p_rows) with ordinality as e(value, ordinality);

  -- ---------------------------------------------------------------------------
  -- Row validation. Nothing is written until every one of these passes.
  -- ---------------------------------------------------------------------------

  -- Required identifiers.
  select string_agg('row ' || r.row_no, ', ' order by r.row_no)
    into v_offenders
    from jsonb_to_recordset(v_norm)
           as r(row_no int, hm_code text, hp_code text, hp_name text)
   where r.hm_code = '' or r.hp_code = '' or r.hp_name = '';

  if v_offenders is not null then
    raise exception 'hp_import_missing_field: HM Code, HP Code and HP Name are required (%)', v_offenders
      using errcode = '23514';
  end if;

  -- No negative Key-In, no negative Net.
  select string_agg('row ' || r.row_no, ', ' order by r.row_no)
    into v_offenders
    from jsonb_to_recordset(v_norm)
           as r(row_no int, w1 int, w2 int, w3 int, w4 int, total_net int)
   where r.w1 < 0 or r.w2 < 0 or r.w3 < 0 or r.w4 < 0 or r.total_net < 0;

  if v_offenders is not null then
    raise exception 'hp_import_negative_value: Key-In and Total Net cannot be negative (%)', v_offenders
      using errcode = '23514';
  end if;

  -- The caller's own total has to be the sum of its own weeks. The stored
  -- figure is recomputed below regardless, so this only catches a caller that
  -- has already contradicted itself.
  select string_agg('row ' || r.row_no, ', ' order by r.row_no)
    into v_offenders
    from jsonb_to_recordset(v_norm)
           as r(row_no int, w1 int, w2 int, w3 int, w4 int, total_key_in int)
   where r.total_key_in <> r.w1 + r.w2 + r.w3 + r.w4;

  if v_offenders is not null then
    raise exception 'hp_import_total_mismatch: Total Key-In does not equal W1+W2+W3+W4 (%)', v_offenders
      using errcode = '23514';
  end if;

  -- One HP Code may appear once. Merging duplicates silently would make the
  -- month's figures depend on row order.
  -- The subquery groups; the outer aggregate then names EVERY repeated code
  -- rather than the first one. `select into` takes one row, so a grouped query
  -- on its own would report a single duplicate and hide the rest.
  select string_agg(duplicated.hp_code, ', ' order by duplicated.hp_code)
    into v_offenders
    from (
      select r.hp_code
        from jsonb_to_recordset(v_norm) as r(hp_code text)
       group by r.hp_code
      having count(*) > 1
    ) as duplicated;

  if v_offenders is not null then
    raise exception 'hp_import_duplicate_hp_code: HP Code appears more than once (%)', v_offenders
      using errcode = '23505';
  end if;

  -- Every HM Code must already name an HM. An import never creates one: an
  -- unrecognised code is far more likely to be a typo than a new hire, and
  -- inventing an HM would put a person on the dashboard that nobody added.
  select string_agg(distinct r.hm_code, ', ')
    into v_offenders
    from jsonb_to_recordset(v_norm) as r(hm_code text)
   where not exists (select 1 from public.hms h where h.hm_code = r.hm_code);

  if v_offenders is not null then
    raise exception 'hp_import_unknown_hm_code: no HM has that HM Code (%)', v_offenders
      using errcode = '23503';
  end if;

  -- ---------------------------------------------------------------------------
  -- Counts, taken BEFORE anything is written
  -- ---------------------------------------------------------------------------
  select count(*) filter (where existing.id is null)::int,
         count(*) filter (where existing.id is not null)::int
    into v_new, v_updated
    from jsonb_to_recordset(v_norm) as r(hp_code text)
    left join public.hps existing on existing.hp_code = r.hp_code;

  select count(*) filter (where r.total_key_in >= 1)::int,
         count(*) filter (where r.total_key_in <  1)::int
    into v_active, v_inactive
    from jsonb_to_recordset(v_norm) as r(total_key_in int);

  -- ---------------------------------------------------------------------------
  -- Write
  -- ---------------------------------------------------------------------------

  -- New HPs. The PA never has to create one by hand.
  insert into public.hps (hp_code, hp_name, hm_id)
  select r.hp_code, r.hp_name, h.id
    from jsonb_to_recordset(v_norm) as r(hp_code text, hp_name text, hm_code text)
    join public.hms h on h.hm_code = r.hm_code
   where not exists (select 1 from public.hps p where p.hp_code = r.hp_code);

  -- Existing HPs: the name and the CURRENT owner follow the file. Renaming an
  -- HP or moving them to another HM is an ordinary correction, and the previous
  -- months keep their own hm_id, so nothing historical moves with it.
  update public.hps p
     set hp_name = r.hp_name,
         hm_id   = h.id
    from jsonb_to_recordset(v_norm) as r(hp_code text, hp_name text, hm_code text)
    join public.hms h on h.hm_code = r.hm_code
   where p.hp_code = r.hp_code
     and (p.hp_name is distinct from r.hp_name or p.hm_id is distinct from h.id);

  -- The month's figures. `p_month_id` is the only month any of this can touch,
  -- so an import of September cannot reach August.
  insert into public.hp_monthly_performance (
    month_id, hp_id, hm_id,
    w1_key_in, w2_key_in, w3_key_in, w4_key_in,
    total_key_in, total_net
  )
  select p_month_id,
         p.id,
         h.id,
         r.w1, r.w2, r.w3, r.w4,
         -- Recomputed here, not taken from the payload: the stored total is
         -- always the application's own sum of the four weeks.
         r.w1 + r.w2 + r.w3 + r.w4,
         r.total_net
    from jsonb_to_recordset(v_norm)
           as r(hp_code text, hm_code text, w1 int, w2 int, w3 int, w4 int, total_net int)
    join public.hps p on p.hp_code = r.hp_code
    join public.hms h on h.hm_code = r.hm_code
      on conflict (month_id, hp_id) do update
     set hm_id        = excluded.hm_id,
         w1_key_in    = excluded.w1_key_in,
         w2_key_in    = excluded.w2_key_in,
         w3_key_in    = excluded.w3_key_in,
         w4_key_in    = excluded.w4_key_in,
         total_key_in = excluded.total_key_in,
         total_net    = excluded.total_net;

  insert into public.hp_import_runs (
    month_id, file_name, rows_processed,
    new_hp_count, updated_hp_count, active_hp_count, inactive_hp_count
  )
  values (
    p_month_id, btrim(p_file_name), v_rows,
    v_new, v_updated, v_active, v_inactive
  )
  returning id into v_run_id;

  return jsonb_build_object(
    'run_id',            v_run_id,
    'month_id',          p_month_id,
    'rows_processed',    v_rows,
    'new_hp_count',      v_new,
    'updated_hp_count',  v_updated,
    'active_hp_count',   v_active,
    'inactive_hp_count', v_inactive
  );
end;
$fn$;

comment on function public.import_hp_month(uuid, text, jsonb) is
  'Imports one reporting month of HP performance in a single transaction. Validates the whole payload first and writes nothing if any row fails, so there is no partial import. Runs as the caller under RLS - it is not SECURITY DEFINER.';

-- Only a signed-in user reaches it; `is_staff()` inside decides the rest.
revoke all on function public.import_hp_month(uuid, text, jsonb) from public, anon;
grant execute on function public.import_hp_month(uuid, text, jsonb) to authenticated;
