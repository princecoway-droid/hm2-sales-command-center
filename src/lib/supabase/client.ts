import { createBrowserClient } from "@supabase/ssr";

import { getPublicSupabaseConfig } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Supabase client for Client Components.
 *
 * Uses the anon key, so every request is still subject to Row Level Security.
 * `createBrowserClient` memoises internally, so calling this per component is
 * fine - do not hoist it into a module-level singleton.
 */
export function createSupabaseBrowserClient() {
  const { url, anonKey } = getPublicSupabaseConfig();

  return createBrowserClient<Database>(url, anonKey);
}
