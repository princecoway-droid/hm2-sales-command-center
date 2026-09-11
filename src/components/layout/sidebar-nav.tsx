"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { isNavItemActive, type NavItem } from "@/lib/routes";

type SidebarNavProps = {
  items: readonly NavItem[];
};

/**
 * Primary navigation.
 *
 * Client-side only so the active link can follow `usePathname()`. The items it
 * receives are already filtered by role on the server - hiding a link is a
 * courtesy, not the access control.
 *
 * A row of tabs on a phone, a sidebar from `md` up. Stacked vertically on a
 * small screen it pushed the first KPI card below the fold, which is the one
 * thing a dashboard cannot afford: the figures have to be the first thing on
 * screen, not the fourth navigation link.
 */
export function SidebarNav({ items }: SidebarNavProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      // A scrolling row of chips on a phone, a stacked list from `md`. The
      // glass panel is only drawn on the desktop column: on a phone the row is
      // one scrollable line and a panel around it would read as a second
      // header rather than as navigation.
      className={cn(
        "-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1",
        "md:mx-0 md:block md:space-y-0.5 md:overflow-visible md:px-0 md:pb-0",
        "md:glass-panel md:p-2",
      )}
    >
      {items.map((item) => {
        // Which paths belong to an item is decided in the route table, so an
        // HM's own screen keeps Dashboard highlighted.
        const isActive = isNavItemActive(item, pathname);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-h-11 shrink-0 items-center rounded-control px-3 text-sm md:block md:py-2.5",
              "transition-[background-color,color,box-shadow] duration-150 ease-out",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600",
              isActive
                ? // Filled rather than tinted-and-bordered: on a translucent
                  // panel a tint alone is not enough to read as "you are here".
                  "bg-white font-semibold text-sky-800 shadow-[var(--shadow-control)] ring-1 ring-inset ring-slate-900/[0.07]"
                : "text-slate-600 hover:bg-white/60 hover:text-slate-900",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
