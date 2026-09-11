# HM2 Sales Command Center

Internal sales-performance dashboard for the Coway HM2 management team.

**Stage 1** built the foundation: database schema, Row Level Security,
authentication, validation and an authenticated shell.

**Stage 2** is the operational half — everything the PA touches: the HM master
list with photos, reporting months, Coway's weekly sales calendar, and a
spreadsheet-style data-entry grid that saves a whole month in one operation.

**Stage 3** is the calculation and aggregation engine: one source of truth for
every KPI, from the weekly Key-In status colours up to group totals, ranking,
quarter-to-date and month-over-month.

**Stage 4** is the management dashboard: the group KPI cards, the weekly Key-In
chart, the HM performance cards, the month selector and the empty, loading and
error states. It contains no formula of its own — every figure on screen comes
from the Stage 3 models, and a presenter layer decides only which figure goes
on which card and how it reads.

**Stage 5** is the individual HM screen at `/hm/<id>`, reached by clicking any HM
card, and a mobile pass over it. Same rule: no formulas in the UI. It reads the
HM out of the *same* month model the dashboard is built from, so an HM's Net on
their own page and on their dashboard card cannot disagree — they are the same
object.

**Stage 6** is how a month leaves the building: the WhatsApp report the PA
copies into the group, and the read-only page at `/share/<token>` that anyone
holding the link can open without an account. The public report is a
*projection* of the dashboard's own view model, so the two cannot disagree about
a figure.

**Stage 7** is the V1 hardening pass — no new features. HTTP security headers,
the sales-week cascade closed at the database as well as in the action layer,
and the deployment, backup and abuse notes below.

**Stage 8 (this build)** makes the PA's Excel the input. They keep the
spreadsheet they already maintain, upload it at `/hp-import`, and HP-level
performance — W1–W4 Key-In, Total Key-In and the month's Total Net — lands
against the right HM by **HM Code**. Active HP stops being a figure anybody
types and becomes a count of those rows, so the number on the dashboard and the
list behind it are the same fact. `/hp` is that list.

---

## Stack

| | |
|---|---|
| Framework | Next.js 16 (App Router, React 19, Turbopack) |
| Language | TypeScript, strict |
| Styling | Tailwind CSS v4 |
| Backend | Supabase — Postgres 17, Auth, Storage, RLS |
| Validation | Zod v4 |

---

## Setup

### 1. Install

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Fill in from **Supabase Dashboard → Project Settings → API**:

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Safe in the browser; RLS constrains it |
| `NEXT_PUBLIC_APP_URL` | **in production** | The app's own address, used to build share links. Leave blank locally |
| `SUPABASE_SERVICE_ROLE_KEY` | no | **Bypasses RLS.** Server-only, and unused — leave it unset |
| `SUPABASE_PROJECT_ID` | no | Only for `db:types:remote` |

`.env.local` is git-ignored. Without it the app still runs and every route
redirects to `/login`, which explains what is missing.

#### `NEXT_PUBLIC_APP_URL`

Set this in production. It is the origin every share link is built against, and
a share link is the one URL this app produces that has to work somewhere else —
pasted into WhatsApp and opened on a phone, possibly on another network.

```
NEXT_PUBLIC_APP_URL=https://your-production-domain
```

The value is an **origin**: scheme and host, `http` or `https`, optionally a
port and a base path. Nothing else. A trailing slash is fine —
`https://example.com/` and `https://example.com` both produce
`https://example.com/share/<token>`, never `//share/<token>` — and a query
string or fragment left on the end is dropped rather than prepended to every
link. A value that is not a usable `http(s)` origin is ignored with a warning in
the server log, and the request host is used instead.

Leave it **blank in development**. The origin is then taken from the request's
own `Host`, honouring `X-Forwarded-Host` / `X-Forwarded-Proto`, so `npm run dev`
produces `http://localhost:3000/share/<token>` and a tunnel or preview
deployment produces its own address without configuration.

The reason to set it in production anyway: the configured value is the only
source a forwarded header cannot influence. It always wins over the request, so
a proxy — or anyone able to set `X-Forwarded-Host` — cannot change which origin
a generated link points at. The rules live in `src/lib/share/url.ts`, which is
pure and covered by `npm run test:stage6`.

There is no default and no fallback domain. This project deliberately ships
without a production URL: it is a deployment decision, made once, in the host's
environment settings.

### 3. Apply the database schema

Against a **hosted** project:

```bash
npx supabase link --project-ref <your-project-ref>
npm run db:push
```

Or against a **local** stack (needs Docker):

```bash
npm run db:start
npm run db:reset
```

`db:reset` also runs `supabase/seed.sql`, which adds four clearly fictional
sample HMs and the current year's reporting months. It never runs against a
hosted project.

### 4. Create the first user

There is no self-serve signup — accounts are provisioned by an administrator.

**Supabase Dashboard → Authentication → Users → Add user**, then set the user
metadata:

```json
{ "full_name": "Your Name", "role": "manager" }
```

A trigger on `auth.users` creates the matching `public.profiles` row
automatically. Without a `role` in the metadata the user gets `pa`, the
least-privileged option.

### 5. Run

```bash
npm run dev
```

---

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test:unit` | Stage 1 validation and business-rule tests |
| `npm run test:stage2` | Calculation primitives, grid model, calendar and data-entry schemas |
| `npm run test:stage3` | KPI engine: HM and group models, QTD, MoM, ranking, completeness |
| `npm run test:stage4` | Dashboard: month resolution, KPI/chart/card rendering, states |
| `npm run test:stage5` | HM detail: one HM's month, and that it matches the dashboard |
| `npm run test:stage6` | WhatsApp report, share tokens, the public projection |
| `npm run test:stage8` | HP Excel import, Active HP, the HP listing, and the import against a real Postgres |
| `npm run test:stage9` | KPI status thresholds, the current-week resolution, and Management Attention |
| `npm run db:test` | Schema, constraint, trigger and RLS tests (no Docker) |
| `npm test` | Every suite |
| `npm run check` | typecheck → lint → tests → build |
| `npm run db:start` / `db:stop` / `db:status` | Local Supabase stack |
| `npm run db:reset` | Rebuild the local database from migrations + seed |
| `npm run db:push` | Apply pending migrations to the linked project |
| `npm run db:diff -- <name>` | Generate a migration from local changes |
| `npm run db:types` / `db:types:remote` | Regenerate `src/types/database.ts` |

`db:test` applies every migration to a throwaway Postgres 17 compiled to
WebAssembly and asserts the rules hold. It needs no Docker and no credentials,
so it is safe to run in CI on every change to `supabase/migrations`.

---

## Data model

```
auth.users ──1:1──> profiles          manager | pa. HMs and HPs are NOT accounts.

hms             hm_code unique        HM master list (name, HM CODE, office, photo, status, order)
months          (year, month) unique  quarter + label derived by trigger
  └── sales_weeks                     Coway's OFFICIAL weekly periods, per month

hm_monthly_performance   (hm_id, month_id) unique
hm_weekly_performance    (hm_id, week_id)  unique
group_monthly_metrics    (month_id)        unique

hps             hp_code unique        HP master list (HP CODE, name, current HM)
hp_monthly_performance   (month_id, hp_id) unique   W1-W4, Total Key-In, Total Net
hp_import_runs                        one row per successful Excel import

views (security_invoker, so RLS applies to the caller)
  hm_monthly_hp_summary               Active HP per HM per month - the ONLY source
  hp_monthly_report                   one HP row with HP + HM identities joined
```

**HM Code is the mapping key.** The Excel import matches every HP row to an HM
on `hms.hm_code`, never on the name: names change, names are spelled three ways
in three exports, and two Health Managers can legitimately share one. Both codes
are uppercased and trimmed by a trigger, so `hm10321`, ` HM10321 ` and `HM10321`
are one code however the PA typed it that morning.

### Rules the database enforces

- **Extrade and Non-Extrade are independent keyed figures.** Neither is a share
  of Net. They are not required to sum to Net Units, to Total Key-In, or to each
  other — the PA enters each one as it appears on its own Coway report. The
  percentages are *computed for display* against **Total Key-In**, never stored.
  (Both columns are still natural numbers: a negative split is refused.)
- **SHI is keyed in, never calculated.** HM SHI comes from Coway eTrust. Group
  SHI is entered separately, also from eTrust, and is *never* an average of HM
  SHI values.
- **Monthly Key-In is not a column.** It is always `SUM(weekly keyin_units)`, so
  the monthly and weekly figures cannot drift apart.
- **An HP's Total Key-In is `W1 + W2 + W3 + W4`,** enforced by a CHECK. The
  spreadsheet carries its own TOTAL KEY-IN column and the import cross-checks
  against it, but the figure that gets *stored* is always the calculated one.
- **Active HP is counted, never keyed.** `COUNT` of that HM's HP rows for the
  month whose Total Key-In is at least 1. `hm_monthly_performance.active_hp` is
  retained holding pre-Stage-8 figures and is marked **deprecated**; nothing
  reads it and nothing writes it.
- **`total_net` is the MONTH's Net.** Not lifetime, not accumulated across
  months, and not required to equal Total Key-In, Extrade or Non-Extrade.
- **Sales weeks are not calendar weeks.** No 1–7 / 8–14 assumption anywhere; a
  month may have four, five or more periods, of any length.
- **Quarter is derived**, not typed in: Jan–Mar Q1, Apr–Jun Q2, Jul–Sep Q3,
  Oct–Dec Q4.
- Counts cannot be negative; percentages sit in 0–100; every uniqueness rule
  above is a real constraint.

Group totals — Key-In, Net, Recruitment, Active HP, Target, Achievement, Net
Ratio — are deliberately **not** stored. They are calculated from HM and week
rows, so there is nothing to keep in sync.

### Partial data entry

Half-filled forms never reach the database: drafts live in React state and are
validated with the draft schemas, which allow missing fields while still
catching out-of-range numbers. Only the complete shape is allowed to reach the
database.

There is no cross-field rule left on a grid row — every rule is a per-cell range
rule — so a row that is valid while being typed is valid to save, and a PA who
types Net before the Extrade breakdown is not fighting an error the whole way.
The `Balance` column states how much of the Key-In total the split covers; it is
a running difference shown for information, and any value in it saves.

### Blank is not zero

A blank weekly Key-In cell means *not entered yet*; `0` means *entered, and the
answer is zero*. The two are stored differently — blank writes no row, zero
writes one — which is what lets the completeness indicator tell a quiet week
from an unvisited one, and what stops a blank week being coloured red.

Grid cells therefore hold the text the PA typed rather than a parsed number.
That is one source of truth instead of two: `72.` can be typed on the way to
`72.5`, and a pasted `-5` becomes a visible "cannot be negative" instead of
silently disappearing the way a `type="number"` input would swallow it.

### Overlapping sales weeks

Stage 2 adds one migration: a **deferred** constraint trigger that refuses a
commit leaving two sales weeks of a month covering the same day. Deferred, not
an `EXCLUDE` constraint, because shifting W2–W5 forward by a day means the first
`UPDATE` momentarily overlaps its neighbour — a legitimate mid-edit state. The
calendar editor saves every week in one statement, so the whole reshuffle is
judged at `COMMIT`, as a set.

---

## Calculation engine

Every derived number in the application has exactly one definition, and it lives
in `src/lib/calculations/`. Import it from the barrel:

```ts
import { calculateGroupMonthlyPerformance } from "@/lib/calculations";
```

```
DATABASE  ->  lib/data  ->  lib/calculations  ->  lib/view-models  ->  UI
              fetching      pure functions       assembly            (later stages)
```

Nothing in `lib/calculations/` touches Supabase, React or the clock: typed input
in, typed output out. Fetching is `lib/data/`; combining a month's records into
dashboard-ready models is `lib/view-models/monthly-performance.ts`. A dashboard
card, a chart, the ranking, the WhatsApp report and a future mobile view all
read the same models — none of them recompute a percentage.

The data-entry grid imports the primitives it needs directly from
`lib/calculations/performance` rather than through the barrel, so a client
component does not pull the whole engine into its bundle. Same definitions,
narrower import.

### Business definitions

All sales figures are **units**. No RM anywhere in V1 KPIs.

| Metric | Rule |
|---|---|
| **Total Key-In** | `SUM` of the HM's entered weekly Key-In. Never a stored column. |
| **Net** | The monthly Net Units entered for the HM. |
| **Target** | That month's Net Target Units. Historical targets stay with their month. |
| **Achievement %** | `Net / Target × 100` |
| **Net Ratio %** | `Net / Total Key-In × 100` |
| **Recruitment** | New recruitment for that month only. Never cumulative, never carried forward. |
| **HP Total Key-In** | `W1 + W2 + W3 + W4` for one HP, one month. A blank weekly cell is 0 *for this dataset only* — the spreadsheet is a complete record of the month. |
| **HP Total Net** | That HP's Net for the **current month**. Never lifetime, never cumulative. The historical spreadsheet heading "Accumulated Net" is read as this and the PA is warned. |
| **Active HP** | HPs whose Total Key-In for the month is **>= 1**, counted from the imported HP rows. `null` — blank, never 0 — when no HP file has been imported for that HM and month. |
| **SHI** | Keyed in from eTrust. **Never** calculated, never derived from other KPIs. |
| **Extrade %** | `Extrade / Total Key-In × 100`. The denominator is **never** Net. |
| **Non-Extrade %** | `Non-Extrade / Total Key-In × 100`. Same denominator. |
| **Split balance** | `Extrade + Non-Extrade − Total Key-In`. Informational: the two figures are independent inputs and the shares do not have to add to 100%. |

Group figures sum the HM figures — Key-In, Net, Target, Recruitment, Active HP,
Extrade, Non-Extrade — and every group percentage is calculated **from those
totals**, never by averaging HM percentages. Group Active HP is therefore the
sum of the per-HM counts, which is the sum of the HP rows underneath them: one
chain, from a spreadsheet cell to the number on the dashboard. The mean of four achievement
percentages silently weights a 20-unit target the same as a 200-unit one.

Two balance functions exist and both are kept deliberately.
`extradeRemainder(totalKeyIn, extrade, nonExtrade)` answers the data-entry
question ("how much of Key-In is not in the split?") and is what the grid's
Balance column has always shown; `splitBalance()` is its negation and carries
the reporting sign convention above. Changing the sign of the first would flip a
colour on a screen that already works. Neither is a rule: no save, anywhere,
depends on either value.

### KPI status: a pacing indicator, not a forecast

`src/lib/calculations/kpi-status.ts` bands four already-calculated figures
against thresholds the business supplied. It answers *"at this point in the
month, is this figure healthy?"* and nothing else — there is no forecast, no
probability, no incentive projection, and deliberately **no combined score**.

Three bands, and only three:

| Status | Shown as |
|---|---|
| `needs_attention` | 🔴 Needs Attention |
| `watch` | 🟡 Watch |
| `on_track` | 🟢 On Track |

**Key-In** is banded on the month **so far** — the running total of W1 through
the week being banded — as a share of the HM's **monthly** target. Never a
weekly target, which the business does not set, and never one week's own figure:

| Week | Needs Attention | Watch | On Track |
|---|---|---|---|
| W1 | `<= 15%` | `> 15%` and `<= 25%` | `> 25%` |
| W2 | `< 30%` | `>= 30%` and `< 50%` | `>= 50%` |
| W3 | `< 45%` | `>= 45%` and `< 75%` | `>= 75%` |
| W4 | `< 60%` | `>= 60%` and `< 100%` | `>= 100%` |
| W5, W6 | — | — | — |

These are a **pace curve**, and the numerator is cumulative. The thresholds say
so themselves: On Track at W4 is 100% of the *monthly* target, and no HM sells a
month's target inside week four — banding each week's own figure makes that edge
unreachable by construction and paints a healthy team red. Read cumulatively,
15/25 → 30/50 → 45/75 → 60/100 is roughly a quarter of the target per week with
a widening allowance for a slow start.

So an HM on 20 units in W1 and 27 in W2, against a target of 100, is banded at
W2 on **47** (47%, Watch) — not on 27 (27%, Needs Attention).

W1 is the one week stated with **strict** comparisons: 15% is red and 25% is
amber. W5 and W6 have **no defined threshold** and get none — the figures stay
visible and the status reads "Not configured".

A blank week contributes nothing rather than zero, so a month missing W2 carries
W1's total into W3. Where the running total is missing an earlier week the note
says so (`· 1 earlier week not entered`): a red caused by an unkeyed W1 is a gap
in the records, not a verdict on the HM.

| Metric | Needs Attention | Watch | On Track |
|---|---|---|---|
| **Recruitment** | `0–2` | `3–4` | `>= 5` |
| **Net ratio** (`Net / Total Key-In`) | `< 50%` | `>= 50%` and `< 75%` | `>= 75%` |
| **Active HP** (Stage 8 HP-derived) | `< 10` | `10–20` | `> 20` |

Active HP is the only band whose upper edge is exclusive: 20 is Watch, 21 is On
Track. The recruitment bands here are **not** the Stage 2 colour bands
(`recruitmentStatus`, `>= 3` green) that the data-entry grid, the WhatsApp
report and the shared report still use — two different questions, two different
sets of numbers, kept apart rather than reconciled.

A status of `null` is *not* a fourth band. It means no band can be stated, for
one of three honest reasons: the figure has not been keyed in, the denominator
is missing or zero, or the week has no defined threshold. None is rendered as a
red. The only exception is the business's own instruction for Net: an HM with
Net entered and **nothing keyed in** has an undefined ratio and is reported as
Needs Attention, with the ratio itself still shown as `—`.

**The current week** comes from `resolveCurrentWeek(weeks, today)`, which reads
the configured `sales_weeks` rows and never does calendar arithmetic — Coway
weeks are not calendar weeks, and September's W1 routinely opens in August.
Today inside a period is that week; past every period (any historical month) is
the last one that ended; before them all is W1. `today` is an ISO date in
`Asia/Kuala_Lumpur`, produced by `reportingDate()` and passed in, so the engine
keeps its no-clock rule and a test can stand in the middle of any month.

Statuses are calculated once per month in
`buildMonthlyPerformanceViewModel` and read from there by the dashboard card,
the HM screen and the Management Attention list — the same object, so the three
cannot disagree. **Management Attention** lists only HMs with at least one
`needs_attention` KPI, most reds first with the month's ranking as the
tie-break, and names the affected KPIs and nothing more. Nothing is stored: the
bands are derived at render time from data already loaded, and no query was
added for them.

The shared report is **not** extended by any of this. A token holder sees the
same figures they always saw, with no bands attached.

### Group SHI is read, never derived

Group SHI comes straight from `group_monthly_metrics.shi_percentage`, an
independent eTrust figure. It is **never** `AVG(HM SHI)`, weighted or otherwise,
and when the record is missing `groupShiPct` is `null` — it does not fall back
to an HM average. HM SHI values of 50 and 90 with a group figure of 72 must
report 72, not 70.

Only the *selected* month carries a group SHI. The previous month and the
quarter months in a bundle are calculated with `null`, because their own eTrust
value was not fetched and inventing one would be worse than having none.

### Null vs zero

`0` is an entered zero. `null` is *not entered*. Nothing in the engine converts
one into the other, in either direction.

Because every numeric column on `hm_monthly_performance` and
`hm_weekly_performance` is `NOT NULL DEFAULT 0`, a saved row cannot express
"blank" — the only place that survives is the **existence of the row**:

| Storage | Model |
|---|---|
| no monthly row for (hm, month) | every monthly figure is `null` |
| a monthly row exists | the numbers it holds; a `0` there is a real zero |
| no weekly row for (hm, week) | that week is `null`, blank, status `neutral` |
| a weekly row exists | its Key-In; `0` is an entered zero week, status `red` |

That single conversion — a missing row read as 0 — is what would turn "September
has not been keyed in" into "September was a total failure".

### Metrics that cannot be calculated

A metric with a zero or missing denominator is `number | null`, and `null` means
*unknown*. Never `NaN`, never `Infinity`, and never a magic value like `-1`:

- Target `0` → `achievementPct` is `null`. An HM with no target has an unknown
  achievement, not a 0% one, and the difference shows the moment it is ranked.
- Total Key-In `0` → `netRatioPct` is `null`.
- Total Key-In `0` → `extradePct` and `nonExtradePct` are `null`. A UI wanting a
  zero-state can check `extradeUnits === 0 && nonExtradeUnits === 0` itself;
  that is a presentation decision.
- Previous month Net `0` → `percentageChange` is `null`, but `differenceUnits`
  is kept: the unit change is still real.

Internal figures keep full precision. Rounding happens once, at the edge, in
`formatPercentage()` — one decimal by default. Unit counts are never rounded.

### Status thresholds

Locked. `neutral` is not a fourth band — it means no figure has been entered,
and colouring a blank week red would report an HM as failing at something nobody
has keyed in.

| Status | Weekly Key-In | Recruitment |
|---|---|---|
| green | `> 15` | `>= 3` |
| yellow | `10–15` | `1–2` |
| red | `< 10` | `0` |
| neutral | blank | blank |

The boundaries that get misremembered: **15 is yellow, 16 is green** (not
`>= 15`), and **3 is green, 2 is yellow**.

### Month over month

Compares group Net against the **immediately previous calendar month** —
September 2026 against August 2026, January 2027 against December 2026. Not the
previous quarter, not the previous year. Also available per HM.

A previous month can be in one of three states, and collapsing any two of them
would mislead:

| State | Result |
|---|---|
| exists with data | everything populated |
| exists, nothing keyed in | `hasPreviousMonthData: false` — an opened month is not a zero month |
| not in the database | `hasPreviousMonthData: false`, both derived figures `null` |
| previous Net is a real `0` | `differenceUnits` kept, `percentageChange` `null` |

At HM level the *current* month can be missing too. An HM with no row this month
has not sold zero — nobody has keyed them in — so `hasCurrentMonthData` is
false and no difference is reported in either direction. Group totals always
have current data in this sense: a sum of nothing is a real `0`.

### Quarter to date

Reporting months, never calendar days — a Coway sales week routinely starts in
the previous calendar month, so a day-based cut would slice a week in half.
QTD runs from the first month of the quarter **through** the selected month, and
never includes future months:

```
September 2026  ->  Jul + Aug + Sep
August 2026     ->  Jul + Aug
January 2027    ->  Jan
```

The numeric total and the completeness flag are independent. A month with no
performance record contributes nothing and is named in `missingMonths`; it is
never counted as a zero month. So July 100 + August 120 with no September yet
reports `netUnits: 220` and `isComplete: false` — real accumulated data without
falsely claiming a complete quarter.

### Ranking

`calculateHmRankings()` is the only place ordering is decided. Default metric is
Net units descending; `keyInUnits`, `achievementPct`, `recruitment` and
`activeHp` are also available.

1. The chosen metric, descending.
2. A `null` metric sorts **last**, whatever the direction — unknown is not worst.
3. Ties break on Achievement % descending: of two HMs on 71 Net, the one who did
   it against a bigger target is ahead.
4. Still tied: `display_order`, then name, then `hmId`.

Steps 3 and 4 make the order **total**, so the same HMs always produce the same
ranking regardless of the order PostgREST returned rows in. Ranks are sequential
and distinct; a UI wanting to mark equal figures compares `value` on adjacent
entries. Nothing falls back to database row order.

### Data completeness

Answers one question: *has the PA updated all active HMs?* Counts, not a score.

Two concepts, kept separate on purpose:

- **Monthly record completeness** — `isComplete` is true when every *active* HM
  has a row in `hm_monthly_performance`. This is the one that matters.
- **Weekly entry completeness** — `weeklyCellsEntered` of `weeklyCellsExpected`,
  reported and never folded into `isComplete`. A month in progress legitimately
  has blank weeks; it is the 4th and W2 has not happened yet.

An empty roster is not "complete" — there is nothing to be complete about.

### Active and inactive HMs

A month's figures cover **every active HM, plus any inactive HM who has data for
that month** (a monthly row or any weekly Key-In). An inactive HM with no data
for the month is excluded outright — they are not a missing record, they simply
were not there.

This is what keeps history intact. Someone who left in September still sold in
August, and August's group Net is wrong without them; filtering every month by
today's `hms.status` would quietly rewrite history each time somebody is
deactivated. In the month somebody leaves, their partial figures still count,
because those units were genuinely sold — they are flagged `isActive: false` so
a UI can show them differently, and they are never chased by the completeness
model. Rankings keep them by default; `{ activeOnly: true }` drops them for a
current-month leaderboard.

### Performance

`getDashboardData()` fetches the selected month, the previous month and the
quarter to date in **three round trips, six queries**, whatever the roster size
or the position in the quarter — not one query per HM, per month, per metric.
Weekly Key-In is a separate trip because it is keyed by `week_id`, so the week
ids have to exist before it can be asked for. Records are split back out per
month in memory.

---

## Security

**Roles.** `manager` has full internal access. `pa` reads everything internal and
writes the operational data a PA owns: HM records, the sales calendar, monthly
and weekly performance, group SHI. Deletes of performance history and of HM
master records are manager-only; a PA deactivates an HM rather than deleting
one. HMs have no database role at all in V1.

**RLS** is enabled on every table, with no policy targeting `anon` and table
privileges revoked from it. Policies resolve the caller's role through
`public.is_staff()` / `public.is_manager()`, which only match an **active**
profile — deactivating someone revokes their access immediately.

One behaviour to know when writing mutations: a failing `USING` clause does not
raise. `SELECT`, `UPDATE` and `DELETE` simply match no rows, so an unauthorised
delete "succeeds" having removed nothing. Treat *0 rows affected* as a
permission failure.

**Column-level protection** that RLS cannot express is handled by a trigger: a
PA cannot change `profiles.role` or `profiles.is_active`, even on their own row.

**Audit fields** (`created_by`, `updated_by`, `created_at`, `updated_at`) are
stamped by a database trigger from `auth.uid()`. A client-supplied author id is
overwritten, so authorship cannot be forged. That single trigger is the hook a
fuller change-history table would extend later.

**Secrets.** `NEXT_PUBLIC_*` is the only thing that reaches the browser. The
service-role key is read exclusively through `src/lib/env.server.ts`, which is
marked `server-only` — importing it from a Client Component fails the build.

**Photo uploads.** The browser uploads the file straight to Storage — a 5 MB
image is well past the default Server Action body limit, and the bucket already
enforces size and MIME type. What reaches the Server Action is the storage
*path*, never a URL: the action validates that the path belongs to that HM and
derives the public URL itself, so `hms.photo_url` can only ever address our own
bucket. A client that posts an external URL is rejected by the path check.

**Cascade guard.** `sales_weeks.id` cascades into `hm_weekly_performance`, and a
cascade runs as the table owner rather than as the caller — so deleting a week
would slip past the manager-only delete policy on the performance table.

Two layers close that door, and they say exactly the same thing:

* `deleteSalesWeekAction` refuses first, with the message worth reading: a week
  holding Key-In is manager-only, and even a manager has to confirm after being
  told how many rows go with it.
* `tg_sales_weeks_guard_cascade` (a `BEFORE DELETE` trigger) refuses at the
  database, because the application is not the boundary — a PA holds a real
  `authenticated` JWT and the anon key, so one request straight to PostgREST
  reaches the table with no action in the path. An **empty** week is still a
  PA's to remove; that is the mistyped-period case the control exists for.

A write with no JWT — a migration, a seed, a service-role task — passes, for the
same reason the audit trigger keeps a client-supplied author when `auth.uid()`
is null: those callers already bypass RLS entirely, so refusing them would break
`db reset` while protecting nothing.

**The HP import.** `import_hp_month` is deliberately **not** `SECURITY DEFINER`:
every statement inside it runs as the caller under the Stage 8 policies. A PA
can import because the policies say a PA may write those tables, not because the
function elevates them. It validates the entire payload before the first INSERT
and raises with a stable `hp_import_*` prefix that `mapDatabaseError()` turns
into something a PA can act on, so a direct call to PostgREST is refused for the
same reasons and with the same wording as the UI would give.

The upload itself is untrusted input: size is checked before the bytes are read,
each inflated part is capped before *and* after inflating, and rows and columns
have ceilings. `anon` has no privilege on `hps`, `hp_monthly_performance`,
`hp_import_runs` or either view, and both views are `security_invoker`, so RLS
applies to the caller rather than to the view's owner.

**The public share boundary.** Stage 6 introduces the only unauthenticated view
of business data in the application, and it is drawn in the database rather than
in the app. `anon` has no table privileges and no policy anywhere; it may execute
exactly three functions, all `SECURITY DEFINER`, all gated on the same token, and
all returning `NULL` for every failure:

| | |
|---|---|
| `resolve_share_report(token)` | the group report at `/share/<token>` — a hand-built JSON projection of **one** reporting month |
| `resolve_share_hm_report(token, hm_id)` | one HM's page at `/share/<token>/hm/<hmId>` — that same month, plus **that one HM's** monthly figures for the previous month and the earlier months of the quarter |
| `resolve_share_hm_hp(token, hm_id)` | that HM's HP list at `/share/<token>/hm/<hmId>/hp` — **that one HM's** HP rows for the token's own month, capped at 1000 |

`db:test` asserts that set **by name**, not by count. Widening the anonymous
surface is a decision somebody has to go and make in that test; it cannot happen
as a side effect of adding a function.

Neither projection carries `created_by`, `updated_by`, a performance row id, or
anything from `profiles` or `auth`. Every sub-select in the group resolver is
anchored to the token's own `month_id`; the HM resolver adds the context months
month over month and QTD need, narrowed to a single HM and stripped of weeks,
weekly Key-In and group SHI, so it can never be assembled into a second group
report. It also refuses an HM the token's month is not about, so a token cannot
be used to enumerate the HM table.

The token is a capability, not an identifier: 32 bytes from the platform CSPRNG,
base64url. It is never derived from a month id, an HM id, a date or a counter,
and both the app and the database refuse a uuid-shaped token outright — a uuid
is 36 characters and its dashes are legal base64url, so it would otherwise clear
a naive shape check, and "try the month id as a token" is the first thing anyone
would try. After issue, a trigger freezes the token and its `month_id`, so a
circulated link cannot be repointed at another month; the public route reads no
search parameters at all, so `?month=` has nothing to override.

Links do **not** expire by default — see `src/lib/share/config.ts` for that
decision and how to turn expiry on. They are revoked instead: revoking flips
`is_active` and stamps `revoked_at`, the row is kept for the audit trail, and the
month's figures are untouched. A revoked, expired, unissued or malformed token
all produce the same "Report unavailable" page, so nothing can be learned by
probing.

**Storage.** HM photos live in the `hm-photos` bucket (5 MB, image types only —
JPEG, PNG, WebP, AVIF; no SVG, no anything else); the database stores just the
URL. The bucket is read-public so the future HM-facing dashboard can render
avatars without signed URLs; writes require an active manager or PA. To make it
private later, flip `public` in the storage migration and switch
`src/lib/storage.ts` to signed URLs — no other caller changes.

**HTTP headers** are set in `next.config.ts` and apply to every response,
redirects included:

| Header | Value |
|---|---|
| `Content-Security-Policy` | `base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin`, and `no-referrer` on `/share/*` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` |

`X-Powered-By` is switched off.

The CSP deliberately carries no `script-src`, `style-src`, `img-src` or
`connect-src`. Next.js inlines its own bootstrap and streaming payload, so a
meaningful `script-src` needs a per-request nonce threaded through the proxy —
and a `script-src` that ends in `'unsafe-inline'` is a header that says nothing
while looking like it says something. `img-src` and `connect-src` would have to
name the Supabase host, which is part of `NEXT_PUBLIC_SUPABASE_URL` and
therefore differs per deployment. What is there costs nothing and closes real
doors: clickjacking, MIME sniffing, `<base>` hijacking, plugin content, and a
form posted from our page to somebody else's server.

`no-referrer` on the share route is not decoration. That URL *is* the
credential — the token is in the path — so the page that leaves the building
sends no referrer at all rather than trusting each browser's reading of a
weaker policy.

**Known boundary: the HM id on a share page.** A share page renders avatars
straight from the storage bucket, and the object path is `<hm id>/<timestamp>`,
so an HM's uuid is visible in the page source to anyone holding a link. Since the
cards became clickable it is also in the link each one carries. Neither is a
capability: `anon` holds no privilege on any table, both resolvers refuse a
uuid-shaped token outright, an HM id is useful only in combination with a live
token, and `/hm/<id>` — the private screen — is still behind login. Changing it would mean
re-keying the bucket layout — which is also what makes `isHmPhotoPathFor()` able
to prove an uploaded path belongs to the HM it claims — and orphaning every
photo already stored.

---

## Deploying

A stock Next.js App Router deployment. Nothing here is host-specific, and
nothing is configured that a host has to be told about.

| | |
|---|---|
| Build | `npm run build` |
| Start | `npm run start` (hosts that run the server themselves ignore this) |
| Node | 20 or newer — 24 is what this was developed and verified against |
| Output | Default. No `standalone`, no `export`; every data route is dynamic |
| Install | `npm ci` |

Every route except `/` and `/_not-found` is server-rendered on demand, which is
the point rather than an oversight: they all read the signed-in user's session,
and `/share/[token]` is `force-dynamic` so a revoked link stops working
immediately rather than eventually.

**Environment variables in production.** Exactly three, all documented under
[Configure environment](#2-configure-environment):

```
NEXT_PUBLIC_SUPABASE_URL      required
NEXT_PUBLIC_SUPABASE_ANON_KEY required
NEXT_PUBLIC_APP_URL           required in production - your own https origin
```

`SUPABASE_SERVICE_ROLE_KEY` is **not required** and should be left unset. The
application never uses it: every read and write goes through the request-scoped
client so RLS applies as the signed-in user. `src/lib/supabase/admin.ts` exists
as a guarded escape hatch for a future server-side administrative task and is
imported by nothing; setting the key would add a secret to the deployment that
protects nothing and bypasses everything.

All three are `NEXT_PUBLIC_*`, so they are **inlined at build time**. Changing
one means a rebuild, not a restart.

**Before the first deploy**

1. `npx supabase link --project-ref <ref>` then `npm run db:push` — applies
   every migration to the hosted project. `supabase/seed.sql` is a `db reset`
   fixture for the local stack; it never runs against a hosted project.
2. Create the first manager from the Supabase dashboard (see
   [Create the first user](#4-create-the-first-user)).
3. Set the three variables above in the host's environment settings.
4. `npm run check` — typecheck, lint, every suite, then the production build.

---

## Operations

### Backup and recovery

Deliberately no custom backup system. The two halves of this application recover
by different routes, and both already exist.

**The data** is Supabase's. Automated daily backups come with the paid plans;
Point-in-Time Recovery is a project add-on. Turning one of those on, and knowing
the retention window, is the single operational decision this project asks for —
make it in **Supabase Dashboard → Database → Backups** before the first real
month is keyed in, because an accidental cascade is recoverable only from a
backup that was already running. Storage objects (HM photos) are backed up
separately from the database on Supabase; a lost photo is a re-upload, so it is
the tables that matter.

**The schema** is this repository. `supabase/migrations/` is the whole
definition — tables, constraints, triggers, RLS policies, the storage bucket and
the share resolver — applied in filename order:

```bash
npx supabase link --project-ref <ref>
npm run db:push          # rebuild the schema on a new or restored project
```

`npm run db:test` applies the same files to a throwaway Postgres and asserts the
rules still hold, so "does the schema still do what we think" is answerable
without a project to point at.

**The configuration** is the three environment variables above, plus the
Supabase project's own auth settings. There is nothing else to restore: no
scheduled jobs, no queues, no external services, no state living outside
Postgres and Storage.

### Share links, load and abuse

There is no rate limiter, and V1 does not need one. What is worth knowing about
the shape of the public surface:

* A public page view costs **one** RPC — `resolve_share_report` is a single
  statement over one month's rows, whatever the roster size. There is no query
  per HM, per week or per KPI.
* A token that is malformed, uuid-shaped or the wrong length is rejected on
  **shape**, in the application and again at the top of the resolver, before any
  index is touched. Guessing costs the attacker a round trip and gains nothing:
  the token is 256 bits from a CSPRNG.
* `last_accessed_at` is throttled to one write per five minutes per link, so a
  link pasted into a group chat and opened by twenty people at once is twenty
  reads and one write.
* The one control that matters is **revocation**, and it takes effect on the
  next request — the page is `force-dynamic`, so nothing is served from a cache
  after the switch is thrown.

If a link is ever circulated wider than intended, revoke it and generate a new
one. That is the whole incident response, and it is two clicks in the report
panel.

---

## Project structure

```
src/
  app/
    (auth)/            login, no-access        — unauthenticated
    (app)/             dashboard, data-entry, hp, hp-import, hm-management,
                       settings
    share/[token]/     the read-only month report — unauthenticated, no shell
                       .../hm/<id>       one HM's month
                       .../hm/<id>/hp    that HM's HP list
  components/
    ui/                button, card, field, select, alert, badge, modal,
                       page-header, status colours
    layout/            app shell, nav, sign-out
    hm/                avatar, management table, form, photo uploader
    hp/                listing table (cards on a phone), filters, pagination,
                       the Excel import workspace
    data-entry/        workspace, month selector, calendar editor,
                       performance grid, cell, group SHI, status, save bar
    dashboard/         header, month switcher, refresh, KPI cards, target
                       track, weekly Key-In chart, HM cards, completeness,
                       MoM/QTD panel, empty states, skeleton
    hm-detail/         header, primary performance, metric tile, weekly strip,
                       secondary KPIs, sales mix, MoM, QTD, states, skeleton
    share/             the public read-only report: header, KPIs, weekly rows,
                       HM cards, the HP list, unavailable state
  lib/
    actions/           Server Actions: hms, months, sales-weeks, performance,
                       share (generate / revoke)
    auth/              session guards + sign-in/out actions
    calculations/      THE KPI ENGINE — pure, no Supabase, no React
      performance.ts     primitives: totals, ratios, status bands, blank/zero
      hp.ts              HP Total Key-In, the active threshold, the counts
      inputs.ts          normalization: database rows -> calculation inputs
      hm.ts              the HM monthly model + the weekly model
      group.ts           group aggregation + data completeness
      kpi-status.ts      the KPI pacing bands + the current Coway week
      comparison.ts      quarter/month arithmetic, MoM, QTD
      ranking.ts         ordering, with a total tie-break rule
      index.ts           the barrel — import derived figures from here
    view-models/       monthly-performance.ts  records -> HM models -> group model,
                                               and one HM's month on its own
                       dashboard.ts            group model -> what the screen shows
                       hm-detail.ts            one HM's model -> their screen
                       hp-listing.ts           one page of HP rows -> the table
                       public-share.ts         dashboard model -> what a public
                                               viewer may see (a projection)
    import/            xlsx.ts       a small .xlsx reader - ZIP + two XML scans
                       hp-import.ts  sheet -> validated preview -> commit payload
    reports/           whatsapp.ts  the view model -> plain text, pure
    share/             token.ts (CSPRNG + shape gate), config.ts (expiry policy),
                       resolve.ts (the RPC payload -> a public report, pure),
                       resolve-hp.ts (one HM's HP rows -> the shared HP list),
                       origin.ts (the app's own address, server-only)
    data/              read access, returns Result<T> instead of throwing
                       dashboard.ts fetches a month + previous + QTD in 7 queries
                       hm-detail.ts reads that same bundle — no query of its own
                       hp.ts        the paged HP listing and the import context
                       share.ts     link management, and the one public read
    data-entry/        the editable grid model — pure, framework-free
    supabase/          browser / server / admin / proxy clients
    validation/        Zod schemas, one per entity
    calendar.ts        month selection + sales-week helpers (server and client)
    env.ts             public config      env.server.ts  secrets (server-only)
    errors.ts          Postgres errors -> field-level messages
    routes.ts          route table + role-filtered navigation
    storage.ts         hm-photos paths and validation
  types/               database.ts (generated shape), models.ts
  proxy.ts             session refresh + auth redirects (Next 16 middleware)

supabase/
  migrations/          schema, RLS, storage, sales-week overlap, share links,
                       HM Code, HP tables + views, the atomic import function
  tests/               schema rule tests
  seed.sql             local dev only

tests/
  validation.test.mts  Stage 1
  stage2.test.mts      Stage 2
  stage3.test.mts      Stage 3 — the calculation engine
  stage4.test.mts      Stage 4 — the dashboard
  stage5.test.mts      Stage 5 — the HM detail screen
  stage6.test.mts      Stage 6 — the WhatsApp report and the public share view
  stage8.test.mts      Stage 8 — the HP Excel import, Active HP, the HP listing
  fixtures.mts         declarative month/roster builders, Stage 3 onwards
  xlsx-fixture.mts     a minimal .xlsx WRITER, so the reader is tested against
                       a real ZIP with real shared strings — tests only
```

### Patterns worth following

- **Authorization**: call `requireAuth()`, `requireManager()` or
  `requirePaOrManager()` from `src/lib/auth/session.ts`. Never scatter role
  checks through components. These decide what the UI shows; RLS decides what
  the database returns.
- **Reads**: server-only modules in `lib/data/` returning `Result<T>`, so a page
  can render a degraded state instead of hitting the error boundary.
- **Writes**: Server Actions returning `ActionState`, with
  `mapDatabaseError()` turning a constraint violation into a message next to the
  right field.
- **Validation**: a Zod schema per entity, mirroring the database constraints.
  When a constraint changes, change both in the same commit.
- **Calculations**: every derived figure has exactly one definition, in
  `lib/calculations/`, imported from the barrel. No component, chart, ranking or
  report recomputes a percentage, a total or a status band. Calculation
  functions never query Supabase; `lib/data/` fetches and hands them records.
- **Batch writes**: the grid saves a whole month in three statements — one
  upsert per table — never one request per cell. Reference checks run first, and
  a save that fails writes nothing and keeps every edited value on screen.

---

## The dashboard

`/dashboard?month=2026-09` — the management command centre. Management
Attention, group KPIs, the weekly Key-In chart, and the HM cards ranked by net
units.

### Management Attention

The first section on the page, because the question a manager opens the
dashboard with is "is anything wrong" and the answer should not be three scrolls
down on a phone. It names every HM with at least one 🔴 KPI and which KPIs those
are — most reds first, the month's ranking as the tie-break. Watch never appears
there: a list holding both bands would name most of the team most months.

Empty is the good case and reads like one: *"All HM KPIs are above the attention
threshold."*

Each HM card then carries the four bands under the four figures — Key-In, Net,
Recruitment and Active HP — with the arithmetic spelled out where the band and
the figure are different numbers. The card's Key-In figure is the month's total;
the band under it is the running total **through the current week** against the
monthly target, and its note says so: `W1–W2: 47 of 100 target · 47.0%`. The
thresholds are in
[the calculation engine](#kpi-status-a-pacing-indicator-not-a-forecast); no
component holds one.

### The presenter, and why components hold no formulas

```
lib/calculations  ->  view-models/monthly-performance  ->  view-models/dashboard  ->  components
   what a figure IS          the month, assembled            what the screen says       layout
```

`buildDashboardViewModel()` turns the Stage 3 model into strings and status
bands: `kpi.value` is `"86.2%"`, already formatted, blanks included. A component
that needs Achievement reads that string — it never has `totalNet` and
`totalTarget` in the same scope, so it cannot divide them and quietly invent a
second definition of Achievement.

That seam is also what makes the dashboard testable without a DOM.
`tests/stage4.test.mts` asserts that the tile labelled Achievement carries the
**engine's** achievement; it never recomputes one, because a test that divided
Net by Target would go green whenever it and the engine were wrong the same way.
Two tests enforce the rule structurally: no dashboard component may reference a
raw calculated field, and none may import the engine except for the locked
weekly thresholds the chart legend states.

### The month lives in the URL

`?month=2026-09`, validated by `parseMonthParam()`. A refresh, a bookmark and a
shared link all land on the same month, and switching month is a navigation —
the whole page is re-fetched, so no section can be left showing August while
another shows September. A month id is accepted too, so a link handed over from
Data Entry does not dead-end.

`resolveDashboardMonth()` carries the *reason* alongside the month: today's,
requested, a fallback because today's has not been opened, or invalid. Three of
the four are visible on screen — a dashboard that silently showed September
under an October heading would be the one failure worth engineering against.

### The chart is hand-drawn, deliberately

Four to six bars, no zoom, no brush, no series toggling. Written as a flex row
it renders on the server and ships **no JavaScript**; through a charting library
it is a few hundred kB of client bundle, a hydration pass, and a fight with
per-bar colouring to express a band the engine has already decided. Only the
month switcher and the refresh button are Client Components.

Status is never carried by colour alone: every bar states its figure, its band
as a dot *and* a word, and a screen-reader sentence naming the period.

### What it refuses to show

A blank week is an em dash and a neutral outline — never a zero, and never red,
because the week has not happened yet. A group total nobody has contributed to
is blank, not `0`. An absent previous month reads "No previous month data", not
`+100%`. A quarter missing July names July rather than summing around it.

---

## The HM screen

`/hm/<id>?month=YYYY-MM` — an individual performance profile, reached by
clicking any HM card on the dashboard.

### It is a sibling of the dashboard, not a child

`/dashboard/hm/<id>` would sit inside the dashboard's own `loading.tsx`
Suspense boundary, so a hard load of an HM profile flashed the GROUP skeleton —
eight KPI cards and a bar chart — before the person's figures appeared. As its
own top-level segment it gets its own boundary and its own skeleton. The
navigation still highlights Dashboard, because `NAV_ITEMS` says the route
belongs to it.

### One fetch, shared with the dashboard

`getHmDetailData()` issues no query of its own: it asks for the same batched
month bundle `getDashboardData()` builds — six queries, whatever the roster
size or position in the quarter — and selects the HM out of it. That is what
makes "the HM's Net here equals the HM's Net on the dashboard" a property of
the code rather than something to re-test after every change.

### Mobile is the layout, not a shrunk desktop

The reading order is the same at every width and it is the mobile order: who
and when, Net against target, the keyed-in figures, the weekly detail, the mix,
then the periods around this month. Wider screens get more columns, never a
different sequence.

The weekly bars run across rather than up. The dashboard's group chart is a
column per week, which works in a wide panel; at 375px the same six columns get
about 50px each — enough for a bar and nothing for "30 Aug – 5 Sep". Turned on
its side every week gets the full width for its dates and its figure, and one
layout serves a phone and a 1440px desktop.

### The same four bands as the card

Key-In, Net, Recruitment and Active HP each carry the KPI status the dashboard
card shows, read out of the same month model rather than recalculated. The
weekly strip adds one per week: that week's Key-In as a share of this HM's
monthly target, at that week's threshold — progress against the month, week by
week. A week the PA has not reached says "Not entered"; W5 and W6 say "Not
configured", because the business has defined no band for them.

Where a figure carries both an old Stage 2 colour band and a Stage 9 pacing
band — Recruitment is the only one — the tile shows the pacing band alone. The
two disagree by design (3 recruits is GREEN under the old thresholds and Watch
under the new), and two verdicts on one number is worse than either.

### What it refuses to invent

No achievement bands: the business has not defined any, so the target track is
one neutral colour and the figure is written out beside it. A target of 0 reads
"Target not set" with a blank achievement, never 0% or ∞% — and no Key-In band
either, because a pace with no target is unknown rather than 0%. A missing SHI
says "Not entered" rather than borrowing the group's or last month's. An HM the
month does not cover still opens — they exist — and says nothing was entered,
with no band anywhere on the page.

---

## Sharing a month

Two surfaces, one source. The PA opens the dashboard, clicks **Generate WhatsApp
report**, reads the preview, copies it, and pastes it into the HM2 group. The
message carries a link to a read-only web version of the same month.

### The numbers cannot disagree

This is the property the whole stage is built around, and it is structural
rather than tested-into-existence:

```
engine  ->  monthly-performance  ->  dashboard view model
                                          |
                        +-----------------+-----------------+
                        |                                   |
              generateWhatsAppReport            buildPublicShareViewModel
                   (plain text)                      (the /share page)
```

Both the message and the public page are built **from the dashboard's own view
model**. The report generator reads already-formatted strings — it never sees a
raw figure, so there is nothing in scope for it to divide — and the public model
is a projection that drops fields rather than computing any. Neither sorts: the
HM order in the message, on the dashboard and on the shared page is the one
Stage 3's ranking produced.

`generateWhatsAppReport(viewModel, { shareUrl })` is pure — no database, no
React, no browser, no clock — and it is called once, on the server. The string it
returns is what the preview shows *and* what the clipboard receives; there is no
second render of the same data.

### Live, not a snapshot

A share token names a reporting **month**, not a frozen copy of it. September's
link shows September as it stands today, so a correction keyed in on the 25th
appears on a link that was posted on the 4th. Immutable snapshots, if they are
ever wanted, are a later feature and a different token type.

One active link per month is the norm — the panel reuses it rather than minting a
token per click. "Create a new link" is the deliberate exception, and it revokes
the old one in the same action rather than leaving two live.

### The link list is never stale

Creating and revoking both change what the list should say, so the list is owned
by the panel and updated from the **server's own result** — never re-fetched,
never guessed, never fixed by a page reload:

| Action | What comes back | What the panel does |
|---|---|---|
| Create / rotate | The whole list, after the write | Replaces the list. Rotation revokes one row and adds another, so both changes arrive together |
| Revoke | The revoked row | Replaces that row in place |

The active and revoked counts are counted from the rows on screen, and whether
the panel's own link is dead is derived from the list rather than tracked beside
it, so the heading cannot say "1 active" over a table showing two. There is no
optimistic row: every value on screen came from the database, which is why there
is nothing to reconcile afterwards. The state transitions are pure functions in
`src/lib/share/link-list.ts`, proved in `npm run test:stage6`.

### Where a share link points

Share URLs are built from `NEXT_PUBLIC_APP_URL` when it is set, and from the
request host when it is not — [see the setup notes](#next_public_app_url). Set
it in production; leave it blank locally.

### What the message does not carry

Reporting month, group Key-In / Net / Target / Achievement / Recruitment /
Active HP / SHI / Net Ratio, weekly Key-In, one line per HM, completeness, and
the link. Not the Extrade split, not MoM, not QTD, not per-HM SHI or targets —
those are on the shared dashboard the link opens. Twelve HMs' worth of them is
not a message anybody reads on a phone.

Blanks stay blank throughout: an un-keyed figure is an em dash, never 0; a week
nobody has entered is a white circle, never red; and a missing group SHI reads as
"Not entered" rather than as the average of the HM column.

### The public page

`/share/<token>` is mobile-first — it is opened from a chat app — and carries no
navigation, no month selector, no refresh, no edit, no sign-out and no manager or
PA name. It is not a variant of `/dashboard`: it lives outside the `(app)` route
group entirely, so the authenticated shell has no code path that could render for
an anonymous visitor. Its "Updated" stamp is the data's own, computed in SQL from
the month's rows, never the render clock.

Each HM card opens that HM's own read-only page at `/share/<token>/hm/<hmId>` —
the same sections, the same components and the same figures as the manager's
`/hm/<id>` screen, for the month the token names, with no month switcher and no
way out of the token except back to the report. `/hm/<id>` itself stays behind
login, and revoking the link closes both pages in the same instant.

---

## HP: the Excel import and the listing

`/hp-import` — the PA updates their spreadsheet as usual and uploads it here.
`/hp?month=2026-09&active=1` — what went in, read-only.

The point of this stage is not to replace the PA's Excel. It is to make the
Excel the **input**, so the same figures stop being keyed in a second time by
hand.

### The pipeline

```
upload -> readXlsx -> buildHpImportPreview -> [ PA looks ] -> import_hp_month
          ZIP+XML     pure, no database                        one transaction
```

Two Server Actions, and neither of them is the boundary. `import_hp_month`
re-runs every check as the caller under RLS, so a direct POST to PostgREST meets
the same rules with the same messages. What the actions buy is the *wording*:
"row 18 — Unknown HM Code: HM99999" instead of a database error.

### There is no partial import

PostgREST gives every statement its own transaction, so creating the new HPs,
rewriting the month and recording the run would be three independent commits —
and a failure between them would leave a month half imported, which is a state a
PA has no way to diagnose or undo. `import_hp_month` is a plpgsql function: one
statement to the client, one transaction to the database. An import lands
completely or not at all, and a rejected one does not even leave the HP master
records it would have created.

### Two totals, one of them authoritative

The spreadsheet has a TOTAL KEY-IN column, kept because the PA reads it. The
importer computes its own from W1–W4 and treats a disagreement as an **error**
rather than preferring one: a mismatch means the file's weeks and its total
describe different months, and the honest answer is to name the row and let the
PA look. What gets stored is always the calculated figure, and a database CHECK
refuses any other.

### What an import will not do

| Case | Behaviour |
|---|---|
| HM Code not in `hms` | **Rejected.** An import never creates an HM — an unrecognised code is far more likely to be a typo than a new hire. |
| HP Code not in `hps` | **Created automatically.** The PA never has to add an HP by hand. |
| HP Code appears twice in one file | **Rejected**, with every offending row named. Merging silently would make the month depend on row order. |
| HP present last month, absent this month | **Kept.** No destructive cleanup based on absence from an upload. |
| A reactivated HP with a NEW code | A **new** HP. There is deliberately no merge path between two codes. |
| HP renamed, or moved to another HM | Both follow the file. Previous months keep their own `hm_id`, so nothing historical moves with it. |
| A second import of the same month | Rewrites the rows it contains. Other months are untouched — an import targets exactly one `month_id`. |

### Active HP became a derived figure

Before Stage 8, Active HP was a number the PA typed into the grid. It is now
counted: `COUNT` of that HM's HP rows for the month with `total_key_in >= 1`,
taken from `hm_monthly_hp_summary` and read from nowhere else. Three
consequences worth knowing:

- **Data Entry no longer offers the field.** A box to type it into would be a
  second answer to a question the data already answers, and the two would
  disagree the first time somebody typed a number the spreadsheet did not
  support.
- **`hm_monthly_performance.active_hp` is deprecated, not dropped.** It still
  holds whatever was keyed in before Stage 8, because dropping a column destroys
  data. The grid's save omits it entirely — PostgREST builds its
  `ON CONFLICT DO UPDATE SET` list from the keys sent, so a column nobody sends
  is neither overwritten nor invented.
- **A month with no HP import shows `—`, not `0`.** Nobody has said anything
  about that month's HPs yet, and "0 active" would be a claim rather than a
  blank. An HM *with* HP rows and none of them active does show a real `0`; the
  `hp_count` that travels with the count is what separates the two.

The dashboard's Active HP tile and every HM card's Active HP figure are links
into `/hp`, carrying the month, the HM and the active filter — so the number and
the list behind it cannot disagree about what was clicked.

### Why the .xlsx reader is ours

`src/lib/import/xlsx.ts` is about two hundred lines: a ZIP central-directory
walk, `node:zlib` for the deflated parts, and two XML scans. The file it has to
read has nine text-and-number columns, no formulas, no dates and no styling that
matters.

The alternatives were worse rather than merely larger. The widely-known `xlsx`
release on npm is the pre-fork one carrying published prototype-pollution and
ReDoS advisories, and a full workbook framework brings a dependency tree and an
API surface far past "read the first sheet as text" for a 30 KB file.

The upload is untrusted, so every limit is real: 5 MB on the file, a cap on each
inflated part checked *before* inflating and again against what came out, and
ceilings on rows and columns. Sparse cells are addressed by their `r="C4"`
reference rather than by position — without that, a row with a blank HP CODE
would shift every later column left and quietly import the Net as the Total.

### The public report, and the HP list behind it

The group report carries Active HP as an **aggregate count per HM** —
`{hm_id, hp_count, active_hp}` — which is what the public page already showed
before Stage 8; only its source changed. No HP row reaches that page.

One level deeper, it does. `/share/<token>/hm/<hmId>/hp` shows **one HM their
own HPs**, because "Active HP 18" with nowhere to go is a number the person
managing those eighteen people cannot act on. The widening is deliberate and it
is narrow:

- **One HM**, and only one the token's month is already about — the same gate
  the HM page applies, so a token cannot walk the HM table.
- **One month**, the token's. There is no parameter for a month.
- **Figures only**: HP code, name, W1–W4, Total Key-In, Total Net. No row id, no
  `hm_id`, no audit column — nothing in the payload is a handle to anything.
- **No HM Code.** An internal mapping key; the reader does not need it to
  recognise their own team, and it is left out of the projection rather than out
  of the markup.
- **1000 rows**, so one request cannot become a bulk export.

What a link holder can now see that they could not before: the names and Coway
codes of one HM's HPs, and what each of them keyed in that month. That is the
point of the change — it is the HM's own team, on a link their manager sent
them. Revoking the link closes all three pages in the same instant.

The public HM model still carries no HM Code, and its Active HP link is built by
the caller that holds the token, so it is always a `/share/…` path — the
presenter never learns the private route exists.

---

## Not built yet

HM logins, HP logins, historical dashboard UI, advanced
filtering, notifications, forecasting, AI recommendations, commission, PDF or
image export, scheduled sending and any WhatsApp API integration.

Deliberately **not** built, and not an oversight: there is no weekly incentive
calculator, target engine, threshold, forecast or status badge anywhere in the
**HP** data. W1–W4 exist there because the PA's spreadsheet already carries them
and because an HM can read momentum off them — they are performance detail, not
an input to a calculation the business has not defined. The Stage 9 KPI bands
are HM-level and stop at the thresholds the business stated; they do not reach
down to an individual HP, and they forecast nothing.

Each of those consumes `buildMonthlyPerformanceViewModel()` or
`buildHmPerformanceViewModel()` and formats what it returns. None of them
should contain a formula.

### Known boundary: blanking a saved weekly figure

Removing a saved weekly Key-In figure is manager-only, because
`hm_weekly_performance` deletes are manager-only under the Stage 1 RLS policy.
A PA who blanks a cell that already holds a figure is told to enter `0` for a
genuine zero week rather than having the value silently reappear after the page
refreshes. Widening that policy is a deliberate decision for a later stage, not
something the data-entry UI should route around.
