"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * Root error boundary.
 *
 * Shows the message in development only - in production a thrown error can
 * carry connection strings or row contents, so the user gets a generic line and
 * the digest to quote.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const isDev = process.env.NODE_ENV === "development";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-base font-semibold text-slate-900">
          Something went wrong
        </h1>

        <p className="mt-2 text-sm text-slate-600">
          {isDev
            ? error.message
            : "The page could not be loaded. Try again, and let your manager know if it keeps happening."}
        </p>

        {error.digest ? (
          <p className="mt-2 font-mono text-xs text-slate-400">
            Reference: {error.digest}
          </p>
        ) : null}

        <Button className="mt-4" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
