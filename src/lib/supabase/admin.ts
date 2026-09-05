import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getPublicSupabaseConfig } from "@/lib/env";
import { requireServiceRoleKey } from "@/lib/env.server";
import type { Database } from "@/types/database";

/**
 * Privileged Supabase client.
 *
 * BYPASSES ROW LEVEL SECURITY. Reserve it for server-side administrative work
 * that genuinely cannot run as the signed-in user - provisioning an account,
 * say. Everything a manager or PA does in the app must go through
 * `createSupabaseServerClient()` so their role is actually enforced.
 *
 * Guarded by `server-only` plus a lazy read of the key, so the browser bundle
 * can never pull it in and a missing key fails loudly at the call site rather
 * than silently downgrading to anon access.
 */
export function createSupabaseAdminClient() {
  const { url } = getPublicSupabaseConfig();

  return createClient<Database>(url, requireServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
