/**
 * Public environment configuration.
 *
 * Safe to import from anywhere, client included: it only ever touches
 * `NEXT_PUBLIC_*` variables. Server-only secrets live in `env.server.ts`, which
 * is marked `server-only` so importing it from a Client Component fails the
 * build.
 *
 * The two references below are written as full literals on purpose - Next.js
 * inlines `process.env.NEXT_PUBLIC_X` at build time only when it can see the
 * whole expression, so dynamic lookups would come back undefined in the browser.
 */

import { isHttpsAppUrl } from "@/lib/share/url";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const appUrl = process.env.NEXT_PUBLIC_APP_URL;

export type PublicSupabaseConfig = {
  url: string;
  anonKey: string;
};

const MISSING_CONFIG_MESSAGE = [
  "Supabase is not configured.",
  "Copy .env.example to .env.local and set NEXT_PUBLIC_SUPABASE_URL and",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY, then restart the dev server.",
].join(" ");

/**
 * True when both public Supabase variables are present.
 *
 * Lets pages render an actionable "not configured yet" state instead of a stack
 * trace on a fresh checkout.
 */
export function hasPublicSupabaseConfig(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

/** Throws a pointed error when the public Supabase variables are missing. */
export function getPublicSupabaseConfig(): PublicSupabaseConfig {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(MISSING_CONFIG_MESSAGE);
  }

  return { url: supabaseUrl, anonKey: supabaseAnonKey };
}

/**
 * Whether the Supabase auth cookie should carry `Secure`.
 *
 * `@supabase/ssr` ships `path=/; SameSite=Lax; HttpOnly=false` and no `Secure`.
 * `HttpOnly=false` is by design - the browser client reads the cookie, which is
 * how the photo uploader authenticates straight to Storage - but the missing
 * `Secure` is not: without it a production session cookie is sent on any
 * plaintext request to the same host.
 *
 * `NEXT_PUBLIC_APP_URL` is the answer to "what is my address", it is required in
 * production, and it is the only source a forwarded header cannot influence -
 * so an `https` value there is exactly the statement "this deployment is served
 * over TLS". Deriving the flag from it rather than from the request means every
 * response agrees, including the ones written by the proxy before any page
 * renders.
 *
 * Blank, `http`, or unparseable -> `false`, which is what local development
 * over `http://localhost` needs. Failing open is deliberate: a `Secure` cookie
 * on a plaintext origin is dropped by the browser, and a dropped session cookie
 * is a login that loops forever with nothing in the log.
 */
export function shouldUseSecureCookies(): boolean {
  return isHttpsAppUrl(appUrl);
}

export { MISSING_CONFIG_MESSAGE };
