"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * The dashboard's own error boundary.
 *
 * Scoped to this route rather than falling through to the root one, so the app
 * shell, the navigation and the user's session stay on screen - a failed fetch
 * should cost the manager the figures, not the whole application.
 *
 * Nothing partial is rendered behind it. A dashboard showing three of its eight
 * KPI cards with the rest silently missing is worse than one that says it could
 * not load: the numbers that DID render would be read as the whole month.
 *
 * The technical detail goes to the server log and, in development, to the
 * console. What reaches the screen is a generic line and the digest to quote,
 * because a thrown error can carry connection strings or row contents.
 */
export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard]", error);
  }, [error]);

  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-5 py-6 text-red-900"
    >
      <h1 className="text-base font-semibold">Unable to load dashboard data</h1>

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
