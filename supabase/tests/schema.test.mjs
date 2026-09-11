/**
 * Schema rule tests for the HM2 database.
 *
 *   npm run db:test
 *
 * Applies supabase/migrations to a throwaway Postgres 17 running in WebAssembly
 * (PGlite), then asserts the constraints, triggers and RLS policies actually
 * behave. No Docker and no hosted project needed, so this runs anywhere in a
 * few seconds - useful as a pre-commit or CI gate whenever the schema changes.
 *
 * Scope and limits: `bootstrap.sql` supplies minimal stand-ins for the pieces of
 * Supabase the migrations lean on (auth.users, auth.uid(), storage.buckets,
 * storage.objects, the anon/authenticated/service_role roles). It exercises the
 * SQL we wrote, not Supabase itself - GoTrue, the Storage API and PostgREST are
 * out of scope. Verify those against `supabase start` or a real project.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const db = await PGlite.create();

let pass = 0;
let fail = 0;

function report(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
}

/** Runs SQL that is expected to succeed. */
async function run(sql, label) {
  try {
    await db.exec(sql);
    if (label) report(label, true);
    return true;
  } catch (e) {
    if (label) report(label, false, e.message);
    else throw e;
    return false;
  }
}

/** Runs SQL that is expected to be REJECTED, optionally by a named constraint. */
async function expectReject(sql, label, expectedFragment) {
  try {
    await db.exec(sql);
    report(label, false, "statement was accepted but should have been rejected");
  } catch (e) {
    const matched =
      !expectedFragment || e.message.includes(expectedFragment);
    report(
      label,
      matched,
      matched ? "" : `rejected, but not by ${expectedFragment}: ${e.message}`,
    );
  }
}

async function one(sql) {
  const res = await db.query(sql);
  return res.rows[0];
}

// -----------------------------------------------------------------------------
console.log("\n[1] Bootstrap Supabase stand-ins");
// -----------------------------------------------------------------------------
await run(
  readFileSync(path.join(HERE, "bootstrap.sql"), "utf8"),
  "auth + storage stand-ins",
);

// -----------------------------------------------------------------------------
console.log("\n[2] Apply migrations in order");
// -----------------------------------------------------------------------------
const migrations = readdirSync(path.join(ROOT, "migrations")).sort();
for (const file of migrations) {
  await run(readFileSync(path.join(ROOT, "migrations", file), "utf8"), file);
}

// -----------------------------------------------------------------------------
console.log("\n[3] Schema shape");
// -----------------------------------------------------------------------------
const expectedTables = [
  "profiles",
  "hms",
  "months",
  "sales_weeks",
  "hm_monthly_performance",
  "hm_weekly_performance",
  "group_monthly_metrics",
  "share_links",
  "hps",
  "hp_monthly_performance",
  "hp_import_runs",
];
const tables = (
  await db.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`,
  )
).rows.map((r) => r.table_name);
report(
  `all ${expectedTables.length} tables created (${tables.join(", ")})`,
  expectedTables.every((t) => tables.includes(t)) &&
    tables.length === expectedTables.length,
);

// Views are listed separately, and the list is exact: a view is the one thing
// in this schema that can quietly read as its OWNER rather than as the caller,
// so a new one appearing here without the security_invoker check below noticing
// would be a hole through every policy underneath it.
const expectedViews = ["hm_monthly_hp_summary", "hp_monthly_report"];
const views = (
  await db.query(
    `select table_name from information_schema.views
      where table_schema = 'public' order by table_name`,
  )
).rows.map((r) => r.table_name);
report(
  `views created (${views.join(", ")})`,
  expectedViews.every((v) => views.includes(v)) &&
    views.length === expectedViews.length,
);

const invokerViews = (
  await db.query(
    `select c.relname
       from pg_class c
      where c.relnamespace = 'public'::regnamespace
        and c.relkind = 'v'
        and coalesce(
              (select option_value = 'true'
                 from pg_options_to_table(c.reloptions)
                where option_name = 'security_invoker'),
              false)`,
  )
).rows.map((r) => r.relname);
report(
  "every view is security_invoker, so RLS applies to the caller",
  expectedViews.every((v) => invokerViews.includes(v)),
  `invoker views: ${invokerViews.join(", ") || "none"}`,
);

const rlsOff = (
  await db.query(
    `select relname from pg_class where relnamespace = 'public'::regnamespace
       and relkind = 'r' and not relrowsecurity`,
  )
).rows.map((r) => r.relname);
report(
  "RLS enabled on every public table",
  rlsOff.length === 0,
  `RLS off for: ${rlsOff.join(", ")}`,
);

const policyCount = Number(
  (await one(`select count(*) as c from pg_policies where schemaname = 'public'`))
    .c,
);
report(`policies created on public tables (${policyCount})`, policyCount >= 24);

const storagePolicies = Number(
  (
    await one(
      `select count(*) as c from pg_policies where schemaname = 'storage' and tablename = 'objects'`,
    )
  ).c,
);
report(`storage.objects policies created (${storagePolicies})`, storagePolicies === 4);

const bucket = await one(
  `select public, file_size_limit, array_length(allowed_mime_types, 1) as mimes
     from storage.buckets where id = 'hm-photos'`,
);
report(
  "hm-photos bucket configured (public read, 5 MB, 4 mime types)",
  bucket?.public === true &&
    Number(bucket.file_size_limit) === 5242880 &&
    Number(bucket.mimes) === 4,
  JSON.stringify(bucket),
);

const anonGrants = Number(
  (
    await one(`select count(*) as c from information_schema.role_table_grants
                where grantee = 'anon' and table_schema = 'public'`)
  ).c,
);
report("no table privileges left on anon", anonGrants === 0, `${anonGrants} grants`);

// -----------------------------------------------------------------------------
console.log("\n[4] months: quarter + label derivation");
// -----------------------------------------------------------------------------
await run(
  `insert into public.months (year, month, label, quarter)
     select 2026, m, '', 1 from generate_series(1, 12) as m`,
);

const quarters = (
  await db.query(
    `select month, quarter, label from public.months where year = 2026 order by month`,
  )
).rows;
const expectedQuarters = [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4];
report(
  "Jan-Mar=Q1, Apr-Jun=Q2, Jul-Sep=Q3, Oct-Dec=Q4",
  quarters.every((r, i) => Number(r.quarter) === expectedQuarters[i]),
  JSON.stringify(quarters.map((r) => `${r.month}:${r.quarter}`)),
);
report(
  'label derived as "September 2026"',
  quarters[8]?.label === "September 2026",
  `got "${quarters[8]?.label}"`,
);

await expectReject(
  `insert into public.months (year, month, label, quarter) values (2026, 9, 'dup', 3)`,
  "duplicate year+month rejected",
  "months_year_month_key",
);
await expectReject(
  `insert into public.months (year, month, label, quarter) values (2026, 13, '', 1)`,
  "month 13 rejected",
  "months_month_range",
);

// -----------------------------------------------------------------------------
console.log("\n[5] sales_weeks: irregular Coway periods");
// -----------------------------------------------------------------------------
const sept = await one(
  `select id from public.months where year = 2026 and month = 9`,
);

// Deliberately irregular and five weeks long - the schema must not care.
await run(
  `insert into public.sales_weeks (month_id, week_number, week_label, start_date, end_date) values
     ('${sept.id}', 1, '', '2026-08-29', '2026-09-04'),
     ('${sept.id}', 2, '', '2026-09-05', '2026-09-13'),
     ('${sept.id}', 3, '', '2026-09-14', '2026-09-19'),
     ('${sept.id}', 4, '', '2026-09-20', '2026-09-26'),
     ('${sept.id}', 5, '', '2026-09-27', '2026-10-02')`,
  "five irregular weeks accepted (not a 1-7 / 8-14 grid)",
);

const labels = (
  await db.query(
    `select week_label from public.sales_weeks where month_id = '${sept.id}' order by week_number`,
  )
).rows.map((r) => r.week_label);
report(
  "week_label defaults to W1..W5",
  labels.join(",") === "W1,W2,W3,W4,W5",
  labels.join(","),
);

await expectReject(
  `insert into public.sales_weeks (month_id, week_number, start_date, end_date)
     values ('${sept.id}', 3, '2026-09-01', '2026-09-07')`,
  "duplicate week_number within a month rejected",
  "sales_weeks_month_week_key",
);
await expectReject(
  `insert into public.sales_weeks (month_id, week_number, start_date, end_date)
     values ('${sept.id}', 6, '2026-09-30', '2026-09-01')`,
  "start_date after end_date rejected",
  "sales_weeks_date_order",
);
await expectReject(
  `insert into public.sales_weeks (month_id, week_number, start_date, end_date)
     values ('${sept.id}', 0, '2026-09-01', '2026-09-07')`,
  "week_number 0 rejected",
  "sales_weeks_number_range",
);

// -----------------------------------------------------------------------------
console.log("\n[6] hms + seed");
// -----------------------------------------------------------------------------
await run(readFileSync(path.join(ROOT, "seed.sql"), "utf8"), "seed.sql applies");
await run(readFileSync(path.join(ROOT, "seed.sql"), "utf8"), "seed.sql is idempotent");

const hmCount = Number(
  (await one(`select count(*) as c from public.hms`)).c,
);
report(`4 sample HMs seeded, no duplicates on re-run (${hmCount})`, hmCount === 4);

await expectReject(
  `insert into public.hms (name, office) values ('   ', 'Office')`,
  "blank HM name rejected",
  "hms_name_not_blank",
);
await expectReject(
  `insert into public.hms (name, office, status) values ('X', 'Office', 'archived')`,
  "invalid HM status rejected",
  "hms_status_allowed",
);

// -----------------------------------------------------------------------------
console.log("\n[7] hm_monthly_performance: Extrade and Non-Extrade are independent");
// -----------------------------------------------------------------------------
const hm = await one(`select id from public.hms where name = 'Sample HM A'`);

await run(
  `insert into public.hm_monthly_performance
     (hm_id, month_id, net_units, target_net_units, recruitment, active_hp,
      shi_percentage, extrade_units, non_extrade_units)
   values ('${hm.id}', '${sept.id}', 40, 50, 3, 12, 87.50, 24, 16)`,
  "record accepted (24 + 16 = 40)",
);

await run(
  `update public.hm_monthly_performance set extrade_units = 30
     where hm_id = '${hm.id}' and month_id = '${sept.id}'`,
  "a split that no longer comes to Net is accepted (30 + 16 <> 40)",
);

await run(
  `update public.hm_monthly_performance
      set net_units = 65, extrade_units = 27, non_extrade_units = 24
    where hm_id = '${hm.id}' and month_id = '${sept.id}'`,
  "the worked example is accepted (Net 65, Extrade 27, Non-Extrade 24)",
);

await run(
  `update public.hm_monthly_performance
      set net_units = 0, extrade_units = 5, non_extrade_units = 0
    where hm_id = '${hm.id}' and month_id = '${sept.id}'`,
  "Net 0 with a real split is accepted",
);

await expectReject(
  `update public.hm_monthly_performance set extrade_units = -1
     where hm_id = '${hm.id}' and month_id = '${sept.id}'`,
  "a negative Extrade is still rejected",
  "hm_monthly_performance_extrade_natural",
);
await expectReject(
  `update public.hm_monthly_performance set non_extrade_units = -1
     where hm_id = '${hm.id}' and month_id = '${sept.id}'`,
  "a negative Non-Extrade is still rejected",
  "hm_monthly_performance_non_extrade_natural",
);

const splitConstraints = Number(
  (
    await one(`select count(*) as c from pg_constraint
                where conrelid = 'public.hm_monthly_performance'::regclass
                  and conname = 'hm_monthly_performance_extrade_split'`)
  ).c,
);
report("the Net-based split CHECK is gone", splitConstraints === 0);

await expectReject(
  `insert into public.hm_monthly_performance (hm_id, month_id)
     values ('${hm.id}', '${sept.id}')`,
  "duplicate hm+month rejected",
  "hm_monthly_performance_hm_month_key",
);
await expectReject(
  `update public.hm_monthly_performance set shi_percentage = 101
     where hm_id = '${hm.id}'`,
  "SHI above 100 rejected",
  "hm_monthly_performance_shi_range",
);
await expectReject(
  `update public.hm_monthly_performance set recruitment = -1 where hm_id = '${hm.id}'`,
  "negative recruitment rejected",
  "hm_monthly_performance_recruitment_natural",
);

const noPercentColumns = Number(
  (
    await one(`select count(*) as c from information_schema.columns
                where table_name = 'hm_monthly_performance'
                  and column_name in ('extrade_percentage', 'non_extrade_percentage')`)
  ).c,
);
report("no stored extrade/non-extrade percentages", noPercentColumns === 0);

const noMonthlyKeyin = Number(
  (
    await one(`select count(*) as c from information_schema.columns
                where table_name = 'hm_monthly_performance'
                  and column_name like '%keyin%'`)
  ).c,
);
report("no monthly key-in column (it is summed from weeks)", noMonthlyKeyin === 0);

// -----------------------------------------------------------------------------
console.log("\n[8] hm_weekly_performance + group_monthly_metrics");
// -----------------------------------------------------------------------------
const w1 = await one(
  `select id from public.sales_weeks where month_id = '${sept.id}' and week_number = 1`,
);
const w2 = await one(
  `select id from public.sales_weeks where month_id = '${sept.id}' and week_number = 2`,
);

await run(
  `insert into public.hm_weekly_performance (hm_id, week_id, keyin_units) values
     ('${hm.id}', '${w1.id}', 12), ('${hm.id}', '${w2.id}', 18)`,
  "weekly key-in accepted",
);
await expectReject(
  `insert into public.hm_weekly_performance (hm_id, week_id, keyin_units)
     values ('${hm.id}', '${w1.id}', 5)`,
  "duplicate hm+week rejected",
  "hm_weekly_performance_hm_week_key",
);
await expectReject(
  `insert into public.hm_weekly_performance (hm_id, week_id, keyin_units)
     values ('${hm.id}', '${w2.id}', -1)`,
  "negative key-in rejected",
  "hm_weekly_performance_keyin_natural",
);

const total = await one(
  `select coalesce(sum(keyin_units), 0) as total from public.hm_weekly_performance
     where hm_id = '${hm.id}'`,
);
report(
  "total key-in derives from the weekly rows (12 + 18 = 30)",
  Number(total.total) === 30,
  String(total.total),
);

await run(
  `insert into public.group_monthly_metrics (month_id, shi_percentage)
     values ('${sept.id}', 91.25)`,
  "group SHI accepted",
);
await expectReject(
  `insert into public.group_monthly_metrics (month_id, shi_percentage)
     values ('${sept.id}', 80)`,
  "second group SHI for the same month rejected",
  "group_monthly_metrics_month_id_key",
);
await expectReject(
  `insert into public.group_monthly_metrics (month_id, shi_percentage)
     values ((select id from public.months where year = 2026 and month = 8), 100.01)`,
  "group SHI above 100 rejected",
  "group_monthly_metrics_shi_range",
);

// -----------------------------------------------------------------------------
console.log("\n[9] profiles: auth trigger, role guard, audit stamping");
// -----------------------------------------------------------------------------
await run(
  `insert into auth.users (id, email, raw_user_meta_data) values
     ('11111111-1111-1111-1111-111111111111', 'manager@example.com',
      '{"full_name":"Test Manager","role":"manager"}'::jsonb),
     ('22222222-2222-2222-2222-222222222222', 'pa@example.com',
      '{"full_name":"Test PA","role":"pa"}'::jsonb),
     ('33333333-3333-3333-3333-333333333333', 'nometa@example.com', '{}'::jsonb)`,
  "auth users created",
);

const profiles = (
  await db.query(`select id, full_name, role from public.profiles order by full_name`)
).rows;
report(
  "profile auto-provisioned for each auth user",
  profiles.length === 3,
  JSON.stringify(profiles),
);
report(
  "role read from user metadata",
  profiles.find((p) => p.full_name === "Test Manager")?.role === "manager" &&
    profiles.find((p) => p.full_name === "Test PA")?.role === "pa",
);
const fallback = profiles.find((p) => p.full_name === "nometa");
report(
  "missing metadata falls back to email local-part + least privilege",
  fallback?.role === "pa",
  JSON.stringify(fallback),
);

await expectReject(
  `update public.profiles set role = 'chief' where full_name = 'Test PA'`,
  "invalid role rejected",
  "profiles_role_allowed",
);

// Impersonate the PA and try to self-promote.
await db.exec(
  `select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false)`,
);
report(
  "is_staff() true for the PA",
  (await one(`select public.is_staff() as v`)).v === true,
);
report(
  "is_manager() false for the PA",
  (await one(`select public.is_manager() as v`)).v === false,
);
await expectReject(
  `update public.profiles set role = 'manager'
     where id = '22222222-2222-2222-2222-222222222222'`,
  "PA cannot self-promote to manager",
  "Only a manager can change a profile role",
);
await expectReject(
  `update public.profiles set is_active = false
     where id = '11111111-1111-1111-1111-111111111111'`,
  "PA cannot deactivate another profile",
  "Only a manager can activate or deactivate a profile",
);

// Audit stamping while impersonating the PA.
const augustId = (
  await one(`select id from public.months where year = 2026 and month = 8`)
).id;
const hmB = await one(`select id from public.hms where name = 'Sample HM B'`);
await run(
  `insert into public.hm_monthly_performance
     (hm_id, month_id, net_units, extrade_units, non_extrade_units, created_by, updated_by)
   values ('${hmB.id}', '${augustId}', 10, 6, 4,
           '11111111-1111-1111-1111-111111111111',
           '11111111-1111-1111-1111-111111111111')`,
  "insert with a forged created_by accepted",
);
const audited = await one(
  `select created_by, updated_by, created_at, updated_at
     from public.hm_monthly_performance where hm_id = '${hmB.id}'`,
);
report(
  "created_by/updated_by overridden with the real actor, not the forged id",
  audited.created_by === "22222222-2222-2222-2222-222222222222" &&
    audited.updated_by === "22222222-2222-2222-2222-222222222222",
  JSON.stringify(audited),
);

// Now impersonate the manager and update the same row.
await db.exec(
  `select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false)`,
);
report(
  "is_manager() true for the manager",
  (await one(`select public.is_manager() as v`)).v === true,
);
await run(
  `update public.hm_monthly_performance set net_units = 12, extrade_units = 7, non_extrade_units = 5
     where hm_id = '${hmB.id}'`,
);
const after = await one(
  `select created_by, updated_by, created_at < updated_at as bumped
     from public.hm_monthly_performance where hm_id = '${hmB.id}'`,
);
report(
  "update preserves created_by, moves updated_by to the manager",
  after.created_by === "22222222-2222-2222-2222-222222222222" &&
    after.updated_by === "11111111-1111-1111-1111-111111111111",
  JSON.stringify(after),
);
report("updated_at advanced past created_at", after.bumped === true);

// Manager may change roles.
await run(
  `update public.profiles set role = 'manager'
     where id = '22222222-2222-2222-2222-222222222222'`,
  "manager can change another profile's role",
);

// Deactivated profile loses staff status.
await db.exec(
  `update public.profiles set is_active = false
     where id = '22222222-2222-2222-2222-222222222222'`,
);
await db.exec(
  `select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false)`,
);
report(
  "deactivated profile: is_staff() false, role NULL",
  (await one(`select public.is_staff() as v`)).v === false &&
    (await one(`select public.current_profile_role() as v`)).v === null,
);

// Anonymous caller.
await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
report(
  "anonymous caller: is_staff() false",
  (await one(`select public.is_staff() as v`)).v === false,
);

// -----------------------------------------------------------------------------
console.log("\n[10] RLS enforcement as the authenticated role");
// -----------------------------------------------------------------------------

/** Superuser statement with no impersonated actor (clears the JWT GUC first). */
async function asSuperuser(sql) {
  await db.exec(`reset role`);
  await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
  return db.query(sql);
}

await asSuperuser(`select 1`);

const MGR = "44444444-4444-4444-4444-444444444444";
const PA = "55555555-5555-5555-5555-555555555555";

await asSuperuser(`
  insert into auth.users (id, email, raw_user_meta_data) values
    ('${MGR}', 'rls-manager@example.com', '{"full_name":"RLS Manager","role":"manager"}'::jsonb),
    ('${PA}',  'rls-pa@example.com',      '{"full_name":"RLS PA","role":"pa"}'::jsonb)
`);

/** Runs SQL inside `set role authenticated` as the given actor. */
async function asUser(actorId, sql) {
  await db.exec(
    `select set_config('request.jwt.claim.sub', '${actorId}', false)`,
  );
  await db.exec(`set role authenticated`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec(`reset role`);
  }
}

async function allowed(actorId, sql, label) {
  try {
    await asUser(actorId, sql);
    report(label, true);
  } catch (e) {
    report(label, false, e.message);
  }
}

/**
 * INSERT and UPDATE WITH CHECK violations raise. SELECT / UPDATE / DELETE USING
 * violations do NOT - RLS simply filters the rows out, so the statement
 * succeeds having touched nothing. Both count as denial; the caller says which
 * shape to expect.
 */
async function deniedSilently(actorId, sql, label) {
  try {
    const res = await asUser(actorId, sql);
    const touched = res?.affectedRows ?? res?.rows?.length ?? 0;
    report(label, touched === 0, `touched ${touched} rows`);
  } catch {
    report(label, true);
  }
}

async function deniedLoudly(actorId, sql, label) {
  try {
    await asUser(actorId, sql);
    report(label, false, "statement was accepted but should have raised");
  } catch {
    report(label, true);
  }
}

// --- reads -------------------------------------------------------------------
await allowed(PA, `select * from public.hms`, "PA can read the HM list");
await allowed(MGR, `select * from public.hms`, "manager can read the HM list");
await allowed(
  PA,
  `select * from public.hm_monthly_performance`,
  "PA can read monthly performance",
);
await allowed(PA, `select * from public.group_monthly_metrics`, "PA can read group SHI");

const paSeesProfiles = await asUser(PA, `select id from public.profiles`);
report(
  "PA sees only their own profile",
  paSeesProfiles.rows.length === 1 && paSeesProfiles.rows[0].id === PA,
  JSON.stringify(paSeesProfiles.rows.map((r) => r.id)),
);
const mgrSeesProfiles = await asUser(MGR, `select id from public.profiles`);
report(
  "manager sees every profile",
  mgrSeesProfiles.rows.length >= 5,
  `${mgrSeesProfiles.rows.length} profiles`,
);

// --- writes the PA owns ------------------------------------------------------
const octId = (
  await one(`select id from public.months where year = 2026 and month = 10`)
).id;
const hmC = (await one(`select id from public.hms where name = 'Sample HM C'`)).id;

await allowed(
  PA,
  `insert into public.hms (name, office) values ('PA Added HM', 'Sample Office')`,
  "PA can add an HM",
);
await allowed(
  PA,
  `update public.hms set status = 'inactive' where name = 'PA Added HM'`,
  "PA can deactivate an HM",
);
await allowed(
  PA,
  `insert into public.hm_monthly_performance
     (hm_id, month_id, net_units, extrade_units, non_extrade_units)
   values ('${hmC}', '${octId}', 8, 5, 3)`,
  "PA can key in monthly performance",
);
await allowed(
  PA,
  `insert into public.sales_weeks (month_id, week_number, start_date, end_date)
     values ('${octId}', 1, '2026-10-03', '2026-10-09')`,
  "PA can configure the sales calendar",
);
await allowed(
  PA,
  `delete from public.sales_weeks where month_id = '${octId}' and week_number = 1`,
  "PA can remove a mis-entered sales week",
);

// --- deletes reserved for the manager ----------------------------------------
await deniedSilently(
  PA,
  `delete from public.hm_monthly_performance where hm_id = '${hmC}'`,
  "PA's delete of performance history touches no rows",
);
report(
  "the performance row survived the PA's delete",
  Number(
    (
      await asSuperuser(
        `select count(*) as c from public.hm_monthly_performance where hm_id = '${hmC}'`,
      )
    ).rows[0].c,
  ) === 1,
);

await deniedSilently(
  PA,
  `delete from public.hms where name = 'PA Added HM'`,
  "PA's delete of an HM touches no rows",
);
report(
  "the HM record survived the PA's delete",
  Number(
    (
      await asSuperuser(
        `select count(*) as c from public.hms where name = 'PA Added HM'`,
      )
    ).rows[0].c,
  ) === 1,
);

const mgrDelPerf = await asUser(
  MGR,
  `delete from public.hm_monthly_performance where hm_id = '${hmC}'`,
);
report(
  "manager can delete performance history",
  (mgrDelPerf.affectedRows ?? 0) === 1,
  `affected ${mgrDelPerf.affectedRows}`,
);

const mgrDelHm = await asUser(
  MGR,
  `delete from public.hms where name = 'PA Added HM'`,
);
report(
  "manager can delete an HM record",
  (mgrDelHm.affectedRows ?? 0) === 1,
  `affected ${mgrDelHm.affectedRows}`,
);

// --- deactivated staff lose everything ---------------------------------------
await asSuperuser(
  `update public.profiles set is_active = false where id = '${PA}'`,
);
await deniedSilently(PA, `select * from public.hms`, "deactivated PA reads no HM rows");
await deniedLoudly(
  PA,
  `insert into public.hms (name, office) values ('Ghost', 'Nowhere')`,
  "deactivated PA cannot insert",
);
await asSuperuser(
  `update public.profiles set is_active = true where id = '${PA}'`,
);

// --- a PA cannot escalate through the profiles self-update policy -------------
await deniedLoudly(
  PA,
  `update public.profiles set role = 'manager' where id = '${PA}'`,
  "PA cannot self-promote through the self-update policy",
);

// --- the sales-week cascade, closed in the database (Stage 7) -----------------
//
// `sales_weeks.id` cascades into `hm_weekly_performance`, and a cascade runs as
// the table owner rather than as the caller - so deleting a week removes Key-In
// WITHOUT consulting `hm_weekly_performance_delete_manager`. Stage 2 guarded
// that in `deleteSalesWeekAction`; Stage 7 puts the same rule in the database,
// where a PA holding the anon key and a real JWT cannot route around it.
//
// The rule is exactly the application's: an EMPTY week is still a PA's to
// remove (the mistyped-period case), a week holding Key-In is manager-only.

await asSuperuser(`select 1`);

const guardWeeks = (
  await asSuperuser(
    `insert into public.sales_weeks (month_id, week_number, start_date, end_date) values
       ('${octId}', 5, '2026-10-24', '2026-10-30'),
       ('${octId}', 6, '2026-10-31', '2026-11-06')
     returning id, week_number`,
  )
).rows;
const guardEmptyWeek = guardWeeks.find((w) => Number(w.week_number) === 5).id;
const guardFullWeek = guardWeeks.find((w) => Number(w.week_number) === 6).id;

const guardHm = (
  await asSuperuser(
    `insert into public.hms (name, office) values ('Cascade Guard HM', 'Sample Office')
     returning id`,
  )
).rows[0].id;

await asSuperuser(
  `insert into public.hm_weekly_performance (hm_id, week_id, keyin_units)
     values ('${guardHm}', '${guardFullWeek}', 17)`,
);

await allowed(
  PA,
  `delete from public.sales_weeks where id = '${guardEmptyWeek}'`,
  "PA can still delete a sales week that holds no Key-In",
);

await deniedLoudly(
  PA,
  `delete from public.sales_weeks where id = '${guardFullWeek}'`,
  "PA's delete of a sales week holding Key-In is REFUSED, not silently filtered",
);

report(
  "the Key-In behind that week survived the PA's delete",
  Number(
    (
      await asSuperuser(
        `select count(*) as c from public.hm_weekly_performance where week_id = '${guardFullWeek}'`,
      )
    ).rows[0].c,
  ) === 1,
);

const mgrDelWeek = await asUser(
  MGR,
  `delete from public.sales_weeks where id = '${guardFullWeek}'`,
);
report(
  "a manager can still delete a sales week holding Key-In",
  (mgrDelWeek.affectedRows ?? 0) === 1,
  `affected ${mgrDelWeek.affectedRows}`,
);
report(
  "and the cascade still removed its Key-In",
  Number(
    (
      await asSuperuser(
        `select count(*) as c from public.hm_weekly_performance where week_id = '${guardFullWeek}'`,
      )
    ).rows[0].c,
  ) === 0,
);

await asSuperuser(`delete from public.hms where id = '${guardHm}'`);

// --- anon is locked out at the grant level -----------------------------------
await asSuperuser(`select 1`);
await db.exec(`set role anon`);
let anonBlocked = false;
try {
  await db.query(`select * from public.hms`);
} catch {
  anonBlocked = true;
}
await db.exec(`reset role`);
report("anon cannot read public.hms (privileges revoked)", anonBlocked);

await asSuperuser(`select 1`);

// -----------------------------------------------------------------------------
console.log("\n[11] sales_weeks: the DEFERRED overlap constraint (Stage 2)");
// -----------------------------------------------------------------------------
//
// The trigger is DEFERRABLE INITIALLY DEFERRED on purpose. An ordinary EXCLUDE
// constraint would reject a legitimate mid-edit state: shifting every week of a
// month forward by a day means the first UPDATE momentarily overlaps its
// neighbour. Checking at COMMIT instead judges the finished calendar as a whole,
// which is how the PA actually edits it.

await asSuperuser(`select 1`);

const jan27 = (
  await asSuperuser(
    `insert into public.months (year, month, label, quarter)
       values (2027, 1, '', 1) returning id`,
  )
).rows[0];

await run(
  `insert into public.sales_weeks (month_id, week_number, start_date, end_date) values
     ('${jan27.id}', 1, '2026-12-28', '2027-01-03'),
     ('${jan27.id}', 2, '2027-01-04', '2027-01-10')`,
  "back-to-back periods commit cleanly",
);

await expectReject(
  `insert into public.sales_weeks (month_id, week_number, start_date, end_date)
     values ('${jan27.id}', 3, '2027-01-08', '2027-01-14')`,
  "an overlapping period is rejected",
  "sales_weeks_no_overlap",
);

await expectReject(
  `insert into public.sales_weeks (month_id, week_number, start_date, end_date)
     values ('${jan27.id}', 3, '2027-01-10', '2027-01-16')`,
  "sharing a single day is an overlap",
  "sales_weeks_no_overlap",
);

// The interesting one. After the first UPDATE, W1 ends on the 4th while W2 still
// starts on the 4th - an overlap. An immediate constraint would abort right
// there; the deferred one waits for COMMIT, by which point the set is clean.
await run(
  `begin;
   update public.sales_weeks set start_date = '2026-12-29', end_date = '2027-01-04'
     where month_id = '${jan27.id}' and week_number = 1;
   update public.sales_weeks set start_date = '2027-01-05', end_date = '2027-01-11'
     where month_id = '${jan27.id}' and week_number = 2;
   commit;`,
  "a whole-calendar reshuffle passes through an overlapping intermediate state",
);

const reshuffled = await one(
  `select start_date::text as s, end_date::text as e from public.sales_weeks
     where month_id = '${jan27.id}' and week_number = 1`,
);
report(
  "the reshuffle actually applied",
  reshuffled.s === "2026-12-29" && reshuffled.e === "2027-01-04",
  JSON.stringify(reshuffled),
);

// Deferral moves the check; it does not weaken it. A transaction that ends
// overlapping is still refused.
let deferredRejected = false;
try {
  await db.exec(
    `begin;
     update public.sales_weeks set end_date = '2027-01-08'
       where month_id = '${jan27.id}' and week_number = 1;
     commit;`,
  );
} catch {
  deferredRejected = true;
}
try {
  await db.exec(`rollback`);
} catch {
  // Already rolled back by the failed commit.
}
report(
  "a transaction that COMMITS overlapping is still rejected",
  deferredRejected,
);

const stillClean = await one(
  `select end_date::text as e from public.sales_weeks
     where month_id = '${jan27.id}' and week_number = 1`,
);
report(
  "the rejected transaction left the calendar untouched",
  stillClean.e === "2027-01-04",
  JSON.stringify(stillClean),
);

await run(
  `insert into public.sales_weeks (month_id, week_number, start_date, end_date)
     values ('${jan27.id}', 5, '2027-01-26', '2027-01-31'),
            ('${jan27.id}', 6, '2027-02-01', '2027-02-04')`,
  "W5 and W6 are legitimate periods, not an error",
);

// -----------------------------------------------------------------------------
console.log("\n[12] upsert paths used by the data-entry grid (Stage 2)");
// -----------------------------------------------------------------------------
//
// These are the statements supabase-js `.upsert(rows, { onConflict })` compiles
// to. The grid saves a whole month in one of each, so a second save has to
// update rather than duplicate.

const gridHm = (await one(`select id from public.hms where name = 'Sample HM C'`))
  .id;
const gridWeek1 = (
  await one(
    `select id from public.sales_weeks where month_id = '${jan27.id}' and week_number = 1`,
  )
).id;
const gridWeek2 = (
  await one(
    `select id from public.sales_weeks where month_id = '${jan27.id}' and week_number = 2`,
  )
).id;

const MONTHLY_UPSERT = (net, target, recruit, hp, shi, extrade, nonExtrade) => `
  insert into public.hm_monthly_performance
    (hm_id, month_id, net_units, target_net_units, recruitment, active_hp,
     shi_percentage, extrade_units, non_extrade_units)
  values ('${gridHm}', '${jan27.id}', ${net}, ${target}, ${recruit}, ${hp},
          ${shi}, ${extrade}, ${nonExtrade})
  on conflict (hm_id, month_id) do update set
    net_units         = excluded.net_units,
    target_net_units  = excluded.target_net_units,
    recruitment       = excluded.recruitment,
    active_hp         = excluded.active_hp,
    shi_percentage    = excluded.shi_percentage,
    extrade_units     = excluded.extrade_units,
    non_extrade_units = excluded.non_extrade_units`;

await run(
  MONTHLY_UPSERT(72, 100, 6, 31, 78.0, 28, 44),
  "monthly upsert inserts on the first save",
);
await run(
  MONTHLY_UPSERT(80, 100, 7, 33, 79.5, 30, 50),
  "monthly upsert updates on the second save",
);

const monthlyRows = await one(
  `select count(*) as c, max(net_units) as net from public.hm_monthly_performance
     where hm_id = '${gridHm}' and month_id = '${jan27.id}'`,
);
report(
  "one row, not two, carrying the newer figures",
  Number(monthlyRows.c) === 1 && Number(monthlyRows.net) === 80,
  JSON.stringify(monthlyRows),
);

await run(
  MONTHLY_UPSERT(90, 100, 7, 33, 79.5, 30, 50),
  "an upsert whose split does not come to Net is accepted",
);

await run(
  `insert into public.hm_weekly_performance (hm_id, week_id, keyin_units) values
     ('${gridHm}', '${gridWeek1}', 20),
     ('${gridHm}', '${gridWeek2}', 18)
   on conflict (hm_id, week_id) do update set keyin_units = excluded.keyin_units`,
  "weekly upsert writes both cells in one statement",
);
await run(
  `insert into public.hm_weekly_performance (hm_id, week_id, keyin_units) values
     ('${gridHm}', '${gridWeek1}', 22)
   on conflict (hm_id, week_id) do update set keyin_units = excluded.keyin_units`,
  "weekly upsert corrects a figure rather than duplicating it",
);

const keyin = await one(
  `select count(*) as c, coalesce(sum(w.keyin_units), 0) as total
     from public.hm_weekly_performance w
     join public.sales_weeks s on s.id = w.week_id
    where w.hm_id = '${gridHm}' and s.month_id = '${jan27.id}'`,
);
report(
  "two weekly rows, and monthly Key-In derives as 22 + 18 = 40",
  Number(keyin.c) === 2 && Number(keyin.total) === 40,
  JSON.stringify(keyin),
);

await run(
  `insert into public.group_monthly_metrics (month_id, shi_percentage)
     values ('${jan27.id}', 72.00)
   on conflict (month_id) do update set shi_percentage = excluded.shi_percentage`,
  "group SHI upsert inserts",
);
await run(
  `insert into public.group_monthly_metrics (month_id, shi_percentage)
     values ('${jan27.id}', 74.25)
   on conflict (month_id) do update set shi_percentage = excluded.shi_percentage`,
  "group SHI upsert updates instead of failing the unique constraint",
);

const groupShi = await one(
  `select count(*) as c, max(shi_percentage) as shi from public.group_monthly_metrics
     where month_id = '${jan27.id}'`,
);
report(
  "one group SHI row per month, holding the latest eTrust figure",
  Number(groupShi.c) === 1 && Number(groupShi.shi) === 74.25,
  JSON.stringify(groupShi),
);

// -----------------------------------------------------------------------------
console.log("\n[13] history survives deactivation; week deletes cascade (Stage 2)");
// -----------------------------------------------------------------------------

await run(
  `update public.hms set status = 'inactive' where id = '${gridHm}'`,
  "an HM can be deactivated",
);

const afterDeactivation = await one(
  `select
     (select count(*) from public.hm_monthly_performance where hm_id = '${gridHm}') as monthly,
     (select count(*) from public.hm_weekly_performance where hm_id = '${gridHm}') as weekly`,
);
report(
  "deactivating an HM deletes NO performance history",
  Number(afterDeactivation.monthly) >= 1 &&
    Number(afterDeactivation.weekly) === 2,
  JSON.stringify(afterDeactivation),
);

await run(`update public.hms set status = 'active' where id = '${gridHm}'`);

// This cascade is why deleteSalesWeekAction refuses to remove a week holding
// Key-In unless the caller is a manager AND confirms: a cascade runs as the
// table owner, so it slips past the manager-only delete policy on the
// performance table.
const beforeCascade = Number(
  (
    await one(
      `select count(*) as c from public.hm_weekly_performance where week_id = '${gridWeek2}'`,
    )
  ).c,
);
await run(`delete from public.sales_weeks where id = '${gridWeek2}'`);
const afterCascade = Number(
  (
    await one(
      `select count(*) as c from public.hm_weekly_performance where week_id = '${gridWeek2}'`,
    )
  ).c,
);
report(
  "deleting a sales week cascades into its Key-In (guarded in the action layer)",
  beforeCascade === 1 && afterCascade === 0,
  `before ${beforeCascade}, after ${afterCascade}`,
);

report(
  "the other week's Key-In is untouched",
  Number(
    (
      await one(
        `select count(*) as c from public.hm_weekly_performance where week_id = '${gridWeek1}'`,
      )
    ).c,
  ) === 1,
);

// -----------------------------------------------------------------------------
console.log("\n[14] Stage 2 authorization on the new write paths");
// -----------------------------------------------------------------------------

await allowed(
  PA,
  `insert into public.months (year, month, label, quarter) values (2027, 2, '', 1)`,
  "PA can open a reporting month",
);
await allowed(
  PA,
  `insert into public.sales_weeks (month_id, week_number, start_date, end_date)
     values ('${jan27.id}', 2, '2027-01-05', '2027-01-11')`,
  "PA can add a sales week",
);
await allowed(
  PA,
  `insert into public.group_monthly_metrics (month_id, shi_percentage)
     values ('${jan27.id}', 75.00)
   on conflict (month_id) do update set shi_percentage = excluded.shi_percentage`,
  "PA can upsert the group SHI",
);
await deniedSilently(
  PA,
  `delete from public.hm_weekly_performance where week_id = '${gridWeek1}'`,
  "PA's direct delete of weekly Key-In touches no rows",
);
report(
  "the weekly Key-In survived the PA's delete",
  Number(
    (
      await asSuperuser(
        `select count(*) as c from public.hm_weekly_performance where week_id = '${gridWeek1}'`,
      )
    ).rows[0].c,
  ) === 1,
);
await deniedLoudly(
  PA,
  `update public.profiles set role = 'manager' where id = '${PA}'`,
  "PA still cannot change their own role (Stage 1 guard intact)",
);

await asSuperuser(`select 1`);


// -----------------------------------------------------------------------------
console.log("\n[15] share_links + resolve_share_report (Stage 6)");


// -----------------------------------------------------------------------------
//
// The one place in this schema where an UNAUTHENTICATED caller gets anything at
// all, so it is tested from the outside: as `anon`, holding nothing but a
// string, exactly as a WhatsApp recipient would be.
//
// The properties being proved are the ones a TypeScript test cannot reach - a
// revoked token really stops resolving, an expired one really does, a token
// bound to March cannot be made to return April, and `anon` still cannot touch
// a single table.

await asSuperuser(`select 1`);

/** A well-formed token. 43 base64url characters, like the real generator emits. */
const shareToken = (seed) => `${seed}`.padEnd(43, "x").slice(0, 43);

const TOKEN_LIVE = shareToken("live_september_token_");
const TOKEN_REVOKED = shareToken("revoked_token_");
const TOKEN_EXPIRED = shareToken("expired_token_");
const TOKEN_OTHER_MONTH = shareToken("other_month_token_");

// --- two months, so "a token cannot reach another month" is testable ---------
const shareMonthA = (
  await asSuperuser(
    `insert into public.months (year, month, label, quarter)
       values (2027, 3, '', 1) returning id`,
  )
).rows[0];

const shareMonthB = (
  await asSuperuser(
    `insert into public.months (year, month, label, quarter)
       values (2027, 4, '', 2) returning id`,
  )
).rows[0];

const shareHm = (
  await asSuperuser(
    `insert into public.hms (name, office, display_order)
       values ('Sample HM Share', 'Sample Office', 90) returning id`,
  )
).rows[0];

const shareWeekA = (
  await asSuperuser(
    `insert into public.sales_weeks (month_id, week_number, start_date, end_date)
       values ('${shareMonthA.id}', 1, '2027-02-28', '2027-03-06') returning id`,
  )
).rows[0];

await asSuperuser(
  `insert into public.sales_weeks (month_id, week_number, start_date, end_date)
     values ('${shareMonthB.id}', 1, '2027-03-28', '2027-04-03')`,
);

await asSuperuser(
  `insert into public.hm_monthly_performance
     (hm_id, month_id, net_units, target_net_units, recruitment, active_hp,
      shi_percentage, extrade_units, non_extrade_units)
   values ('${shareHm.id}', '${shareMonthA.id}', 42, 50, 3, 21, 71.50, 12, 30)`,
);

await asSuperuser(
  `insert into public.hm_weekly_performance (hm_id, week_id, keyin_units)
     values ('${shareHm.id}', '${shareWeekA.id}', 18)`,
);

await asSuperuser(
  `insert into public.group_monthly_metrics (month_id, shi_percentage)
     values ('${shareMonthA.id}', 68.25)`,
);

// April gets a figure of its own, so a leak across months would be visible.
await asSuperuser(
  `insert into public.hm_monthly_performance
     (hm_id, month_id, net_units, non_extrade_units)
   values ('${shareHm.id}', '${shareMonthB.id}', 999, 999)`,
);

// --- creating links ----------------------------------------------------------
await allowed(
  PA,
  `insert into public.share_links (token, month_id)
     values ('${TOKEN_LIVE}', '${shareMonthA.id}')`,
  "PA can create a share link",
);

report(
  "created_by is stamped from auth.uid(), not left null or client-supplied",
  (
    await one(
      `select created_by from public.share_links where token = '${TOKEN_LIVE}'`,
    )
  ).created_by === PA,
);

await expectReject(
  `insert into public.share_links (token, month_id)
     values ('${TOKEN_LIVE}', '${shareMonthB.id}')`,
  "a token cannot be reused for a second month",
  "share_links_token_key",
);

await expectReject(
  `insert into public.share_links (token, month_id)
     values ('short', '${shareMonthA.id}')`,
  "a short token is rejected",
  "share_links_token_length",
);

await expectReject(
  `insert into public.share_links (token, month_id)
     values ('${shareMonthA.id}', '${shareMonthA.id}')`,
  "a month id is rejected as a token",
  "share_links_token_not_uuid",
);

await expectReject(
  `insert into public.share_links (token, month_id)
     values ('this+token/has=padding+and+slashes+in+it', '${shareMonthA.id}')`,
  "a padded base64 string is rejected as a token",
  "share_links_token_shape",
);

await expectReject(
  `insert into public.share_links (token, month_id, is_active, revoked_at)
     values ('${shareToken("inconsistent_")}', '${shareMonthA.id}', true, now())`,
  "a link cannot be active and revoked at the same time",
  "share_links_revocation_consistent",
);

// --- resolving as anon -------------------------------------------------------

/** Runs SQL as the anonymous role, which is what a share-link visitor is. */
async function asAnon(sql) {
  await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
  await db.exec(`set role anon`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec(`reset role`);
  }
}

const resolved = (
  await asAnon(
    `select public.resolve_share_report('${TOKEN_LIVE}') as body`,
  )
).rows[0].body;

report("anon can resolve a live token", resolved !== null);

report(
  "and gets the token's month, with its label",
  resolved?.month?.label === "March 2027",
  JSON.stringify(resolved?.month),
);

report(
  "the month's figures come back",
  resolved?.monthly?.length === 1 && Number(resolved.monthly[0].net_units) === 42,
  JSON.stringify(resolved?.monthly),
);

report(
  "so does the weekly Key-In",
  resolved?.weekly?.length === 1 && Number(resolved.weekly[0].keyin_units) === 18,
);

report(
  "and the group SHI, read rather than derived",
  Number(resolved?.group_shi_pct) === 68.25,
  String(resolved?.group_shi_pct),
);

report(
  "the freshness stamp is the data's own",
  typeof resolved?.last_updated_at === "string",
  String(resolved?.last_updated_at),
);

// --- the projection carries nothing it should not -----------------------------
const serialised = JSON.stringify(resolved);

report(
  "no created_by in the projection",
  !serialised.includes("created_by"),
);
report(
  "no updated_by in the projection",
  !serialised.includes("updated_by"),
);
report(
  "no performance row ids",
  resolved.monthly.every((row) => row.id === undefined) &&
    resolved.weekly.every((row) => row.id === undefined),
);
report(
  "no profile, email or auth field anywhere",
  !serialised.includes("full_name") &&
    !serialised.includes("email") &&
    !serialised.includes("role"),
);
report(
  "and no token is echoed back",
  !serialised.includes(TOKEN_LIVE),
);

// --- a token reaches its own month and no other -------------------------------
report(
  // On the PARSED rows, never on a substring of the serialized payload: "999"
  // is three hex digits, so it also matches a uuid, and it matches the
  // fractional seconds of a timestamp ending `.999`. Both have made this
  // assertion fail against perfectly correct data.
  "April's figure does not appear in March's report",
  resolved?.month?.label === "March 2027" &&
    (resolved.monthly ?? []).every(
      (row) =>
        Number(row.net_units) !== 999 && Number(row.target_net_units) !== 999,
    ),
  serialised.slice(0, 200),
);

await asSuperuser(
  `insert into public.share_links (token, month_id)
     values ('${TOKEN_OTHER_MONTH}', '${shareMonthB.id}')`,
);

const april = (
  await asAnon(
    `select public.resolve_share_report('${TOKEN_OTHER_MONTH}') as body`,
  )
).rows[0].body;

report(
  "April's own token returns April, not March",
  april?.month?.label === "April 2027" &&
    Number(april.monthly[0].net_units) === 999 &&
    // March's own figure, checked as a NUMBER rather than as `"net_units": 42`
    // in the serialized text - that depended on the exact key spacing the JSON
    // serializer happened to use.
    (april.monthly ?? []).every((row) => Number(row.net_units) !== 42),
  JSON.stringify(april?.month),
);

// The token IS the month binding, and it is frozen after issue - so there is no
// parameter, and no update, that can point a circulated link somewhere else.
await deniedLoudly(
  PA,
  `update public.share_links set month_id = '${shareMonthB.id}'
     where token = '${TOKEN_LIVE}'`,
  "a circulated token cannot be repointed at another month",
);

await deniedLoudly(
  PA,
  `update public.share_links set token = '${shareToken("swapped_")}'
     where token = '${TOKEN_LIVE}'`,
  "and its token cannot be swapped",
);

// --- tokens that must not resolve ---------------------------------------------
async function resolvesToNull(token, label) {
  const row = (
    await asAnon(
      `select public.resolve_share_report(${token}) as body`,
    )
  ).rows[0];

  report(label, row.body === null, JSON.stringify(row.body)?.slice(0, 120));
}

await resolvesToNull(`'${shareToken("never_issued_")}'`, "a token that was never issued resolves to nothing");
await resolvesToNull(`'${shareMonthA.id}'`, "a month id used as a token resolves to nothing");
await resolvesToNull(`'${shareHm.id}'`, "an HM id used as a token resolves to nothing");
await resolvesToNull(`''`, "an empty token resolves to nothing");
await resolvesToNull(`'2027-03'`, "a month parameter used as a token resolves to nothing");
await resolvesToNull(`null`, "a null token resolves to nothing");
await resolvesToNull(
  `'${TOKEN_LIVE.slice(0, 42)}'`,
  "a token one character short resolves to nothing",
);
await resolvesToNull(
  `'${TOKEN_LIVE.toUpperCase()}'`,
  "a case-altered token resolves to nothing",
);

// --- revocation ---------------------------------------------------------------
await asSuperuser(
  `insert into public.share_links (token, month_id)
     values ('${TOKEN_REVOKED}', '${shareMonthA.id}')`,
);

report(
  "a second link resolves while it is active",
  (
    await asAnon(
      `select public.resolve_share_report('${TOKEN_REVOKED}') as body`,
    )
  ).rows[0].body !== null,
);

await allowed(
  PA,
  `update public.share_links set is_active = false, revoked_at = now()
     where token = '${TOKEN_REVOKED}'`,
  "PA can revoke a share link",
);

await resolvesToNull(
  `'${TOKEN_REVOKED}'`,
  "a revoked token stops resolving immediately",
);

report(
  "revoking touched no performance data",
  Number(
    (
      await one(
        `select count(*) as c from public.hm_monthly_performance
          where month_id = '${shareMonthA.id}'`,
      )
    ).c,
  ) === 1,
);

report(
  "and the revoked row is kept, so the audit trail survives",
  Number(
    (
      await one(
        `select count(*) as c from public.share_links where token = '${TOKEN_REVOKED}'`,
      )
    ).c,
  ) === 1,
);

report(
  "the live token is unaffected by the other being revoked",
  (
    await asAnon(`select public.resolve_share_report('${TOKEN_LIVE}') as body`)
  ).rows[0].body !== null,
);

// --- expiry --------------------------------------------------------------------
// Time cannot be advanced inside the test, so it is simulated by shortening the
// expiry to just after the moment the link was created - which is what an
// already-elapsed lifetime looks like, and which the CHECK allows because it
// only forbids an expiry EARLIER than creation.
await asSuperuser(
  `insert into public.share_links (token, month_id, expires_at)
     values ('${TOKEN_EXPIRED}', '${shareMonthA.id}', now() + interval '1 day')`,
);

report(
  "a link with a future expiry resolves",
  (
    await asAnon(`select public.resolve_share_report('${TOKEN_EXPIRED}') as body`)
  ).rows[0].body !== null,
);

await expectReject(
  `update public.share_links set expires_at = created_at - interval '1 second'
     where token = '${TOKEN_EXPIRED}'`,
  "an expiry cannot be moved to before the link existed",
  "share_links_expiry_after_creation",
);

await asSuperuser(
  `update public.share_links set expires_at = created_at + interval '1 millisecond'
     where token = '${TOKEN_EXPIRED}'`,
);

await resolvesToNull(
  `'${TOKEN_EXPIRED}'`,
  "an expired token stops resolving, without being revoked",
);

await expectReject(
  `insert into public.share_links (token, month_id, expires_at)
     values ('${shareToken("born_dead_")}', '${shareMonthA.id}', now() - interval '1 day')`,
  "a link cannot be created already expired",
  "share_links_expiry_after_creation",
);

// --- audit ----------------------------------------------------------------------
report(
  "resolving stamps last_accessed_at",
  (
    await one(
      `select last_accessed_at from public.share_links where token = '${TOKEN_LIVE}'`,
    )
  ).last_accessed_at !== null,
);

// -----------------------------------------------------------------------------
// resolve_share_hm_report: the same token, narrowed to one HM
// -----------------------------------------------------------------------------
//
// The second - and last - function anon may execute. Everything the group
// resolver has to get right, it has to get right too, so the gate is re-tested
// from the outside rather than assumed to be shared. What is new here is the
// narrowing: it must refuse an HM the token's month is not about, and the
// context months it adds must carry ONE HM's figures and nobody else's.

await asSuperuser(`select 1`);

// February 2027: the month before the token's, and part of the same quarter -
// so it is what month-over-month and QTD are counted from.
// `on conflict do nothing` because an earlier section may already have opened
// this month: what matters here is that February exists, not who created it.
await asSuperuser(
  `insert into public.months (year, month, label, quarter)
     values (2027, 2, '', 1)
   on conflict (year, month) do nothing`,
);

const shareMonthPrev = await one(
  `select id from public.months where year = 2027 and month = 2`,
);

// A second HM with a February figure. It must never appear in the first HM's
// context, which is the whole point of the narrowing.
const shareHmOther = (
  await asSuperuser(
    `insert into public.hms (name, office, display_order)
       values ('Sample HM Other', 'Sample Office', 91) returning id`,
  )
).rows[0];

// An active HM with nothing keyed in for the token's month: on the report as a
// missing record, so openable - and blank rather than absent.
const shareHmIdle = (
  await asSuperuser(
    `insert into public.hms (name, office, display_order)
       values ('Sample HM Idle', 'Sample Office', 92) returning id`,
  )
).rows[0];

// An inactive HM with nothing for the month: not on the report at all.
const shareHmGone = (
  await asSuperuser(
    `insert into public.hms (name, office, display_order, status)
       values ('Sample HM Gone', 'Sample Office', 93, 'inactive') returning id`,
  )
).rows[0];

await asSuperuser(
  `insert into public.hm_monthly_performance
     (hm_id, month_id, net_units, target_net_units, recruitment, active_hp,
      shi_percentage, extrade_units, non_extrade_units)
   values
     ('${shareHm.id}', '${shareMonthPrev.id}', 30, 40, 2, 19, 70.00, 10, 20),
     ('${shareHmOther.id}', '${shareMonthPrev.id}', 777, 800, 7, 77, 77.00, 7, 770)`,
);

const hmResolved = (
  await asAnon(
    `select public.resolve_share_hm_report('${TOKEN_LIVE}', '${shareHm.id}') as body`,
  )
).rows[0].body;

report("anon can open an HM under a live token", hmResolved !== null);

report(
  "and gets the token's own month, named",
  hmResolved?.month?.label === "March 2027" &&
    hmResolved?.hm_id === shareHm.id,
  JSON.stringify(hmResolved?.month),
);

report(
  "the month's figures come back, exactly as the group report's do",
  hmResolved?.monthly?.length === 1 &&
    Number(hmResolved.monthly[0].net_units) === 42 &&
    hmResolved?.weekly?.length === 1,
);

report(
  "the previous month is in the context",
  Array.isArray(hmResolved?.context) &&
    hmResolved.context.some((entry) => entry.month?.label === "February 2027"),
  JSON.stringify(hmResolved?.context?.map((entry) => entry.month?.label)),
);

const hmContext = JSON.stringify(hmResolved?.context);

report(
  "a context month carries ONLY the requested HM's rows",
  hmResolved.context.every((entry) =>
    // `hm_id` is the guarantee; the other HM's sentinel 777 is the sanity
    // check that it is the RIGHT rows rather than merely a consistent set.
    //
    // Asserted on the parsed rows, never on a substring of the serialized
    // payload: `includes("777")` also matches a uuid, and on 2026-09-11 it
    // duly failed against a month whose id was `bb0a4f52-…-27a777ad9f5d`
    // while the data underneath was perfectly correct.
    [...(entry.monthly ?? []), ...(entry.hp_active ?? [])].every(
      (row) => row.hm_id === shareHm.id,
    ) &&
    (entry.monthly ?? []).every((row) => Number(row.net_units) !== 777),
  ),
  hmContext?.slice(0, 200),
);

report(
  "and no weeks, no weekly Key-In and no group SHI for a context month",
  hmResolved.context.every((entry) => {
    const keys = Object.keys(entry).sort();

    // month, monthly, hp_active. The HP entry is an AGGREGATE COUNT for this
    // one HM - never an HP record, and never another HM's.
    return (
      keys.length === 3 &&
      keys[0] === "hp_active" &&
      keys[1] === "month" &&
      keys[2] === "monthly"
    );
  }),
);

report(
  "a LATER month is never in the context - there is no April in a March report",
  hmResolved.context.every(
    (entry) =>
      // Ids compared as ids, and the sentinel as a number. See the note on the
      // "ONLY the requested HM's rows" assertion above.
      entry.month?.id !== shareMonthB.id &&
      (entry.monthly ?? []).every((row) => Number(row.net_units) !== 999),
  ),
  hmContext?.slice(0, 200),
);

const hmSerialised = JSON.stringify(hmResolved);

report(
  "no created_by or updated_by in the HM projection",
  !hmSerialised.includes("created_by") && !hmSerialised.includes("updated_by"),
);

report(
  "no performance row ids in it either",
  hmResolved.monthly.every((row) => row.id === undefined) &&
    hmResolved.context.every((entry) =>
      (entry.monthly ?? []).every((row) => row.id === undefined),
    ),
);

report(
  "no profile, email or auth field anywhere",
  !hmSerialised.includes("full_name") &&
    !hmSerialised.includes("email") &&
    !hmSerialised.includes('"role"'),
);

report("and no token is echoed back", !hmSerialised.includes(TOKEN_LIVE));

report(
  "an active HM with nothing keyed in this month can still be opened, blank",
  (
    await asAnon(
      `select public.resolve_share_hm_report('${TOKEN_LIVE}', '${shareHmIdle.id}') as body`,
    )
  ).rows[0].body !== null,
);

/** The HM resolver's answer for one (token, id) pair. */
async function hmResolvesToNull(token, id, label) {
  const row = (
    await asAnon(
      `select public.resolve_share_hm_report(${token}, ${id}) as body`,
    )
  ).rows[0];

  report(label, row.body === null, JSON.stringify(row.body)?.slice(0, 120));
}

await hmResolvesToNull(
  `'${TOKEN_LIVE}'`,
  `'${shareHmGone.id}'`,
  "an inactive HM with nothing this month cannot be opened from it",
);
await hmResolvesToNull(
  `'${TOKEN_LIVE}'`,
  `'${shareMonthA.id}'`,
  "a month id used as an HM id resolves to nothing",
);
await hmResolvesToNull(
  `'${TOKEN_LIVE}'`,
  `'3f2504e0-4f89-11d3-9a0c-0305e82c3301'`,
  "an HM id that matches nobody resolves to nothing",
);
await hmResolvesToNull(
  `'${TOKEN_LIVE}'`,
  `null`,
  "a null HM id resolves to nothing",
);
await hmResolvesToNull(
  `'${TOKEN_REVOKED}'`,
  `'${shareHm.id}'`,
  "a revoked token opens no HM",
);
await hmResolvesToNull(
  `'${TOKEN_EXPIRED}'`,
  `'${shareHm.id}'`,
  "an expired token opens no HM",
);
await hmResolvesToNull(
  `'${shareToken("never_issued_hm_")}'`,
  `'${shareHm.id}'`,
  "a token that was never issued opens no HM",
);
await hmResolvesToNull(
  `'${shareMonthA.id}'`,
  `'${shareHm.id}'`,
  "a month id used as a token opens no HM",
);
await hmResolvesToNull(`''`, `'${shareHm.id}'`, "an empty token opens no HM");
await hmResolvesToNull(`null`, `'${shareHm.id}'`, "a null token opens no HM");

const aprilHm = (
  await asAnon(
    `select public.resolve_share_hm_report('${TOKEN_OTHER_MONTH}', '${shareHm.id}') as body`,
  )
).rows[0].body;

report(
  "a token bound to April opens April's figures, not March's",
  aprilHm?.month?.label === "April 2027" &&
    Number(aprilHm.monthly[0].net_units) === 999,
  JSON.stringify(aprilHm?.month),
);

report(
  "its context is March - the month before it - and still one HM only",
  aprilHm.context.length === 1 &&
    aprilHm.context[0].month.label === "March 2027" &&
    aprilHm.context[0].monthly.every((row) => row.hm_id === shareHm.id),
  JSON.stringify(aprilHm.context?.map((entry) => entry.month?.label)),
);

report(
  "opening an HM stamps the same link's last_accessed_at",
  (
    await one(
      `select last_accessed_at from public.share_links where token = '${TOKEN_OTHER_MONTH}'`,
    )
  ).last_accessed_at !== null,
);

// --- anon is still locked out of every table -------------------------------------
async function anonBlockedFrom(relation) {
  await asSuperuser(`select 1`);
  await db.exec(`set role anon`);
  let blocked = false;
  try {
    await db.query(`select * from ${relation}`);
  } catch {
    blocked = true;
  }
  await db.exec(`reset role`);
  return blocked;
}

for (const relation of [
  "public.share_links",
  "public.hms",
  "public.months",
  "public.profiles",
  "public.hm_monthly_performance",
  "public.hm_weekly_performance",
  "public.sales_weeks",
  "public.group_monthly_metrics",
]) {
  report(
    `anon cannot select ${relation} directly`,
    await anonBlockedFrom(relation),
  );
}

await asSuperuser(`select 1`);

report(
  "anon holds no table privileges at all",
  Number(
    (
      await one(`select count(*) as c from information_schema.role_table_grants
                  where grantee = 'anon' and table_schema = 'public'`)
    ).c,
  ) === 0,
);

const anonFunctions = (
  await db.query(
    `select p.proname
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        -- Trigger functions are excluded: Postgres grants EXECUTE on every new
        -- function to PUBLIC, but a function returning the trigger type cannot
        -- be called directly - Postgres refuses it outside a trigger context -
        -- so they are not a callable surface. What this asks is which CALLABLE
        -- functions anon can reach, and the answer has to be exactly one.
        and p.prorettype <> 'trigger'::regtype
        and has_function_privilege('anon', p.oid, 'execute')
      order by p.proname`,
  )
).rows.map((r) => r.proname);

// The three share resolvers, and nothing else. All three are token-gated, all
// three are SECURITY DEFINER, and all three return NULL for every failure.
// Written as an exact SET rather than a count: a fourth callable function
// reaching anon should fail this test whatever it is called.
//
// It went from two to three when the HP list was shared - `resolve_share_hm_hp`
// - and that is the point of listing them by name. Widening the anonymous
// surface is a decision somebody has to come here and make; it cannot happen as
// a side effect of adding a function.
const ANON_FUNCTIONS = [
  "resolve_share_hm_hp",
  "resolve_share_hm_report",
  "resolve_share_report",
];

report(
  `the three share resolvers are the ONLY callable functions anon may execute (${anonFunctions.join(", ") || "none"})`,
  anonFunctions.length === ANON_FUNCTIONS.length &&
    ANON_FUNCTIONS.every((name, index) => anonFunctions[index] === name),
);

// --- a deactivated PA loses share-link access too ---------------------------------
await asSuperuser(
  `update public.profiles set is_active = false where id = '${PA}'`,
);
await deniedSilently(
  PA,
  `select * from public.share_links`,
  "a deactivated PA reads no share links",
);
await deniedLoudly(
  PA,
  `insert into public.share_links (token, month_id)
     values ('${shareToken("ghost_")}', '${shareMonthA.id}')`,
  "a deactivated PA cannot create one",
);
await asSuperuser(
  `update public.profiles set is_active = true where id = '${PA}'`,
);

// --- deleting a link is manager-only ----------------------------------------------
await deniedSilently(
  PA,
  `delete from public.share_links where token = '${TOKEN_REVOKED}'`,
  "a PA's delete of a share link touches no rows",
);
await allowed(
  MGR,
  `delete from public.share_links where token = '${TOKEN_REVOKED}'`,
  "a manager can delete a share link outright",
);

await asSuperuser(`select 1`);

// -----------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed\n`);
await db.close();
process.exit(fail ? 1 : 0);
