import type { PostgrestError } from "@supabase/supabase-js";

import type { FieldErrors } from "@/lib/result";

/**
 * Turns Postgres/PostgREST errors into something a PA can act on.
 *
 * Every database rule in `supabase/migrations` has a name; this maps those
 * names to plain English and, where it makes sense, back onto a form field.
 * Keeping the mapping in one place means the constraint stays the enforcement
 * point - the UI never has to re-implement a rule just to phrase it nicely.
 */

/** https://www.postgresql.org/docs/current/errcodes-appendix.html */
const PG_UNIQUE_VIOLATION = "23505";
const PG_CHECK_VIOLATION = "23514";
const PG_FOREIGN_KEY_VIOLATION = "23503";
const PG_INSUFFICIENT_PRIVILEGE = "42501";

type ConstraintMessage = {
  message: string;
  /** Form field to attach the message to, when there is an obvious one. */
  field?: string;
};

const CONSTRAINT_MESSAGES: Record<string, ConstraintMessage> = {
  // months
  months_year_month_key: {
    message: "That reporting month already exists.",
    field: "month",
  },
  months_month_range: { message: "Month must be between 1 and 12.", field: "month" },
  months_year_range: { message: "Year looks out of range.", field: "year" },

  // sales_weeks
  sales_weeks_month_week_key: {
    message: "That week number is already configured for this month.",
    field: "week_number",
  },
  sales_weeks_number_range: {
    message: "Week number must be between 1 and 6.",
    field: "week_number",
  },
  sales_weeks_date_order: {
    message: "The start date cannot be after the end date.",
    field: "end_date",
  },
  // Raised by the deferred constraint trigger, which carries its own name in the
  // message text so it maps here exactly like a real constraint violation.
  sales_weeks_no_overlap: {
    message: "Week periods cannot overlap. Two weeks in this month cover the same dates.",
    field: "start_date",
  },

  // hms
  hms_name_not_blank: { message: "Name is required.", field: "name" },
  hms_office_not_blank: { message: "Office is required.", field: "office" },
  hms_status_allowed: { message: "Status must be active or inactive.", field: "status" },
  hms_display_order_natural: {
    message: "Display order cannot be negative.",
    field: "display_order",
  },

  // hm_monthly_performance
  hm_monthly_performance_hm_month_key: {
    message: "This HM already has a record for that month. Edit the existing one instead.",
  },
  hm_monthly_performance_shi_range: {
    message: "SHI must be between 0 and 100.",
    field: "shi_percentage",
  },
  hm_monthly_performance_net_units_natural: {
    message: "Net units cannot be negative.",
    field: "net_units",
  },
  hm_monthly_performance_target_natural: {
    message: "Target cannot be negative.",
    field: "target_net_units",
  },
  hm_monthly_performance_recruitment_natural: {
    message: "Recruitment cannot be negative.",
    field: "recruitment",
  },
  hm_monthly_performance_active_hp_natural: {
    message: "Active HP cannot be negative.",
    field: "active_hp",
  },
  hm_monthly_performance_extrade_natural: {
    message: "Extrade units cannot be negative.",
    field: "extrade_units",
  },
  hm_monthly_performance_non_extrade_natural: {
    message: "Non-Extrade units cannot be negative.",
    field: "non_extrade_units",
  },

  // hm_weekly_performance
  hm_weekly_performance_hm_week_key: {
    message: "This HM already has Key-In recorded for that week.",
  },
  hm_weekly_performance_keyin_natural: {
    message: "Key-In units cannot be negative.",
    field: "keyin_units",
  },

  // group_monthly_metrics
  group_monthly_metrics_month_id_key: {
    message: "Group SHI is already recorded for that month.",
  },
  group_monthly_metrics_shi_range: {
    message: "Group SHI must be between 0 and 100.",
    field: "shi_percentage",
  },

  // profiles
  profiles_role_allowed: { message: "Role must be manager or PA.", field: "role" },
  profiles_full_name_not_blank: { message: "Full name is required.", field: "full_name" },
};

/** Matches the constraint name Postgres embeds in its error text. */
function findConstraint(error: PostgrestError): ConstraintMessage | null {
  const haystack = `${error.message} ${error.details ?? ""}`;

  for (const [name, mapped] of Object.entries(CONSTRAINT_MESSAGES)) {
    if (haystack.includes(name)) {
      return mapped;
    }
  }

  return null;
}

export type MappedDatabaseError = {
  message: string;
  fieldErrors: FieldErrors;
};

export function mapDatabaseError(error: PostgrestError): MappedDatabaseError {
  const constraint = findConstraint(error);

  if (constraint) {
    return {
      message: constraint.message,
      fieldErrors: constraint.field
        ? { [constraint.field]: [constraint.message] }
        : {},
    };
  }

  switch (error.code) {
    case PG_UNIQUE_VIOLATION:
      return { message: "That record already exists.", fieldErrors: {} };
    case PG_CHECK_VIOLATION:
      return {
        message: "Some values are outside the allowed range.",
        fieldErrors: {},
      };
    case PG_FOREIGN_KEY_VIOLATION:
      return {
        message: "A linked record is missing or still in use.",
        fieldErrors: {},
      };
    case PG_INSUFFICIENT_PRIVILEGE:
      return {
        message: "You do not have permission to do that.",
        fieldErrors: {},
      };
    default:
      return {
        message: "Something went wrong saving that. Please try again.",
        fieldErrors: {},
      };
  }
}

/** Short, user-facing text for a failed read. */
export function readErrorMessage(error: PostgrestError): string {
  if (error.code === PG_INSUFFICIENT_PRIVILEGE) {
    return "You do not have permission to view this data.";
  }

  return "Could not load data from the database.";
}
