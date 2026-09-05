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
      className="flex gap-1 overflow-x-auto pb-1 md:block md:space-y-1 md:overflow-visible md:pb-0"
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
              "shrink-0 rounded-md px-3 py-2 text-sm transition-colors md:block",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600",
              isActive
                ? "bg-sky-50 font-medium text-sky-800"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
