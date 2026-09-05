import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { getPublicSupabaseConfig, shouldUseSecureCookies } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * Always create a fresh client per request - never cache one across requests,
 * or one user's session leaks into another's render.
 */
export async function createSupabaseServerClient() {
  // Read cookies first, on purpose. `cookies()` is what marks the render
  // dynamic, so touching it before the config check means a build with no
  // .env.local bails out of prerendering instead of failing on a missing
  // environment variable.
  const cookieStore = await cookies();
  const { url, anonKey } = getPublicSupabaseConfig();

  return createServerClient<Database>(url, anonKey, {
    // `Secure` when NEXT_PUBLIC_APP_URL says this deployment is https. The
    // library's own default omits it; see shouldUseSecureCookies().
    cookieOptions: { secure: shouldUseSecureCookies() },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. That is expected and
          // harmless here: src/proxy.ts refreshes the session on every request
          // and writes the rotated tokens back to the response.
        }
      },
    },
  });
}
