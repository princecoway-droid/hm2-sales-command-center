-- =============================================================================
-- HM2 Sales Command Center - the per-HM view behind an existing share token
-- -----------------------------------------------------------------------------
-- Stage 6 gave `anon` exactly one function: `resolve_share_report`, which turns
-- a token into ONE reporting month of group figures. The share report shows a
-- card per HM, and the people reading it in the group chat want the rest of
-- that HM's month - the same figures the manager sees at /hm/<id>.
--
-- This adds the second, and only other, function `anon` may execute:
--
--   /share/<token>            ->  resolve_share_report(token)
--   /share/<token>/hm/<hmId>  ->  resolve_share_hm_report(token, hmId)
--
-- `resolve_share_report` is NOT touched. The group report keeps the payload it
-- has always had, so nothing about the link already circulating in WhatsApp
-- changes - not its content, not its cost, not its shape.
--
-- -----------------------------------------------------------------------------
-- What the second function widens, and what it deliberately does not
-- -----------------------------------------------------------------------------
-- The same token, the same month, the same gate. Two differences, both narrow:
--
--   the HM must belong to the month   the id has to be one the group report
--                                     could already have shown - active, or
--                                     holding figures for the token's month.
--                                     Anything else is NULL, so a token is not
--                                     a way to enumerate the HM table.
--
--   ONE HM's rows for context months  month over month and QTD need the
--                                     previous month and the rest of the
--                                     quarter. Only the REQUESTED HM's monthly
--                                     rows come back for those months - never
--                                     the roster's, never their weekly Key-In,
--                                     never another month's group figures. The
--                                     token still cannot produce a second group
--                                     report.
--
-- Still absent, exactly as before: profiles, auth, created_by / updated_by,
-- performance row ids, and any month outside this one's quarter or the month
-- immediately before it.
--
-- The figures are not calculated here either. This returns records; the Stage 3
-- engine and the HM detail presenter turn them into Achievement, Net Ratio, the
-- weekly bands, the Extrade split, the month-over-month change and the quarter
-- - the same code the signed-in HM screen runs, which is what makes the public
-- HM view and the private one agree by construction rather than by testing.
-- =============================================================================

create or replace function public.resolve_share_hm_report(
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
  body jsonb;
begin
  -- Shape first, so a probe carrying a uuid, an empty string or a month id
  -- never reaches the index at all. Identical to `resolve_share_report`: the
  -- two doors are the same door.
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
  -- figures for the token's own month. That is the same rule the `hms`
  -- projection in `resolve_share_report` applies, so this function can only
  -- open a card the group report already showed - and an id that was never on
  -- it is answered with NULL rather than with an empty profile.
  if not exists (
       select 1
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
                  ))
     ) then
    return null;
  end if;

  -- Coarse audit, throttled exactly as the group report's is. Opening an HM
  -- from the report is an access of the same link, so it counts as one.
  update public.share_links
     set last_accessed_at = now()
   where id = link.id
     and (last_accessed_at is null
          or last_accessed_at < now() - interval '5 minutes');

  select jsonb_build_object(
    'hm_id', p_hm_id,

    'month', jsonb_build_object(
      'id',         m.id,
      'year',       m.year,
      'month',      m.month,
      'label',      m.label,
      'quarter',    m.quarter,
      'created_at', m.created_at
    ),

    'weeks', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id',          w.id,
                 'month_id',    w.month_id,
                 'week_number', w.week_number,
                 'week_label',  w.week_label,
                 'start_date',  w.start_date,
                 'end_date',    w.end_date,
                 'created_at',  w.created_at
               )
               order by w.week_number
             )
        from public.sales_weeks w
       where w.month_id = m.id
    ), '[]'::jsonb),

    -- The whole roster the month covers, unchanged from the group report: the
    -- HM screen states a rank ("Rank 3 of 12"), and a rank cannot be worked out
    -- from one person. This is the same set the token already returns.
    'hms', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id',            h.id,
                 'name',          h.name,
                 'office',        h.office,
                 'photo_url',     h.photo_url,
                 'status',        h.status,
                 'display_order', h.display_order,
                 'created_at',    h.created_at,
                 'updated_at',    h.updated_at
               )
               order by h.display_order, h.name
             )
        from public.hms h
       where h.status = 'active'
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
             )
    ), '[]'::jsonb),

    -- No id, no created_by, no updated_by, no timestamps: the figures only.
    'monthly', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'hm_id',             p.hm_id,
                 'month_id',          p.month_id,
                 'net_units',         p.net_units,
                 'target_net_units',  p.target_net_units,
                 'recruitment',       p.recruitment,
                 'active_hp',         p.active_hp,
                 'shi_percentage',    p.shi_percentage,
                 'extrade_units',     p.extrade_units,
                 'non_extrade_units', p.non_extrade_units
               )
             )
        from public.hm_monthly_performance p
       where p.month_id = m.id
    ), '[]'::jsonb),

    'weekly', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'hm_id',       k.hm_id,
                 'week_id',     k.week_id,
                 'keyin_units', k.keyin_units
               )
             )
        from public.hm_weekly_performance k
        join public.sales_weeks w on w.id = k.week_id
       where w.month_id = m.id
    ), '[]'::jsonb),

    -- Read, never derived. Absent stays absent.
    'group_shi_pct', (
      select g.shi_percentage
        from public.group_monthly_metrics g
       where g.month_id = m.id
    ),

    'last_updated_at', greatest(
      (select max(p.updated_at)
         from public.hm_monthly_performance p
        where p.month_id = m.id),
      (select max(k.updated_at)
         from public.hm_weekly_performance k
         join public.sales_weeks w on w.id = k.week_id
        where w.month_id = m.id),
      (select g.updated_at
         from public.group_monthly_metrics g
        where g.month_id = m.id)
    ),

    -- ------------------------------------------------------------------------
    -- Context months: the previous calendar month and the earlier months of the
    -- quarter, carrying ONLY this HM's monthly figures.
    --
    -- This is the whole reason the function exists. Without them the public HM
    -- view would have to show "no previous month" and a quarter of one month,
    -- which is not what the manager's screen shows - and a public report that
    -- quietly disagrees with the private one is the one failure this feature
    -- cannot have, because the disagreement is visible to the whole group chat
    -- before it is visible to anybody who could fix it.
    --
    -- Deliberately NOT included: other HMs' rows, weekly Key-In, sales weeks
    -- and group SHI. A context month is enough to compare against and to total,
    -- and nothing more - it can never be assembled into a second group report.
    --
    -- Later months of the quarter are excluded by the `<` rather than trimmed
    -- afterwards: on 4 September there is no October, and an empty one would
    -- drag the quarter down. A month of the quarter that was never opened is
    -- simply absent, which is how the QTD model comes to NAME it as missing
    -- instead of summing a zero over it.
    -- ------------------------------------------------------------------------
    'context', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'month', jsonb_build_object(
                   'id',         cm.id,
                   'year',       cm.year,
                   'month',      cm.month,
                   'label',      cm.label,
                   'quarter',    cm.quarter,
                   'created_at', cm.created_at
                 ),
                 'monthly', coalesce((
                   select jsonb_agg(
                            jsonb_build_object(
                              'hm_id',             p.hm_id,
                              'month_id',          p.month_id,
                              'net_units',         p.net_units,
                              'target_net_units',  p.target_net_units,
                              'recruitment',       p.recruitment,
                              'active_hp',         p.active_hp,
                              'shi_percentage',    p.shi_percentage,
                              'extrade_units',     p.extrade_units,
                              'non_extrade_units', p.non_extrade_units
                            )
                          )
                     from public.hm_monthly_performance p
                    where p.month_id = cm.id
                      and p.hm_id = p_hm_id
                 ), '[]'::jsonb)
               )
               order by cm.year, cm.month
             )
        from public.months cm
       where cm.id <> m.id
         and (
              -- the immediately previous calendar month, year rollover included
              (cm.year = case when m.month = 1 then m.year - 1 else m.year end
               and cm.month = case when m.month = 1 then 12 else m.month - 1 end)
              -- or an earlier month of the same quarter, never a later one
              or (cm.year = m.year
                  and cm.month >= ((m.month - 1) / 3) * 3 + 1
                  and cm.month < m.month)
             )
    ), '[]'::jsonb)
  ) into body;

  return body;
end;
$$;

comment on function public.resolve_share_hm_report(text, uuid) is
  'Resolves a share token plus an HM id into that HM month: the token month in full, plus that one HM figures for the previous month and the quarter to date, or NULL. The second and last function anon may execute.';

-- The second deliberate anonymous privilege in the schema. Same token, same
-- month, one HM.
revoke all on function public.resolve_share_hm_report(text, uuid) from public;
grant execute on function public.resolve_share_hm_report(text, uuid) to anon, authenticated;
