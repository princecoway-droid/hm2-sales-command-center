/**
 * Validation and business-rule tests.
 *
 *   npm run test:unit
 *
 * Covers the pure logic that later stages will lean on hardest: the Extrade
 * identity, the draft-versus-save split, quarter derivation, the irregular
 * Coway sales week, and role-based navigation. Every schema here mirrors a
 * database constraint - supabase/tests/schema.test.mjs proves the database side
 * of the same rules.
 */

import {
  hmMonthlyPerformanceSchema,
  hmMonthlyPerformanceDraftSchema,
  isExtradeSplitBalanced,
  hmWeeklyPerformanceSchema,
  groupMonthlyMetricsSchema,
} from "@/lib/validation/performance";
import { hmSchema } from "@/lib/validation/hm";
import { monthSchema, deriveQuarter, formatMonthLabel } from "@/lib/validation/month";
import { salesWeekSchema, findOverlappingWeeks } from "@/lib/validation/sales-week";
import { credentialsSchema } from "@/lib/validation/auth";
import { toFieldErrors } from "@/lib/validation/utils";
import { navItemsForRole, isPublicRoute } from "@/lib/routes";
import { validateHmPhoto } from "@/lib/storage";
import { randomUUID } from "node:crypto";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
};

// Real v4 ids, as gen_random_uuid() would produce.
const HM = randomUUID();
const MONTH = randomUUID();
const WEEK = randomUUID();

// A hand-written id: valid to Postgres, rejected by a strict RFC uuid check.
const HAND_WRITTEN_ID = "00000000-0000-0000-0000-000000000001";

console.log("\n[A] months");
check(
  "quarter derivation matches Jan-Mar=1 .. Oct-Dec=4",
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(deriveQuarter).join(",") ===
    "1,1,1,2,2,2,3,3,3,4,4,4",
);
check(
  'label formats as "September 2026"',
  formatMonthLabel(2026, 9) === "September 2026",
);
check("month 13 rejected", !monthSchema.safeParse({ year: 2026, month: 13 }).success);
check("month 0 rejected", !monthSchema.safeParse({ year: 2026, month: 0 }).success);
check(
  "string inputs coerced (form data arrives as strings)",
  monthSchema.safeParse({ year: "2026", month: "9" }).success,
);

console.log("\n[B] hm_monthly_performance: the Extrade rule");
const balanced = {
  hm_id: HM,
  month_id: MONTH,
  net_units: 40,
  target_net_units: 50,
  recruitment: 3,
  active_hp: 12,
  shi_percentage: 87.5,
  extrade_units: 24,
  non_extrade_units: 16,
};
check("balanced record accepted", hmMonthlyPerformanceSchema.safeParse(balanced).success);

const unbalanced = { ...balanced, extrade_units: 30 };
const unbalancedResult = hmMonthlyPerformanceSchema.safeParse(unbalanced);
check("unbalanced record rejected", !unbalancedResult.success);
if (!unbalancedResult.success) {
  const errors = toFieldErrors(unbalancedResult.error);
  check(
    "error attached to BOTH extrade fields",
    Boolean(errors.extrade_units) && Boolean(errors.non_extrade_units),
    JSON.stringify(Object.keys(errors)),
  );
  check(
    "message names the actual numbers",
    errors.extrade_units[0].includes("30") &&
      errors.extrade_units[0].includes("40"),
    errors.extrade_units[0],
  );
}

check(
  "SHI above 100 rejected",
  !hmMonthlyPerformanceSchema.safeParse({ ...balanced, shi_percentage: 100.01 }).success,
);
check(
  "SHI of exactly 100 accepted",
  hmMonthlyPerformanceSchema.safeParse({ ...balanced, shi_percentage: 100 }).success,
);
check(
  "SHI with 3 decimals rejected (numeric(5,2))",
  !hmMonthlyPerformanceSchema.safeParse({ ...balanced, shi_percentage: 87.555 }).success,
);
check(
  "negative recruitment rejected",
  !hmMonthlyPerformanceSchema.safeParse({ ...balanced, recruitment: -1 }).success,
);
check(
  "fractional net units rejected",
  !hmMonthlyPerformanceSchema.safeParse({ ...balanced, net_units: 4.5 }).success,
);

console.log("\n[C] draft vs final: partial entry stays editable");
check(
  "draft accepts a half-filled form (net set, split not yet)",
  hmMonthlyPerformanceDraftSchema.safeParse({ net_units: 40 }).success,
);
check(
  "draft accepts an unbalanced in-progress split",
  hmMonthlyPerformanceDraftSchema.safeParse({
    net_units: 40,
    extrade_units: 24,
    non_extrade_units: 0,
  }).success,
);
check(
  "draft still rejects an out-of-range value",
  !hmMonthlyPerformanceDraftSchema.safeParse({ shi_percentage: 150 }).success,
);
check(
  "isExtradeSplitBalanced false while incomplete",
  isExtradeSplitBalanced({ net_units: 40, extrade_units: 24, non_extrade_units: undefined }) ===
    false,
);
check(
  "isExtradeSplitBalanced true once it adds up",
  isExtradeSplitBalanced({ net_units: 40, extrade_units: 24, non_extrade_units: 16 }) === true,
);
check(
  "the SAME draft that passes the draft schema fails the save schema",
  hmMonthlyPerformanceDraftSchema.safeParse({
    hm_id: HM,
    month_id: MONTH,
    net_units: 40,
    extrade_units: 24,
    non_extrade_units: 0,
  }).success &&
    !hmMonthlyPerformanceSchema.safeParse({
      ...balanced,
      non_extrade_units: 0,
    }).success,
);

console.log("\n[D] weekly + group");
check(
  "weekly key-in accepted",
  hmWeeklyPerformanceSchema.safeParse({ hm_id: HM, week_id: WEEK, keyin_units: 12 }).success,
);
check(
  "negative key-in rejected",
  !hmWeeklyPerformanceSchema.safeParse({ hm_id: HM, week_id: WEEK, keyin_units: -1 }).success,
);
check(
  "group SHI accepted",
  groupMonthlyMetricsSchema.safeParse({ month_id: MONTH, shi_percentage: 91.25 }).success,
);
check(
  "group SHI above 100 rejected",
  !groupMonthlyMetricsSchema.safeParse({ month_id: MONTH, shi_percentage: 101 }).success,
);
check(
  "a hand-written id Postgres would accept is not rejected",
  groupMonthlyMetricsSchema.safeParse({
    month_id: HAND_WRITTEN_ID,
    shi_percentage: 50,
  }).success,
);
check(
  "a non-uuid string is still rejected",
  !groupMonthlyMetricsSchema.safeParse({ month_id: "nope", shi_percentage: 50 }).success,
);

console.log("\n[E] sales weeks");
check(
  "a nine-day W2 is accepted (Coway weeks are irregular)",
  salesWeekSchema.safeParse({
    month_id: MONTH,
    week_number: 2,
    start_date: "2026-09-05",
    end_date: "2026-09-13",
  }).success,
);
check(
  "W5 accepted",
  salesWeekSchema.safeParse({
    month_id: MONTH,
    week_number: 5,
    start_date: "2026-09-27",
    end_date: "2026-10-02",
  }).success,
);
const reversed = salesWeekSchema.safeParse({
  month_id: MONTH,
  week_number: 1,
  start_date: "2026-09-10",
  end_date: "2026-09-01",
});
check("start after end rejected", !reversed.success);
if (!reversed.success) {
  check(
    "the date error lands on end_date",
    Boolean(toFieldErrors(reversed.error).end_date),
    JSON.stringify(Object.keys(toFieldErrors(reversed.error))),
  );
}
check(
  "blank week_label becomes undefined so the DB default applies",
  salesWeekSchema.safeParse({
    month_id: MONTH,
    week_number: 1,
    week_label: "",
    start_date: "2026-09-01",
    end_date: "2026-09-07",
  }).data?.week_label === undefined,
);
check(
  "overlapping periods detected",
  findOverlappingWeeks([
    { week_number: 1, start_date: "2026-09-01", end_date: "2026-09-10" },
    { week_number: 2, start_date: "2026-09-08", end_date: "2026-09-15" },
  ]).length === 1,
);
check(
  "adjacent, non-overlapping periods are fine",
  findOverlappingWeeks([
    { week_number: 1, start_date: "2026-09-01", end_date: "2026-09-07" },
    { week_number: 2, start_date: "2026-09-08", end_date: "2026-09-15" },
  ]).length === 0,
);

console.log("\n[F] hm + auth + routing + storage");
check(
  "HM requires a non-blank name",
  !hmSchema.safeParse({ name: "   ", office: "KL", status: "active" }).success,
);
check(
  "HM photo_url empty string normalised to null",
  hmSchema.safeParse({ name: "A", office: "KL", status: "active", photo_url: "" }).data
    ?.photo_url === null,
);
check(
  "invalid email rejected",
  !credentialsSchema.safeParse({ email: "nope", password: "x" }).success,
);
check(
  "email lowercased and trimmed",
  credentialsSchema.safeParse({ email: "  Manager@Example.COM ", password: "x" }).data
    ?.email === "manager@example.com",
);
check(
  "PA navigation excludes Settings",
  navItemsForRole("pa").every((i) => i.href !== "/settings"),
  navItemsForRole("pa").map((i) => i.href).join(","),
);
check(
  "manager navigation includes Settings",
  navItemsForRole("manager").some((i) => i.href === "/settings"),
);
check(
  "/login and /no-access are public, /dashboard is not",
  isPublicRoute("/login") && isPublicRoute("/no-access") && !isPublicRoute("/dashboard"),
);
check(
  "oversized photo rejected",
  validateHmPhoto({ type: "image/png", size: 6 * 1024 * 1024 }) !== null,
);
check("GIF photo rejected", validateHmPhoto({ type: "image/gif", size: 1000 }) !== null);
check("small PNG accepted", validateHmPhoto({ type: "image/png", size: 1000 }) === null);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
