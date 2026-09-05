import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  getPublicSupabaseConfig,
  hasPublicSupabaseConfig,
  shouldUseSecureCookies,
} from "@/lib/env";
import {
  DEFAULT_AUTHENTICATED_ROUTE,
  ROUTES,
  isPublicRoute,
} from "@/lib/routes";
import type { Database } from "@/types/database";

/**
 * Refreshes the Supabase session on every request and enforces the coarse
 * signed-in / signed-out split.
 *
 * Two jobs, in this order:
 *
 *   1. Rotate the auth tokens and write them back onto the response. Server
 *      Components cannot set cookies, so if this does not happen here the
 *      session silently expires mid-session.
 *   2. Bounce anonymous visitors to the login page and signed-in users away
 *      from it.
 *
 * Role checks deliberately do NOT live here. The proxy runs before rendering
 * and should stay cheap; `requireManager()` and friends do the fine-grained
 * work inside the pages themselves, backed by Row Level Security.
 */
export async function updateSession(request: NextRequest) {
  // Without configuration there is no session to refresh and no page in the
  // authenticated area can render. Send those to the login screen, which
  // explains what to put in .env.local, instead of letting them blow up in the
  // error boundary.
  if (!hasPublicSupabaseConfig()) {
    if (isPublicRoute(request.nextUrl.pathname)) {
      return NextResponse.next({ request });
    }

    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = ROUTES.login;
    redirectUrl.search = "";

    return NextResponse.redirect(redirectUrl);
  }

  const { url, anonKey } = getPublicSupabaseConfig();

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(url, anonKey, {
    // The proxy is what writes the rotated session cookie on nearly every
    // request, so this is the one that has to carry `Secure` in production.
    cookieOptions: { secure: shouldUseSecureCookies() },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }

        // Responses that carry rotated auth cookies must never be cached by a
        // CDN, or one user's tokens get served to the next visitor.
        for (const [header, headerValue] of Object.entries(headers)) {
          response.headers.set(header, headerValue);
        }
      },
    },
  });

  // Must be getUser(), not getSession(): only getUser() revalidates the token
  // with the Auth server, and it is what triggers the refresh.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  const onPublicRoute = isPublicRoute(pathname);

  if (!user && !onPublicRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = ROUTES.login;
    redirectUrl.search = "";

    // Remember where they were headed so login can send them back.
    const intended = `${pathname}${search}`;
    if (intended && intended !== "/") {
      redirectUrl.searchParams.set("next", intended);
    }

    return NextResponse.redirect(redirectUrl);
  }

  if (user && pathname === ROUTES.login) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = DEFAULT_AUTHENTICATED_ROUTE;
    redirectUrl.search = "";

    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
