import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { requireAuth } from "@/lib/auth/session";

/**
 * Guards every page in the authenticated area.
 *
 * A layout guard is a convenience, not the boundary: `src/proxy.ts` turns
 * anonymous requests away before rendering, individual pages add their own role
 * guard where they need one, and Row Level Security has the final say on data.
 */
export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireAuth();

  return <AppShell user={user}>{children}</AppShell>;
}
