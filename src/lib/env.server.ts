import "server-only";

/**
 * Server-only environment configuration.
 *
 * `server-only` makes an accidental import from a Client Component a build
 * error rather than a leaked secret. Nothing in here may ever be re-exported
 * from a module that the browser bundle can reach.
 */

/**
 * The Supabase service-role key.
 *
 * Bypasses Row Level Security entirely, so it is read lazily and only by
 * `lib/supabase/admin.ts`. Stage 1 does not need it; `null` when unset.
 */
export function getServiceRoleKey(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

export function requireServiceRoleKey(): string {
  const key = getServiceRoleKey();

  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local to use the admin client.",
    );
  }

  return key;
}
