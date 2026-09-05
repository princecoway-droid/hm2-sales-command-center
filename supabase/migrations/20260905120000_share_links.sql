-- =============================================================================
-- HM2 Sales Command Center - Stage 6: read-only share links
-- -----------------------------------------------------------------------------
-- The first migration that deliberately lets an UNAUTHENTICATED visitor read
-- anything at all, so the boundary is drawn here rather than in the app.
--
--   authenticated PA/manager  ->  creates a share_links row for a month
--   the token                 ->  travels in a WhatsApp message
--   anonymous viewer          ->  public.resolve_share_report(token)
--
-- What anon gets is EXACTLY one function. There is no anon SELECT policy, no
-- anon table grant, and no view: `resolve_share_report` is SECURITY DEFINER, it
-- validates the token first, and it returns a hand-built jsonb projection of
-- one reporting month. Anon cannot reach `share_links` itself, so tokens cannot
-- be listed, and cannot reach any application table, so the projection is the
-- whole of the public surface.
--
-- Deliberately NOT in the projection: profiles, auth, created_by / updated_by,
-- the performance row ids, and anything belonging to a month other than the one
-- the token is bound to.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- share_links
--
-- A token is a capability, not an identifier: it names one reporting month and
-- carries the right to read that month's report. It is generated in the
-- application from 32 cryptographically random bytes (src/lib/share/token.ts),
-- and the CHECKs below are the database's own refusal to store anything that
-- could not have come from there - no uuid, no month id, no slug.
-- -----------------------------------------------------------------------------

create table if not exists public.share_links (
  id               uuid primary key default gen_random_uuid(),
  token            text        not null,
  month_id         uuid        not null references public.months (id) on delete cascade,
  created_by       uuid        references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz,
  revoked_at       timestamptz,
  is_active        boolean     not null default true,
  last_accessed_at timestamptz,

  constraint share_links_token_key    unique (token),
  -- 32 random bytes base64url-encode to 43 characters. The floor is what stops
  -- a short, guessable token ever reaching the table; the character class is
  -- what stops a uuid (dashes) or padded base64 being passed off as one.
  constraint share_links_token_length check (char_length(token) between 32 and 128),
  constraint share_links_token_shape  check (token ~ '^[A-Za-z0-9_-]+$'),
  -- A uuid clears both checks above - 36 characters, and its dashes are legal
  -- base64url - so it is refused by name. An internal identifier is not a
  -- capability, and "try the month id as a token" is the first thing anyone
  -- would try.
  constraint share_links_token_not_uuid
    check (token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  -- An expiry already in the past at the moment of creation is a link that
  -- never worked, which is a bug rather than a policy.
  constraint share_links_expiry_after_creation
    check (expires_at is null or expires_at > created_at),
  -- Revocation and the active flag are one decision, so they cannot disagree.
  constraint share_links_revocation_consistent
    check ((revoked_at is null) = is_active)
);

comment on table public.share_links is
  'Capability tokens for the unauthenticated read-only month report at /share/<token>. Never readable by anon; resolved only through public.resolve_share_report().';
comment on column public.share_links.token is
  'Cryptographically random, base64url. Never derived from month_id, an hm id or any other internal identifier.';
comment on column public.share_links.expires_at is
  'Optional. NULL means the link lives until it is revoked - the default the application ships with (src/lib/share/config.ts).';
comment on column public.share_links.last_accessed_at is
  'Coarse audit only, written at most once every five minutes by resolve_share_report().';

-- The token lookup is the hot path and the only path: one equality probe per
-- public page load, served by the unique constraint's own index. This second
-- index is for the authenticated side, which asks "is there already an active
-- link for this month" every time the PA opens the report panel.
create index if not exists share_links_month_active_idx
  on public.share_links (month_id, created_at desc)
  where is_active;

create index if not exists share_links_created_by_idx
  on public.share_links (created_by);

alter table public.share_links enable row level security;

-- -----------------------------------------------------------------------------
-- Creation and immutability
--
-- `created_by` is stamped from the JWT rather than trusted from the client, for
-- the same reason the audit trigger on the performance tables does it: an
-- author the client can choose is not an audit trail.
--
-- The update guard is the more important of the two. Without it a PA could
-- repoint an already-circulated token at a different reporting month - the one
-- edit that would turn a share link into a general database browser. Everything
-- but the revocation columns is therefore frozen after insert.
-- -----------------------------------------------------------------------------

create or replace function public.tg_share_links_set_created()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  new.created_by := coalesce((select auth.uid()), new.created_by);
  new.last_accessed_at := null;
  return new;
end;
$$;

comment on function public.tg_share_links_set_created() is
  'BEFORE INSERT trigger: stamps created_at and created_by from auth.uid().';

drop trigger if exists share_links_set_created on public.share_links;
create trigger share_links_set_created
  before insert on public.share_links
  for each row execute function public.tg_share_links_set_created();

create or replace function public.tg_share_links_freeze_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.token is distinct from old.token then
    raise exception 'A share link token cannot be changed'
      using errcode = '42501';
  end if;

  if new.month_id is distinct from old.month_id then
    raise exception 'A share link cannot be repointed at another reporting month'
      using errcode = '42501';
  end if;

  new.created_at := old.created_at;
  new.created_by := old.created_by;

  return new;
end;
$$;

comment on function public.tg_share_links_freeze_identity() is
  'BEFORE UPDATE trigger: a circulated token keeps its month. Only revocation, expiry and the access stamp may change.';

drop trigger if exists share_links_freeze_identity on public.share_links;
create trigger share_links_freeze_identity
  before update on public.share_links
  for each row execute function public.tg_share_links_freeze_identity();

-- -----------------------------------------------------------------------------
-- Grants and policies
--
-- anon gets nothing here. Managing links is staff work; revoking has to stay
-- available to whoever is holding the phone, so it is open to both roles rather
-- than manager-only. Deleting a link row destroys the record of a token that
-- was once circulated, so that stays with the manager - revoke is the ordinary
-- action, and it is what the UI offers.
-- -----------------------------------------------------------------------------

revoke all on table public.share_links from anon;
grant select, insert, update, delete on table public.share_links to authenticated;

drop policy if exists share_links_select_staff on public.share_links;
create policy share_links_select_staff
  on public.share_links for select
  to authenticated
  using (public.is_staff());

drop policy if exists share_links_insert_staff on public.share_links;
create policy share_links_insert_staff
  on public.share_links for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists share_links_update_staff on public.share_links;
create policy share_links_update_staff
  on public.share_links for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists share_links_delete_manager on public.share_links;
create policy share_links_delete_manager
  on public.share_links for delete
  to authenticated
  using (public.is_manager());

-- -----------------------------------------------------------------------------
-- resolve_share_report(token)
--
-- The entire public data surface of this application, in one function.
--
-- SECURITY DEFINER because an anonymous caller has, and must keep, no rights of
-- its own on any table. The function IS the grant: it decides that a valid,
-- active, unexpired token buys read access to one month's figures and nothing
-- else. It returns NULL for every failure - missing, malformed, revoked,
-- expired, or bound to a month that has since been deleted - so a caller cannot
-- tell one from another by probing.
--
-- What comes back is a projection, not rows. The performance records carry no
-- id, no created_by and no updated_by; nothing from `profiles` or `auth` is
-- reachable; and every sub-select is anchored to `link.month_id`, so a token
-- can only ever produce its own month.
--
-- The figures themselves are NOT calculated here. This returns records; the
-- Stage 3 engine turns them into the Key-In total, Achievement, Net Ratio, the
-- weekly bands and the ranking, exactly as it does for the signed-in dashboard.
-- That is what makes the shared report and the private one agree by
-- construction rather than by coincidence.
-- -----------------------------------------------------------------------------

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

    -- Read, never derived. Absent stays absent: NULL here becomes "Not entered"
    -- on the page, never an average of the HM SHI column.
    'group_shi_pct', (
      select g.shi_percentage
        from public.group_monthly_metrics g
       where g.month_id = m.id
    ),

    -- The data's own freshness, scoped to this month. GREATEST ignores NULLs,
    -- so a month holding only weekly Key-In still reports honestly.
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
    )
  ) into body;

  return body;
end;
$$;

comment on function public.resolve_share_report(text) is
  'Resolves a share token into one reporting month of public-safe records, or NULL. The only function anon may execute.';

-- The one deliberate anonymous privilege in the schema.
revoke all on function public.resolve_share_report(text) from public;
grant execute on function public.resolve_share_report(text) to anon, authenticated;
