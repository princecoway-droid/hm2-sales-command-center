import type { PerformanceStatus } from "@/lib/calculations";
import type {
  CompletenessModel,
  DashboardViewModel,
  HmCardModel,
  KpiKey,
  KpiTile,
  WeeklyBar,
} from "@/lib/view-models/dashboard";

/**
 * The WhatsApp report.
 *
 * ---------------------------------------------------------------------------
 *   engine  ->  monthly-performance  ->  dashboard view model  ->  THIS FILE
 * ---------------------------------------------------------------------------
 *
 * A pure string builder. It takes the SAME view model the dashboard renders and
 * lays its already-formatted values out as plain text. There is no arithmetic
 * in this file - no `net / target`, no summing, no percentage, no sorting, no
 * threshold - because every one of those has an answer already, and a second
 * answer computed here is how the message pasted into the group ends up
 * disagreeing with the screen it was generated from.
 *
 * Concretely: `dashboard.kpis` is read by key, `dashboard.hms` is read in the
 * order the Stage 3 ranking put it in, and `week.status` is mapped to an emoji
 * rather than re-derived from the number beside it.
 *
 * No database, no React, no browser, no clock. One call, one string - and it is
 * the string the preview shows AND the string the clipboard receives, so what
 * the PA reads before copying is what lands in the group.
 */

/** The one place a Stage 3 status becomes an emoji. Mapping only, never a band. */
export const STATUS_EMOJI: Record<PerformanceStatus, string> = {
  green: "🟢",
  yellow: "🟡",
  red: "🔴",
  neutral: "⚪",
};

/** Ranks 1-3. Everyone below simply gets their name. */
const MEDALS = ["🥇", "🥈", "🥉"] as const;

const DIVIDER = "━━━━━━━━━━━━━━";

/** What a blank figure reads as. Matches the dashboard's own placeholder. */
const NO_VALUE = "—";

const COMPLETENESS_EMOJI: Record<CompletenessModel["level"], string> = {
  complete: "✅",
  partial: "⚠️",
  empty: "⚠️",
};

export type WhatsAppReportOptions = {
  /**
   * The read-only dashboard link. Omitted entirely when there is none, rather
   * than printed as a broken or placeholder URL.
   */
  shareUrl?: string | null;
};

/**
 * The whole report as plain text.
 *
 * Plain text on purpose: no Markdown table, no code fence, nothing that depends
 * on WhatsApp rendering anything. Emoji, spacing and a divider rule are the
 * only formatting, because they are the only formatting that survives being
 * pasted into a chat on a phone.
 */
export function generateWhatsAppReport(
  dashboard: DashboardViewModel,
  { shareUrl = null }: WhatsAppReportOptions = {},
): string {
  const lines: string[] = [
    "📊 HM2 SALES PERFORMANCE",
    `📅 ${dashboard.month.label}`,
    "",
    ...completenessSection(dashboard.completeness),
    ...groupSection(dashboard.kpis),
    ...weeklySection(dashboard.weekly),
    ...hmSection(dashboard.hms),
  ];

  if (shareUrl) {
    lines.push(DIVIDER, "", "🔗 View Full Dashboard", shareUrl);
  }

  // Collapses the runs of blank lines the sections leave at their seams, so the
  // message stays compact on a phone screen, and drops trailing whitespace.
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

// -----------------------------------------------------------------------------
// Sections
// -----------------------------------------------------------------------------

/**
 * How much of the month is actually in.
 *
 * First, above the figures, because it changes how every number below should be
 * read. The wording is the dashboard's own - `completeness.headline` - so the
 * banner on screen and the line in the message cannot end up claiming different
 * things about the same month.
 */
function completenessSection(completeness: CompletenessModel): string[] {
  return [
    `${COMPLETENESS_EMOJI[completeness.level]} ${completeness.headline}`,
    "",
  ];
}

function groupSection(kpis: readonly KpiTile[]): string[] {
  const find = (key: KpiKey) => kpis.find((tile) => tile.key === key) ?? null;

  return [
    DIVIDER,
    "🏆 GROUP PERFORMANCE",
    DIVIDER,
    "",
    metric("📥", "Key-In", find("keyIn")),
    metric("📤", "Net", find("net")),
    metric("🎯", "Target", find("target")),
    metric("📈", "Achievement", find("achievement")),
    "",
    metric("👥", "Recruitment", find("recruitment")),
    metric("👨‍💼", "Active HP", find("activeHp")),
    // Blank when eTrust has not been keyed in. Never the average of the HM SHI
    // column, and never last month's - the view model would have had to invent
    // one, and it does not.
    metric("❤️", "SHI", find("shi")),
    metric("📊", "Net Ratio", find("netRatio")),
    "",
  ];
}

/**
 * One KPI line.
 *
 * `tile.value` is rendered verbatim, blanks included: the view model has
 * already decided that an un-keyed figure reads as an em dash rather than as 0,
 * and that a blank carries no unit - "— units" reads as a broken number rather
 * than as a missing one.
 */
function metric(emoji: string, label: string, tile: KpiTile | null): string {
  if (!tile) {
    return `${emoji} ${label}: ${NO_VALUE}`;
  }

  const unit = tile.unit ? ` ${tile.unit}` : "";

  return `${emoji} ${label}: ${tile.value}${unit}`;
}

function weeklySection(weekly: DashboardViewModel["weekly"]): string[] {
  if (!weekly.hasWeeks) {
    return [
      DIVIDER,
      "📈 WEEKLY KEY-IN",
      DIVIDER,
      "",
      "No sales weeks configured yet",
      "",
    ];
  }

  return [
    DIVIDER,
    "📈 WEEKLY KEY-IN",
    DIVIDER,
    "",
    ...weekly.weeks.map(weekLine),
    "",
  ];
}

/**
 * `W4 🔴 98 units`, or `W5 ⚪ —` for a week nobody has keyed in.
 *
 * A blank week is neutral, never red: four days of September that have not
 * happened yet are not a collapse. The engine already decided that - this only
 * maps its answer to a circle.
 */
function weekLine(week: WeeklyBar): string {
  const value = week.isEntered ? `${week.unitsLabel} units` : NO_VALUE;

  return `${week.label} ${STATUS_EMOJI[week.status]} ${value}`;
}

/**
 * The HMs, in the ranking's order.
 *
 * `dashboard.hms` arrives ranked by Net descending with the engine's tie-break
 * already applied. Nothing here sorts: the league table in the message, the one
 * on the dashboard and the rank on an HM's own screen are the same list, and
 * two surfaces disagreeing about who is second is exactly what that ranking
 * exists to prevent.
 *
 * Four figures per HM and no more. SHI, target, Extrade mix, MoM and the weekly
 * breakdown all belong in the shared dashboard the link at the bottom opens;
 * twelve HMs' worth of them is not a message anybody reads on a phone.
 */
function hmSection(hms: readonly HmCardModel[]): string[] {
  if (hms.length === 0) {
    return [DIVIDER, "👥 HM PERFORMANCE", DIVIDER, "", "No HM records", ""];
  }

  const lines: string[] = [DIVIDER, "👥 HM PERFORMANCE", DIVIDER, ""];

  for (const hm of hms) {
    const medal = MEDALS[hm.rank - 1];

    lines.push(
      medal ? `${medal} ${hm.name}` : hm.name,
      [
        `${hm.keyInLabel} KI`,
        `${hm.netLabel} Net`,
        `${STATUS_EMOJI[hm.recruitmentStatus]} ${hm.recruitmentLabel} Recruit`,
        `${hm.activeHpLabel} Active`,
      ].join(" | "),
      "",
    );
  }

  return lines;
}
