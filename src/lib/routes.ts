/**
 * Route table.
 *
 * One place that knows which URLs exist, which are public, and which role may
 * reach them. `src/proxy.ts` and the navigation both read from here, so a new
 * page cannot end up protected in one and open in the other.
 */

import type { UserRole } from "@/types/models";

export const ROUTES = {
  login: "/login",
  noAccess: "/no-access",
  dashboard: "/dashboard",
  /**
   * One HM's performance screen.
   *
   * Deliberately a sibling of `/dashboard` rather than a child of it. Nested
   * under `/dashboard`, this route sits inside the dashboard's own
   * `loading.tsx` Suspense boundary, so a hard load of an HM profile flashes
   * the GROUP skeleton - eight KPI cards and a bar chart - before the person's
   * figures appear. A sibling segment gets its own boundary and its own
   * skeleton.
   */
  hmDetail: "/hm",
  dataEntry: "/data-entry",
  hmManagement: "/hm-management",
  settings: "/settings",
  /**
   * The read-only month report, reached with a share token and no session.
   *
   * The ONLY unauthenticated route that shows business data. It is a sibling of
   * everything else rather than a variant of `/dashboard`: it has its own
   * layout with no navigation, no identity and no controls, so there is no
   * arrangement of props under which the authenticated shell could render for
   * an anonymous visitor.
   *
   * There is deliberately no public equivalent of `/hm/<id>`. The link posted
   * to the group is one group report; individual HM screens stay behind login.
   */
  share: "/share",
} as const;

/** Where a signed-in user lands. */
export const DEFAULT_AUTHENTICATED_ROUTE = ROUTES.dashboard;

/**
 * Reachable without a session. Everything else requires one.
 *
 * `/share` is here because a WhatsApp recipient has no account; the token in
 * the path is what authorizes the read, and `resolve_share_report` in the
 * database is what enforces it. Being listed here only means the proxy will not
 * bounce the request to the login page - it grants no data access, and every
 * other route in the table stays behind `updateSession`.
 */
export const PUBLIC_ROUTES: readonly string[] = [
  ROUTES.login,
  ROUTES.noAccess,
  ROUTES.share,
];

export type NavItem = {
  href: string;
  label: string;
  description: string;
  /** Roles allowed to see and open the item. */
  roles: readonly UserRole[];
  /**
   * Extra path prefixes that belong to this item.
   *
   * An HM's own screen is reached from the dashboard and returns to it, so the
   * navigation should keep saying Dashboard while the manager is on it -
   * otherwise following a card leaves the sidebar with nothing highlighted and
   * the reader with no idea where they are.
   */
  matches?: readonly string[];
};

export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: ROUTES.dashboard,
    label: "Dashboard",
    description: "Group and HM performance at a glance",
    roles: ["manager", "pa"],
    matches: [ROUTES.hmDetail],
  },
  {
    href: ROUTES.dataEntry,
    label: "Data Entry",
    description: "Monthly KPIs and weekly Key-In",
    roles: ["manager", "pa"],
  },
  {
    href: ROUTES.hmManagement,
    label: "HM Management",
    description: "The HM master list and photos",
    roles: ["manager", "pa"],
  },
  {
    href: ROUTES.settings,
    label: "Settings",
    description: "Sales calendar, users and configuration",
    roles: ["manager"],
  },
];

export function navItemsForRole(role: UserRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

/**
 * A dashboard link that carries the reporting month.
 *
 * The month lives in the query string everywhere in this app, so building the
 * link in one place is what stops a "back" arrow quietly dropping it and
 * landing the manager on today's month instead of the one they came from.
 */
export function dashboardPath(month?: string | null): string {
  return month ? `${ROUTES.dashboard}?month=${month}` : ROUTES.dashboard;
}

/**
 * `/share/<token>`.
 *
 * The token alone. No `?month=`, on purpose: a month in the query string would
 * be a second, editable answer to "which month is this", and the whole point of
 * the token is that the answer is fixed at the moment the link is created. The
 * public page reads no search parameters at all, so appending one changes
 * nothing.
 */
export function sharePath(token: string): string {
  return `${ROUTES.share}/${encodeURIComponent(token)}`;
}

/** `/hm/<id>?month=2026-09`. The month is carried, never re-derived. */
export function hmDetailPath(hmId: string, month?: string | null): string {
  const base = `${ROUTES.hmDetail}/${encodeURIComponent(hmId)}`;

  return month ? `${base}?month=${month}` : base;
}

/** True when `pathname` is the item's own route, or one that belongs to it. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return [item.href, ...(item.matches ?? [])].some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}
