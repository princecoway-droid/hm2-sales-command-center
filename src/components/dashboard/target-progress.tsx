import type { TargetProgressModel } from "@/lib/view-models/dashboard";

type TargetProgressProps = {
  target: TargetProgressModel;
  /** Named so the bar's accessible label says whose progress it is. */
  subject: string;
  size?: "md" | "sm";
};

/**
 * Net against target, as a track.
 *
 * Deliberately one neutral colour. The user has not defined achievement bands,
 * so the bar reports the figure and stops there - inventing a red-below-80 rule
 * here would put a business decision nobody made onto the screen everybody
 * reads.
 *
 * The percentage is also written out beside the track, so the bar is a second
 * reading of the figure rather than the only one - which is what keeps it
 * useful to somebody who cannot judge a length, and honest when achievement
 * runs past 100% and the track is full.
 */
export function TargetProgress({
  target,
  subject,
  size = "md",
}: TargetProgressProps) {
  const height = size === "md" ? "h-2" : "h-1.5";

  if (!target.hasTarget) {
    // The subject stays in the accessible name only. Written into the sentence
    // it would have to be case-folded to read well, and case-folding a person's
    // name is how "Sample HM E" becomes "sample hm e".
    return (
      <p className="text-xs text-slate-400" aria-label={`${subject}: no target set`}>
        No target set
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="tabular-nums text-slate-600">
          <span className="font-semibold text-slate-900">
            {target.netLabel}
          </span>{" "}
          / {target.targetLabel} units
        </span>
        <span className="font-semibold tabular-nums text-slate-900">
          {target.achievementLabel}
        </span>
      </div>

      <div
        className={`w-full overflow-hidden rounded-full bg-slate-100 ${height}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={
          target.progressPct === null
            ? undefined
            : Math.round(target.progressPct)
        }
        aria-valuetext={`${target.achievementLabel} of target`}
        aria-label={`${subject}: net against target`}
      >
        <div
          className={`${height} rounded-full bg-sky-600`}
          style={{ width: `${target.progressPct ?? 0}%` }}
        />
      </div>
    </div>
  );
}
