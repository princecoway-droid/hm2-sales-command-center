/**
 * Application-facing domain models.
 *
 * Everything here is derived from the database types, so a schema change (or a
 * regeneration of `database.ts`) propagates straight through to the UI instead
 * of leaving a hand-written duplicate to rot.
 */

import type {
  Enums,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "@/types/database";

// -----------------------------------------------------------------------------
// Roles
// -----------------------------------------------------------------------------

/** Internal application roles. HMs are not accounts and never appear here. */
export type UserRole = Enums<"user_role">;

export const USER_ROLES = ["manager", "pa"] as const satisfies readonly UserRole[];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  manager: "Manager",
  pa: "PA",
};

/** Lifecycle state of an HM record. */
export type HMStatus = Enums<"hm_status">;

export const HM_STATUSES = ["active", "inactive"] as const satisfies readonly HMStatus[];

// -----------------------------------------------------------------------------
// Entities
// -----------------------------------------------------------------------------

export type Profile = Tables<"profiles">;
export type ProfileInsert = TablesInsert<"profiles">;
export type ProfileUpdate = TablesUpdate<"profiles">;

export type HM = Tables<"hms">;
export type HMInsert = TablesInsert<"hms">;
export type HMUpdate = TablesUpdate<"hms">;

export type Month = Tables<"months">;
export type MonthInsert = TablesInsert<"months">;
export type MonthUpdate = TablesUpdate<"months">;

export type SalesWeek = Tables<"sales_weeks">;
export type SalesWeekInsert = TablesInsert<"sales_weeks">;
export type SalesWeekUpdate = TablesUpdate<"sales_weeks">;

export type HMMonthlyPerformance = Tables<"hm_monthly_performance">;
export type HMMonthlyPerformanceInsert = TablesInsert<"hm_monthly_performance">;
export type HMMonthlyPerformanceUpdate = TablesUpdate<"hm_monthly_performance">;

export type HMWeeklyPerformance = Tables<"hm_weekly_performance">;
export type HMWeeklyPerformanceInsert = TablesInsert<"hm_weekly_performance">;
export type HMWeeklyPerformanceUpdate = TablesUpdate<"hm_weekly_performance">;

export type GroupMonthlyMetrics = Tables<"group_monthly_metrics">;
export type GroupMonthlyMetricsInsert = TablesInsert<"group_monthly_metrics">;
export type GroupMonthlyMetricsUpdate = TablesUpdate<"group_monthly_metrics">;

/**
 * A capability token for the unauthenticated read-only report.
 *
 * Internal to the authenticated side: the row itself is never sent to a public
 * viewer, and `anon` cannot read the table at all.
 */
export type ShareLink = Tables<"share_links">;
export type ShareLinkInsert = TablesInsert<"share_links">;
export type ShareLinkUpdate = TablesUpdate<"share_links">;

// -----------------------------------------------------------------------------
// Session
// -----------------------------------------------------------------------------

/** The signed-in user, joined with their application profile. */
export type AuthenticatedUser = {
  id: string;
  email: string | null;
  profile: Profile;
};
