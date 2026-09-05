import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { APP_NAME, APP_TAGLINE } from "@/lib/app";
import { navItemsForRole } from "@/lib/routes";
import { initials } from "@/lib/utils";
import { USER_ROLE_LABELS, type AuthenticatedUser } from "@/types/models";

type AppShellProps = {
  user: AuthenticatedUser;
  children: ReactNode;
};

/** Authenticated chrome: header with identity, role-filtered nav, content. */
export function AppShell({ user, children }: AppShellProps) {
  const { profile } = user;
  const navItems = navItemsForRole(profile.role);

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-3">
          <div>
            <p className="text-sm font-semibold tracking-tight text-slate-900">
              {APP_NAME}
            </p>
            <p className="text-xs text-slate-500">{APP_TAGLINE}</p>
          </div>

          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-9 items-center justify-center rounded-full bg-sky-100 text-xs font-semibold text-sky-800"
            >
              {initials(profile.full_name)}
            </span>

            <div className="text-right">
              <p className="text-sm font-medium text-slate-900">
                {profile.full_name}
              </p>
              <Badge tone="accent">{USER_ROLE_LABELS[profile.role]}</Badge>
            </div>

            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-6 md:flex-row">
        <aside className="md:w-56 md:shrink-0">
          <SidebarNav items={navItems} />
        </aside>

        <main className="min-w-0 flex-1 space-y-6">{children}</main>
      </div>
    </div>
  );
}
