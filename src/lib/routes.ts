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
  /**
   * The PA's Excel upload. A sibling of Data Entry rather than a tab inside it:
   * one is a spreadsheet the PA types into, the other replaces typing
   * altogether, and they are scoped to different things - Data Entry to the HM
   * roster, this to whatever the file contains.
   */
  hpImport: "/hp-import",
  /** The HP listing. Read-only, and never reachable without a session. */
  hpListing: "/hp",
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
   * An HM opened from that report lives UNDER the token, at
   * `/share/<token>/hm/<hmId>`, and never at `/hm/<id>`: the token is still the
   * whole of the authorization, and the private HM screen stays behind login.
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
    href: ROUTES.hpListing,
    label: "HP",
    description: "HP performance for the month, and the Excel import",
    roles: ["manager", "pa"],
    matches: [ROUTES.hpImport],
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

/**
 * `/share/<token>/hm/<hmId>`.
 *
 * One HM, read-only, under the token that already authorizes the report they
 * were opened from. Nested rather than a sibling for a reason that is the whole
 * of the design: the token stays in the path, so the public HM view is reached
 * by holding a live link and by nothing else, and revoking that link closes
 * both pages in the same instant.
 *
 * No `?month=`, exactly like `sharePath`. The month is the token's, decided
 * when the link was created, and a second answer to "which month is this" in
 * the query string is what would turn a report into a database browser.
 */
export function shareHmPath(token: string, hmId: string): string {
  return `${sharePath(token)}/hm/${encodeURIComponent(hmId)}`;
}

/**
 * `/hp?month=2026-09&hm=<id>&active=1`.
 *
 * Built in one place because it is a LINK TARGET as much as a route: the
 * dashboard's Active HP figure and every HM card's Active HP figure open this
 * page already filtered, and a caller that forgot `active` or `month` would
 * land the manager on a different number from the one they clicked.
 */
export function hpListingPath(options: {
  month?: string | null;
  hmId?: string | null;
  activeOnly?: boolean;
  search?: string | null;
  page?: number;
} = {}): string {
  const params = new URLSearchParams();

  if (options.month) {
    params.set("month", options.month);
  }

  if (options.hmId) {
    params.set("hm", options.hmId);
  }

  if (options.activeOnly) {
    params.set("active", "1");
  }

  if (options.search) {
    params.set("q", options.search);
  }

  if (options.page && options.page > 1) {
    params.set("page", String(options.page));
  }

  const query = params.toString();

  return query ? `${ROUTES.hpListing}?${query}` : ROUTES.hpListing;
}

/** `/hp-import?month=2026-09`. */
export function hpImportPath(month?: string | null): string {
  return month ? `${ROUTES.hpImport}?month=${month}` : ROUTES.hpImport;
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
