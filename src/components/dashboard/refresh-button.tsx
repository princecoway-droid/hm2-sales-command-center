"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";

/**
 * Re-fetches the dashboard without leaving it.
 *
 * `router.refresh()` re-runs the server render for the CURRENT url, so the
 * selected month, the scroll position and everything else on screen survive -
 * the figures are replaced, the page is not. The transition state is what makes
 * the wait legible; without it a click on a fast connection looks like nothing
 * happened at all.
 */
export function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="secondary"
      onClick={() => startTransition(() => router.refresh())}
      disabled={isPending}
      aria-live="polite"
    >
      {isPending ? "Refreshing…" : "Refresh"}
    </Button>
  );
}
