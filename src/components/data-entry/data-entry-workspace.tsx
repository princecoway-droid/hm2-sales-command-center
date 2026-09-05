"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import { DataStatus } from "@/components/data-entry/data-status";
import { MonthSelector } from "@/components/data-entry/month-selector";
import { GroupShiInput } from "@/components/data-entry/group-shi-input";
import { PerformanceGrid } from "@/components/data-entry/performance-grid";
import { SaveBar, type SaveStatus } from "@/components/data-entry/save-bar";
import { WeeklyCalendarEditor } from "@/components/data-entry/weekly-calendar-editor";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { saveMonthPerformanceAction } from "@/lib/actions/performance";
import { summariseCompleteness } from "@/lib/calculations/performance";
import {
  buildDraft,
  changedWeeklyCells,
  dirtyRowIds,
  findClearedSavedWeeks,
  isGroupShiDirty,
  monthlyValues,
  toCompletenessRow,
  toEntry,
  validateRow,
  type GridDraft,
  type RowErrors,
} from "@/lib/data-entry/grid-model";
import { percentageEntry, weeklyCellField } from "@/lib/validation/data-entry";
import type {
  GroupMonthlyMetrics,
  HM,
  HMMonthlyPerformance,
  HMWeeklyPerformance,
  Month,
  SalesWeek,
} from "@/types/models";

type DataEntryWorkspaceProps = {
  /** Every month that exists, newest first, for the selector. */
  months: readonly Month[];
  month: Month;
  hms: readonly HM[];
  weeks: readonly SalesWeek[];
  monthly: readonly HMMonthlyPerformance[];
  weekly: readonly HMWeeklyPerformance[];
  groupMetrics: GroupMonthlyMetrics | null;
  inactiveWithHistory: readonly string[];
  /** Removing a saved weekly figure is manager-only under the Stage 1 policy. */
  canClearSavedWeeks: boolean;
  /** So is removing a sales week that already holds Key-In. */
  canDeleteWeekWithData: boolean;
};

/**
 * Owns the edited state of one month.
 *
 * Everything the PA types lives here until they press Save. That is the whole
 * design: a write per keystroke would be fifty round trips to fill a column,
 * and - more importantly - it would leave no window in which the Extrade split
 * is allowed to be temporarily unbalanced, which is exactly the state a row
 * passes through while the figures are being entered.
 *
 * Month switching is a navigation, so this component is remounted with fresh
 * data and the draft is rebuilt from it; there is no way for one month's edits
 * to survive into another.
 */
export function DataEntryWorkspace({
  months,
  month,
  hms,
  weeks,
  monthly,
  weekly,
  groupMetrics,
  inactiveWithHistory,
  canClearSavedWeeks,
  canDeleteWeekWithData,
}: DataEntryWorkspaceProps) {
  const router = useRouter();

  const inactiveIds = useMemo(
    () => new Set(inactiveWithHistory),
    [inactiveWithHistory],
  );

  // What the database currently holds. `buildDraft` is deterministic, so this
  // doubles as the comparison point for dirty tracking and for Discard.
  const baseline = useMemo(
    () => buildDraft({ hms, weeks, monthly, weekly, groupMetrics }),
    [hms, weeks, monthly, weekly, groupMetrics],
  );

  const [draft, setDraft] = useState<GridDraft>(baseline);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, RowErrors>>(
    {},
  );
  const [, startSaving] = useTransition();

  // A refresh after a save brings new server data; the draft resets to it.
  //
  // Adjusted during render rather than in an effect: React re-runs this
  // component immediately with the new state and never commits the stale draft,
  // where an effect would paint the old figures for one frame first.
  const [seenBaseline, setSeenBaseline] = useState(baseline);

  if (seenBaseline !== baseline) {
    setSeenBaseline(baseline);
    setDraft(baseline);
    setServerErrors({});
  }

  const onCellChange = useCallback(
    (hmId: string, field: string, text: string) => {
      setStatus("idle");
      setDraft((current) => {
        const row = current.rows[hmId];

        if (!row) {
          return current;
        }

        const isWeekly = field.startsWith("week:");
        const nextRow = isWeekly
          ? {
              ...row,
              weekly: { ...row.weekly, [field.slice("week:".length)]: text },
            }
          : { ...row, monthly: { ...row.monthly, [field]: text } };

        // Only the edited row gets a new object, so only that row re-renders.
        return { ...current, rows: { ...current.rows, [hmId]: nextRow } };
      });

      // Clear any server-side complaint about this row: it described the values
      // that were sent, and they have just changed.
      setServerErrors((current) => {
        if (!current[hmId]) {
          return current;
        }

        const next = { ...current };
        delete next[hmId];

        return next;
      });
    },
    [],
  );

  const dirtyIds = useMemo(
    () => dirtyRowIds(draft, baseline, hms, weeks),
    [draft, baseline, hms, weeks],
  );
  const groupShiDirty = isGroupShiDirty(draft, baseline);

  /**
   * Live cell errors.
   *
   * Every rule left is a per-cell range rule, so a row reads the same mid-edit
   * as it does at save time. Extrade and Non-Extrade are independent figures and
   * are never checked against Net.
   */
  const clearedSaved = useMemo(
    () =>
      canClearSavedWeeks
        ? []
        : findClearedSavedWeeks(draft, baseline, hms, weeks),
    [canClearSavedWeeks, draft, baseline, hms, weeks],
  );

  const errors = useMemo(() => {
    const byHm: Record<string, RowErrors> = {};

    for (const hm of hms) {
      const row = draft.rows[hm.id];

      if (!row) {
        continue;
      }

      const rowErrors = validateRow(row, weeks);

      if (Object.keys(rowErrors).length > 0) {
        byHm[hm.id] = rowErrors;
      }
    }

    for (const cleared of clearedSaved) {
      byHm[cleared.hmId] = {
        ...byHm[cleared.hmId],
        [weeklyCellField(cleared.weekId)]:
          "This week already has a saved figure. Enter 0 for a zero week — only a manager can remove it entirely.",
      };
    }

    for (const [hmId, rowErrors] of Object.entries(serverErrors)) {
      byHm[hmId] = { ...byHm[hmId], ...rowErrors };
    }

    return byHm;
  }, [hms, draft, weeks, clearedSaved, serverErrors]);

  const groupShiError = useMemo(() => {
    const parsed = toEntry(draft.groupShi);

    if (!parsed.ok) {
      return "Group SHI must be a number.";
    }

    if (parsed.value === null) {
      return undefined;
    }

    const result = percentageEntry("Group SHI").safeParse(parsed.value);

    return result.success ? undefined : result.error.issues[0]?.message;
  }, [draft.groupShi]);

  const invalidCount =
    Object.values(errors).reduce(
      (total, rowErrors) => total + Object.keys(rowErrors).length,
      0,
    ) + (groupShiError ? 1 : 0);

  const dirtyCount = dirtyIds.length + (groupShiDirty ? 1 : 0);

  const completeness = useMemo(
    () =>
      summariseCompleteness(
        hms
          .filter((hm) => !inactiveIds.has(hm.id))
          .map((hm) => {
            const row = draft.rows[hm.id];

            return row
              ? toCompletenessRow(row, weeks)
              : {
                  hmId: hm.id,
                  net_units: null,
                  target_net_units: null,
                  recruitment: null,
                  active_hp: null,
                  shi_percentage: null,
                  extrade_units: null,
                  non_extrade_units: null,
                  weekly: [],
                };
          }),
      ),
    [hms, inactiveIds, draft.rows, weeks],
  );

  // Only warns when there is genuinely something to lose. Registering this
  // unconditionally is what makes browsers nag on every single navigation.
  useEffect(() => {
    if (dirtyCount === 0) {
      return;
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);

    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyCount]);

  function discard() {
    if (
      dirtyCount > 0 &&
      !window.confirm("Discard every unsaved change on this month?")
    ) {
      return;
    }

    setDraft(baseline);
    setServerErrors({});
    setStatus("idle");
    setMessage(null);
  }

  function save() {
    if (invalidCount > 0 || dirtyCount === 0) {
      return;
    }

    setStatus("saving");
    setMessage(null);
    setServerErrors({});

    const parsedGroupShi = toEntry(draft.groupShi);

    const payload = {
      month_id: month.id,
      group_shi_percentage: groupShiDirty
        ? (parsedGroupShi.ok ? parsedGroupShi.value : null)
        : null,
      rows: dirtyIds.flatMap((hmId) => {
        const row = draft.rows[hmId];

        if (!row) {
          return [];
        }

        return [
          {
            hm_id: hmId,
            ...monthlyValues(row),
            weekly: changedWeeklyCells(row, baseline.rows[hmId], weeks),
          },
        ];
      }),
    };

    startSaving(async () => {
      const result = await saveMonthPerformanceAction(payload);

      if (result.status === "error") {
        // The draft is untouched, so nothing the PA typed is lost - the cells
        // stay exactly as they were with the failures highlighted.
        const byHm: Record<string, RowErrors> = {};

        for (const cell of result.cellErrors) {
          byHm[cell.hmId] = { ...byHm[cell.hmId], [cell.field]: cell.message };
        }

        setServerErrors(byHm);
        setStatus("error");
        setMessage(result.message);
        return;
      }

      setStatus("saved");
      setMessage(result.message);
      router.refresh();
    });
  }

  return (
    <>
      <Card>
        <CardBody>
          <MonthSelector
            months={months}
            selected={month}
            hasUnsavedChanges={dirtyCount > 0}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`Coway sales weeks — ${month.label}`}
          description="The official weekly periods for this month. Not calendar weeks: enter the dates exactly as Coway publishes them, including where a week starts in the previous month."
        />
        <CardBody>
          <WeeklyCalendarEditor
            key={month.id}
            month={month}
            weeks={weeks}
            canDeleteWeekWithData={canDeleteWeekWithData}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`Performance — ${month.label}`}
          description="Click a cell and type. Enter moves down, Tab moves right, arrow keys move around. Nothing is written until you save."
          action={
            <div className="w-40">
              <GroupShiInput
                value={draft.groupShi}
                onChange={(text) => {
                  setStatus("idle");
                  setDraft((current) => ({ ...current, groupShi: text }));
                }}
                error={groupShiError}
              />
            </div>
          }
        />
        <CardBody className="space-y-4">
          <DataStatus
            summary={completeness}
            hms={hms}
            weekCount={weeks.length}
          />

          {hms.length === 0 ? (
            <Alert tone="info" title="No HMs to show">
              <p>
                Add Health Managers on the HM Management page, then come back to
                key in their figures.
              </p>
            </Alert>
          ) : (
            <PerformanceGrid
              hms={hms}
              weeks={weeks}
              rows={draft.rows}
              errors={errors}
              inactiveWithHistory={inactiveIds}
              onCellChange={onCellChange}
            />
          )}

          <p className="text-xs text-slate-500">
            A blank Key-In cell means &ldquo;not entered yet&rdquo; and is left
            uncoloured; enter <span className="font-mono">0</span> to record a
            genuine zero week. Monthly Key-In is always the sum of the weeks and
            is never keyed in directly.
          </p>
        </CardBody>
      </Card>

      <SaveBar
        status={status}
        message={message}
        dirtyCount={dirtyCount}
        invalidCount={invalidCount}
        onSave={save}
        onDiscard={discard}
      />
    </>
  );
}
