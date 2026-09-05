"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * The HM screen's own error boundary.
 *
 * Scoped to this route rather than falling through to the dashboard's, so a
 * failed fetch here costs the manager one HM's figures, not the dashboard and
 * not the application shell.
 *
 * Nothing partial is rendered behind it. A profile showing Net and Recruitment
 * with the weekly section silently missing is worse than one that says it could
 * not load: the figures that DID render would be read as the whole month.
 *
 * The technical detail goes to the server log and, in development, to the
 * console. What reaches the screen is a generic line and the digest to quote,
 * because a thrown error can carry connection strings or row contents.
 */
export default function HmDetailError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[hm-detail]", error);
  }, [error]);

  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-5 py-6 text-red-900"
    >
      <h1 className="text-base font-semibold">Unable to load HM performance</h1>

      <p className="mt-2 max-w-prose text-sm">
        The figures could not be fetched, so nothing is shown rather than a
        partial month. Try again — if it keeps happening, let your manager know.
      </p>

      {error.digest ? (
        <p className="mt-2 font-mono text-xs text-red-700/80">
          Reference: {error.digest}
        </p>
      ) : null}

      <Button className="mt-4" onClick={() => retry()}>
        Retry
      </Button>
    </div>
  );
}
