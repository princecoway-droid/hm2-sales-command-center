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
    <div className="min-h-dvh text-slate-900">
      {/* Sticky and translucent: on a phone the identity strip is also how you
          sign out, and a header that scrolls away takes that with it. What
          passes under it stays faintly visible through the blur rather than
          disappearing behind a white bar. */}
      <header className="glass-chrome sticky top-0 z-40 border-b">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight text-slate-900">
              {APP_NAME}
            </p>
            <p className="text-xs text-slate-500">{APP_TAGLINE}</p>
          </div>

          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-9 items-center justify-center rounded-full bg-sky-600/12 text-xs font-semibold text-sky-800 ring-1 ring-inset ring-sky-600/15"
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

      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 sm:py-6 md:flex-row md:gap-6">
        {/* The nav sticks under the header on a desktop, so a manager three
            screens down an HM list is still one click from Data Entry. */}
        <aside className="md:w-56 md:shrink-0">
          <div className="md:sticky md:top-[4.75rem]">
            <SidebarNav items={navItems} />
          </div>
        </aside>

        <main className="min-w-0 flex-1 space-y-5 sm:space-y-6">{children}</main>
      </div>
    </div>
  );
}
