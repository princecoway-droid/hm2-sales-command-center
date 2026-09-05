import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AuthenticatedUser, UserRole } from "@/types/models";

/**
 * Authentication and authorization helpers.
 *
 * Pages and Server Actions call one of the `require*` guards instead of
 * hand-rolling role checks. Two layers back them up:
 *
 *   1. These guards, which decide what the UI shows and where a user is sent.
 *   2. Row Level Security, which decides what the database will actually hand
 *      over. A bug here is a UX problem; it is not a data breach.
 */

/**
 * The signed-in user together with their application profile, or `null`.
 *
 * `cache()` dedupes this across a single render pass, so a layout and three
 * nested pages calling it cost one round trip.
 */
export const getCurrentUser = cache(
  async (): Promise<AuthenticatedUser | null> => {
    const supabase = await createSupabaseServerClient();

    // getUser() revalidates the JWT with the Auth server. getSession() only
    // decodes the cookie, which a client could have tampered with.
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return null;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    // Authenticated but unprovisioned or deactivated: not an application user.
    if (profileError || !profile || !profile.is_active) {
      return null;
    }

    return {
      id: user.id,
      email: user.email ?? null,
      profile,
    };
  },
);

/** True when someone is signed in with an active profile. */
export async function isAuthenticated(): Promise<boolean> {
  return (await getCurrentUser()) !== null;
}

/**
 * Requires any active internal user.
 *
 * Redirects to login when there is no session at all, and to `/no-access` when
 * the account exists in Supabase Auth but has no active profile - a real state
 * worth distinguishing, since it means "ask your manager", not "sign in again".
 */
export async function requireAuth(): Promise<AuthenticatedUser> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(ROUTES.login);
  }

  const currentUser = await getCurrentUser();

  if (!currentUser) {
    redirect(ROUTES.noAccess);
  }

  return currentUser;
}

/** Requires one of the given roles. */
export async function requireRole(
  ...roles: readonly UserRole[]
): Promise<AuthenticatedUser> {
  const user = await requireAuth();

  if (!roles.includes(user.profile.role)) {
    redirect(ROUTES.noAccess);
  }

  return user;
}

/** Manager-only areas: settings, user administration, destructive actions. */
export async function requireManager(): Promise<AuthenticatedUser> {
  return requireRole("manager");
}

/**
 * Day-to-day operational areas: data entry, HM management, the dashboard.
 *
 * Currently equivalent to `requireAuth()` because manager and PA are the only
 * roles - it exists so intent is explicit at the call site and so adding a
 * third role later does not mean auditing every page.
 */
export async function requirePaOrManager(): Promise<AuthenticatedUser> {
  return requireRole("manager", "pa");
}

/** Non-redirecting role check, for conditionally rendering part of a page. */
export function hasRole(
  user: AuthenticatedUser,
  ...roles: readonly UserRole[]
): boolean {
  return roles.includes(user.profile.role);
}

export function isManager(user: AuthenticatedUser): boolean {
  return hasRole(user, "manager");
}
