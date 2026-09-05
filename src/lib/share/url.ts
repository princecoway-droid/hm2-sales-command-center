/**
 * Building the application's own absolute address.
 *
 * Pure on purpose - no `next/headers`, no `process.env`, no clock. The wrapper
 * in `origin.ts` reads the environment and the request, and everything that can
 * actually be got wrong happens here, where it is testable against a plain
 * string rather than against a running server.
 *
 * The thing being got right is small and unforgiving: a share link is the one
 * URL this app produces that has to work somewhere else, and
 * `https://hm2.example.com//share/<token>` is a broken link that looks like a
 * working one on the way past.
 */

/**
 * A configured `NEXT_PUBLIC_APP_URL` reduced to a bare origin, or `null`.
 *
 * Deliberately strict, because this value is written by hand into a hosting
 * dashboard and read by nobody again:
 *
 *   trailing slashes  stripped, so `https://example.com/` and
 *                     `https://example.com` produce the same link rather than
 *                     one of them producing `//share/<token>`
 *   query and hash    dropped. An origin has neither, and a `?month=` left on
 *                     the end of the configured value would otherwise be
 *                     prepended to every share URL the app ever built - a
 *                     parameter influencing the share target, from the one
 *                     place nobody thinks to look
 *   scheme            http and https only. Anything else - `javascript:`,
 *                     `data:`, a bare `example.com` that parses as nothing -
 *                     is refused rather than pasted into a chat
 *
 * `null` means "not usable", and the caller falls back to the request host,
 * which is the same path an unset variable takes.
 */
export function normalizeAppUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  // `host` and not `hostname`: a non-default port is part of the address, and a
  // staging deployment on :8080 has to keep it.
  const path = stripTrailingSlashes(url.pathname);

  return `${url.protocol}//${url.host}${path}`;
}

/**
 * True when the configured app URL is an `https` origin.
 *
 * Lives here rather than next to the auth code because it is the same question
 * `normalizeAppUrl` already answers, asked from one step further back: it reuses
 * that parse, so a value this file calls unusable can never be read as secure.
 *
 * The caller is the session cookie (`lib/env.ts` -> the two Supabase clients).
 * `@supabase/ssr` defaults to `path=/; SameSite=Lax` with no `Secure`, so
 * without this the production session cookie would be sent over a plaintext
 * request to the same host. It deliberately fails OPEN - an unset or unparseable
 * value is `false`, which is what `npm run dev` on `http://localhost` needs, and
 * the failure mode of guessing wrong in the other direction is every login
 * silently looping.
 */
export function isHttpsAppUrl(value: string | null | undefined): boolean {
  return normalizeAppUrl(value)?.startsWith("https://") ?? false;
}

export type RequestOrigin = {
  /** `NEXT_PUBLIC_APP_URL`, verbatim. */
  configured?: string | null;
  host?: string | null;
  forwardedHost?: string | null;
  forwardedProto?: string | null;
};

/**
 * The origin to build share links against, or `null` when it cannot be known.
 *
 * Order of preference, and the reasoning is in `origin.ts`: the configured
 * value first because it is the only source a forwarded header cannot
 * influence, then the request's own host so a development link says
 * `localhost:3000` rather than nothing.
 */
export function resolveAppOrigin({
  configured,
  host,
  forwardedHost,
  forwardedProto,
}: RequestOrigin): string | null {
  const fromConfig = normalizeAppUrl(configured);

  if (fromConfig) {
    return fromConfig;
  }

  const requestHost = cleanHost(forwardedHost) ?? cleanHost(host);

  if (!requestHost) {
    return null;
  }

  const proto = forwardedProto?.split(",")[0]?.trim().toLowerCase();
  const protocol =
    proto === "http" || proto === "https"
      ? proto
      : isLocal(requestHost)
        ? "http"
        : "https";

  return `${protocol}://${requestHost}`;
}

/**
 * `origin` + `path`, with exactly one slash between them.
 *
 * The origin arrives with its trailing slashes already stripped, so this is the
 * second half of the same guarantee rather than a duplicate of it: a path that
 * somehow arrives without a leading slash still produces one separator, and a
 * `null` origin yields the relative path unchanged - which is what a local
 * `next dev` with no Host header should show, rather than a link to nowhere.
 */
export function joinUrl(origin: string | null, path: string): string {
  if (!origin) {
    return path;
  }

  return `${origin}/${path.replace(/^\/+/, "")}`;
}

/**
 * A `Host` header reduced to something safe to put in a URL, or `null`.
 *
 * A header carrying a slash, whitespace or a scheme is not a host; it is
 * somebody trying to make the origin end somewhere other than where it looks
 * like it ends. Refused rather than repaired.
 */
function cleanHost(value: string | null | undefined): string | null {
  const host = value?.split(",")[0]?.trim();

  if (!host || /[\s/\?#@]/.test(host)) {
    return null;
  }

  return host;
}

function isLocal(host: string): boolean {
  const name = host.split(":")[0]?.toLowerCase() ?? "";

  return name === "localhost" || name === "127.0.0.1" || name === "[::1]";
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}
