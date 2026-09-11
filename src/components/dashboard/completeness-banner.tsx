import {
  STATUS_DOT_CLASSES,
  STATUS_TEXT_CLASSES,
} from "@/components/ui/status-styles";
import { cn } from "@/lib/utils";
import type { CompletenessModel } from "@/lib/view-models/dashboard";

type CompletenessBannerProps = {
  completeness: CompletenessModel;
};

/**
 * Whether the figures above can be trusted as the whole picture.
 *
 * Visible but quiet: the one thing this has to prevent is a manager reading a
 * half-entered month as a finished one, and it does that with a count and the
 * outstanding names. It never scores or judges - an HM can legitimately have a
 * zero month, so "has figures" is the only honest signal the data supports.
 *
 * The dot is never the message on its own; the count is always written out.
 */
export function CompletenessBanner({ completeness }: CompletenessBannerProps) {
  return (
    <div
      role="status"
      className="glass-card flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm sm:px-5"
    >
      <span className="flex items-center gap-2 font-medium text-slate-900">
        <span
          aria-hidden
          className={cn(
            "size-2 rounded-full",
            STATUS_DOT_CLASSES[completeness.status],
          )}
        />
        <span className={cn(STATUS_TEXT_CLASSES[completeness.status])}>
          {completeness.headline}
        </span>
      </span>

      {completeness.detail ? (
        <span className="text-xs text-slate-500">{completeness.detail}</span>
      ) : null}
    </div>
  );
}
