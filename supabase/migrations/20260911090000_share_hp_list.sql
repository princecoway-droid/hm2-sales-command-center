-- =============================================================================
-- HM2 Sales Command Center - the HP list behind an HM's Active HP, shared
-- -----------------------------------------------------------------------------
-- Stage 8 put Active HP on the shared report as a COUNT and stopped there: the
-- HM opening the WhatsApp link could read "Active HP 18" and had nowhere to go
-- with it. The question a number like that provokes is "which 18", and the HM
-- is the one person who needs the answer - they are their own HPs' manager.
--
-- So this adds the third, and last, function `anon` may execute:
--
--   /share/<token>                 ->  resolve_share_report(token)
--   /share/<token>/hm/<hmId>       ->  resolve_share_hm_report(token, hmId)
--   /share/<token>/hm/<hmId>/hp    ->  resolve_share_hm_hp(token, hmId)
--
-- The first two are NOT touched.
--
-- -----------------------------------------------------------------------------
-- What this widens, and what it deliberately does not
-- -----------------------------------------------------------------------------
-- This is the first time an HP row leaves the database anonymously, so the
-- narrowing is the whole of the design:
--
--   ONE HM.       `p_hm_id`, and it has to be an HM the token's month is
--                 already about - the same gate `resolve_share_hm_report`
--                 applies. A token cannot walk the HM table, and it cannot read
--                 another HM's HPs by asking for them.
--
--   ONE MONTH.    `link.month_id`. There is no parameter for a month and no way
--                 to reach one the token was not created for.
--
--   FIGURES ONLY. HP code, name and the month's numbers. No `hps.id`, no
--                 `hp_monthly_performance.id`, no `hm_id`, no created_by /
--                 updated_by, no created_at. Nothing here is a handle to
--                 anything, so the payload cannot be used to address a record.
--
--   A CEILING.    1000 rows. Far past any real HM's roster, and it means a
--                 single request cannot be turned into a bulk export of the
--                 whole HP table by an HM who happens to own a lot of them.
--
-- What a holder of this link can now see that they could not before: the names
-- and Coway codes of one HM's HPs, and what each of them keyed in that month.
-- That is a real widening and it is the point of the change - it is the HM's
-- own team, on a link their manager gave them.
-- =============================================================================

create or replace function public.resolve_share_hm_hp(
  p_token text,
  p_hm_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  link public.share_links;
  m    public.months;
  hm   public.hms;
  body jsonb;
begin
  -- Shape first, so a probe carrying a uuid, an empty string or a month id
  -- never reaches the index at all. Identical to the other two: the three doors
  -- are the same door.
  if p_token is null
     or p_hm_id is null
     or char_length(p_token) < 32
     or char_length(p_token) > 128
     or p_token !~ '^[A-Za-z0-9_-]+$'
     or p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;

  select * into link from public.share_links where token = p_token;

  if not found
     or not link.is_active
     or link.revoked_at is not null
     or (link.expires_at is not null and link.expires_at <= now()) then
    return null;
  end if;

  select * into m from public.months where id = link.month_id;

  if not found then
    return null;
  end if;

  -- The HM has to be one this month can be about: currently active, or holding
  -- figures for the token's own month. The same rule the other two functions
  -- apply, so this page can only ever be reached from a card the report already
  -- showed - and an id that was never on it is answered with NULL rather than
  -- with an empty list, which would confirm the id exists.
  select h.* into hm
    from public.hms h
   where h.id = p_hm_id
     and (h.status = 'active'
          or exists (
               select 1
                 from public.hm_monthly_performance p
                where p.hm_id = h.id
                  and p.month_id = m.id
             )
          or exists (
               select 1
                 from public.hm_weekly_performance k
                 join public.sales_weeks w on w.id = k.week_id
                where k.hm_id = h.id
                  and w.month_id = m.id
             ));

  if not found then
    return null;
  end if;

  -- Coarse audit, throttled exactly as the other two are. Opening the HP list
  -- is an access of the same link, so it counts as one.
  update public.share_links
     set last_accessed_at = now()
   where id = link.id
     and (last_accessed_at is null
          or last_accessed_at < now() - interval '5 minutes');

  select jsonb_build_object(
    'hm_id', p_hm_id,

    -- Enough to head the page, and no more. No hm_code: a Coway identifier is
    -- an internal mapping key, and the HM reading this does not need it to
    -- recognise their own team.
    'hm', jsonb_build_object(
      'id',        hm.id,
      'name',      hm.name,
      'office',    hm.office,
      'photo_url', hm.photo_url,
      'status',    hm.status
    ),

    'month', jsonb_build_object(
      'id',      m.id,
      'year',    m.year,
      'month',   m.month,
      'label',   m.label,
      'quarter', m.quarter
    ),

    -- Active first, then by name - the order the page reads in, decided here so
    -- the client sorts nothing and cannot disagree with the counts below.
    --
    -- `is_active` is computed by the same expression the summary view counts
    -- with, so a row badged ACTIVE on this page is a row that contributed to
    -- the Active HP figure the reader clicked.
    -- Built key by key rather than with row_to_json, so the ordering column
    -- below stays an implementation detail instead of travelling to the browser
    -- as a field nothing reads.
    'hp', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'hp_name',      listed.hp_name,
                 'hp_code',      listed.hp_code,
                 'w1_key_in',    listed.w1_key_in,
                 'w2_key_in',    listed.w2_key_in,
                 'w3_key_in',    listed.w3_key_in,
                 'w4_key_in',    listed.w4_key_in,
                 'total_key_in', listed.total_key_in,
                 'total_net',    listed.total_net,
                 'is_active',    listed.is_active
               )
               order by listed.sort_active, listed.hp_name, listed.hp_code
             )
        from (
          select h.hp_name,
                 h.hp_code,
                 p.w1_key_in,
                 p.w2_key_in,
                 p.w3_key_in,
                 p.w4_key_in,
                 p.total_key_in,
                 p.total_net,
                 (p.total_key_in >= 1) as is_active,
                 case when p.total_key_in >= 1 then 0 else 1 end as sort_active
            from public.hp_monthly_performance p
            join public.hps h on h.id = p.hp_id
           where p.month_id = m.id
             and p.hm_id = p_hm_id
           order by sort_active, h.hp_name, h.hp_code
           limit 1000
        ) as listed
    ), '[]'::jsonb),

    -- The counts are taken over the WHOLE month rather than over the rows
    -- above, so a roster past the 1000-row ceiling still reports honestly
    -- instead of quietly counting the page.
    'hp_count', (
      select count(*)::int
        from public.hp_monthly_performance p
       where p.month_id = m.id and p.hm_id = p_hm_id
    ),

    'active_hp', (
      select count(*)::int
        from public.hp_monthly_performance p
       where p.month_id = m.id and p.hm_id = p_hm_id
         and p.total_key_in >= 1
    ),

    'last_updated_at', (
      select max(p.updated_at)
        from public.hp_monthly_performance p
       where p.month_id = m.id and p.hm_id = p_hm_id
    )
  ) into body;

  return body;
end;
$$;

comment on function public.resolve_share_hm_hp(text, uuid) is
  'Resolves a share token plus an HM id into that ONE HM''s HP rows for the token''s month, or NULL. The third and last function anon may execute. Carries no row id, no hm_id and no audit column, and is capped at 1000 rows.';

-- The third deliberate anonymous privilege in the schema. Same token, same
-- month, one HM.
revoke all on function public.resolve_share_hm_hp(text, uuid) from public;
grant execute on function public.resolve_share_hm_hp(text, uuid) to anon, authenticated;
