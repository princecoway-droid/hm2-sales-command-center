import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * The public shell.
 *
 * Its whole job is to be nothing. No header, no navigation, no identity, no
 * sign-out - the authenticated `AppShell` lives under the `(app)` route group
 * and this route is not in it, so there is no prop, no flag and no conditional
 * that could cause the internal chrome to render for an anonymous visitor. The
 * separation is structural rather than defensive.
 *
 * `robots` is restated here even though the root layout already sets it: this
 * is the one route with a URL that leaves the building, and it is the one place
 * a future change to the root default must not be able to quietly expose.
 */
export const metadata: Metadata = {
  title: "Performance report",
  robots: { index: false, follow: false, nocache: true },
};

export default function ShareLayout({ children }: { children: ReactNode }) {
  // The canvas is painted on `body` in `globals.css`, so the report reads as
  // the same product as the dashboard it was generated from.
  return <div className="min-h-dvh text-slate-900">{children}</div>;
}
