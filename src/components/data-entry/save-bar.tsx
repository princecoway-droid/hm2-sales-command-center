"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

type SaveBarProps = {
  status: SaveStatus;
  message: string | null;
  dirtyCount: number;
  invalidCount: number;
  onSave: () => void;
  onDiscard: () => void;
};

/**
 * The save control, pinned to the bottom of the viewport.
 *
 * Explicit save, never save-on-blur. A PA works down a column filling in a
 * week for every HM; writing on each cell would mean fifty round trips, fifty
 * chances to half-apply a month, and no moment at which the Extrade split is
 * allowed to be temporarily unbalanced.
 *
 * Sticky because the grid is taller than the screen once there are more than a
 * dozen HMs, and a save button that scrolls away is a save button people forget
 * to press.
 */
export function SaveBar({
  status,
  message,
  dirtyCount,
  invalidCount,
  onSave,
  onDiscard,
}: SaveBarProps) {
  const blocked = invalidCount > 0;
  const canSave = dirtyCount > 0 && !blocked && status !== "saving";

  return (
    <div className="sticky bottom-0 z-30 -mx-6 mt-2 border-t border-slate-200 bg-white/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-sm" aria-live="polite">
          {blocked ? (
            <p className="font-medium text-red-700">
              {invalidCount} cell{invalidCount === 1 ? "" : "s"} need fixing
              before this can be saved.
            </p>
          ) : status === "saving" ? (
            <p className="text-slate-600">Saving…</p>
          ) : status === "error" ? (
            <p className="font-medium text-red-700">{message}</p>
          ) : status === "saved" && dirtyCount === 0 ? (
            <p className="font-medium text-emerald-700">{message ?? "Saved."}</p>
          ) : dirtyCount > 0 ? (
            <p className="text-slate-600">
              <span className="font-medium text-slate-900">
                {dirtyCount} unsaved{" "}
                {dirtyCount === 1 ? "change" : "changes"}
              </span>{" "}
              — nothing is written until you save.
            </p>
          ) : (
            <p className="text-slate-500">No changes.</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={onDiscard}
            disabled={dirtyCount === 0 || status === "saving"}
          >
            Discard changes
          </Button>
          <Button
            onClick={onSave}
            disabled={!canSave}
            className={cn(dirtyCount > 0 && !blocked && "shadow-sm")}
          >
            {status === "saving" ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
