-- =============================================================================
-- HM2 Sales Command Center - Stage 8: the shared report's Active HP, derived
-- -----------------------------------------------------------------------------
-- Stage 8 moves Active HP from a figure the PA keys in to a figure counted from
-- the imported HP rows. The signed-in dashboard reads it from
-- `hm_monthly_hp_summary`; the public report reads whatever
-- `resolve_share_report` puts in its payload.
--
-- If only one of those changed, the report pasted into the group chat would
-- show a different Active HP from the dashboard it was generated from. That is
-- the one failure this feature cannot have - the disagreement is visible to
-- everybody in the chat before it is visible to anybody who could fix it - so
-- both functions are replaced here, in the same migration, with the same
-- definition of the figure.
--
-- -----------------------------------------------------------------------------
-- What crosses the boundary, and what does not
-- -----------------------------------------------------------------------------
-- A COUNT per HM. Not one HP record, not a name, not a code:
--
--   { "hm_id": ..., "hp_count": 12, "active_hp": 9 }
--
-- `active_hp` is what the page shows and was already in this payload before
-- Stage 8; only its source changed. `hp_count` is there for the one distinction
-- the number alone cannot carry: an HM with HP rows and none of them active has
-- Active HP 0, while an HM with no HP rows at all has no figure - blank, not
-- zero. Without the count the public page would print "0" for a month nobody
-- has imported yet.
--
-- Everything else about both functions is unchanged, including the token gate,
-- the throttled access stamp, the month anchoring and the absence of ids and
-- audit columns. The only other addition is `hp_monthly_performance.updated_at`
-- in the freshness stamp, so an import that changes what the page shows also
-- changes when the page says it was updated.
-- =============================================================================

create or replace function public.resolve_share_report(p_token text)
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
  -- never reaches the index at all.
  if p_token is null
     or char_length(p_token) < 32
     or char_length(p_token) > 128
     or p_token !~ '^[A-Za-z0-9_-]+$'
     -- A uuid passes both of the above. Refused here as well, so a probe
     -- carrying a month id or an hm id is answered without a lookup.
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

  -- Coarse audit. A link pasted into a group chat is opened by everybody at
  -- once; throttling to five minutes keeps "when was this last looked at"
  -- answerable without turning every page view into a write.
  update public.share_links
     set last_accessed_at = now()
   where id = link.id
     and (last_accessed_at is null
          or last_accessed_at < now() - interval '5 minutes');

  select jsonb_build_object(
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

    -- Narrowed to the people this month can be about: everyone currently
    -- active, plus anyone inactive who has figures for it. That mirrors
    -- `selectHmsForMonth`, but only as a data-minimisation boundary - the
    -- engine still decides who the totals cover. Widen this alongside that rule
    -- if it ever changes.
    'hms', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id',            h.id,
                 'name',          h.name,
                 'hm_code',       h.hm_code,
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
    --
    -- `active_hp` is still projected so a client written against the pre-Stage-8
    -- payload keeps parsing, but nothing reads it any more: the figure the page
    -- shows comes from 'hp_active' below.
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

    -- Active HP, derived. An aggregate per HM and nothing else: no HP name, no
    -- HP code, no HP row ever leaves the database through a share token.
    'hp_active', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'hm_id',     x.hm_id,
                 'hp_count',  x.hp_count,
                 'active_hp', x.active_hp
               )
             )
        from (
          select p.hm_id,
                 count(*)::int                                    as hp_count,
                 count(*) filter (where p.total_key_in >= 1)::int  as active_hp
            from public.hp_monthly_performance p
           where p.month_id = m.id
           group by p.hm_id
        ) as x
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

    -- Read, never derived. Absent stays absent: NULL here becomes "Not entered"
    -- on the page, never an average of the HM SHI column.
    'group_shi_pct', (
      select g.shi_percentage
        from public.group_monthly_metrics g
       where g.month_id = m.id
    ),

    -- The data's own freshness, scoped to this month. GREATEST ignores NULLs,
    -- so a month holding only weekly Key-In still reports honestly. An HP
    -- import changes what this page shows, so it counts here too.
    'last_updated_at', greatest(
      (select max(p.updated_at)
         from public.hm_monthly_performance p
        where p.month_id = m.id),
      (select max(k.updated_at)
         from public.hm_weekly_performance k
         join public.sales_weeks w on w.id = k.week_id
        where w.month_id = m.id),
      (select max(hp.updated_at)
         from public.hp_monthly_performance hp
        where hp.month_id = m.id),
      (select g.updated_at
         from public.group_monthly_metrics g
        where g.month_id = m.id)
    )
  ) into body;

  return body;
end;
$$;

comment on function public.resolve_share_report(text) is
  'Resolves a share token into one reporting month of public-safe records, or NULL. Active HP arrives as an aggregate count per HM (hp_active), never as HP records. One of the two functions anon may execute.';

revoke all on function public.resolve_share_report(text) from public;
grant execute on function public.resolve_share_report(text) to anon, authenticated;


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
                 'hm_code',       h.hm_code,
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

    -- Active HP for the token's month: a count per HM, nothing else.
    'hp_active', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'hm_id',     x.hm_id,
                 'hp_count',  x.hp_count,
                 'active_hp', x.active_hp
               )
             )
        from (
          select p.hm_id,
                 count(*)::int                                    as hp_count,
                 count(*) filter (where p.total_key_in >= 1)::int  as active_hp
            from public.hp_monthly_performance p
           where p.month_id = m.id
           group by p.hm_id
        ) as x
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
      (select max(hp.updated_at)
         from public.hp_monthly_performance hp
        where hp.month_id = m.id),
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
    -- The HP aggregate is narrowed the same way: this HM's count, and nobody
    -- else's.
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
                 ), '[]'::jsonb),
                 'hp_active', coalesce((
                   select jsonb_agg(
                            jsonb_build_object(
                              'hm_id',     x.hm_id,
                              'hp_count',  x.hp_count,
                              'active_hp', x.active_hp
                            )
                          )
                     from (
                       select p.hm_id,
                              count(*)::int                                    as hp_count,
                              count(*) filter (where p.total_key_in >= 1)::int  as active_hp
                         from public.hp_monthly_performance p
                        where p.month_id = cm.id
                          and p.hm_id = p_hm_id
                        group by p.hm_id
                     ) as x
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
  'Resolves a share token plus an HM id into that HM month: the token month in full, plus that one HM figures for the previous month and the quarter to date, or NULL. Active HP is an aggregate count, never HP records. The second and last function anon may execute.';

revoke all on function public.resolve_share_hm_report(text, uuid) from public;
grant execute on function public.resolve_share_hm_report(text, uuid) to anon, authenticated;
