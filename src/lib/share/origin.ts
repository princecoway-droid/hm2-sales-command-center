import "server-only";

import { headers } from "next/headers";

import { joinUrl, normalizeAppUrl, resolveAppOrigin } from "@/lib/share/url";

/**
 * The origin a share link should be built against.
 *
 * A share link is the one URL this application produces that has to work
 * somewhere else - pasted into WhatsApp, opened on a phone, on a different
 * network. So it cannot be relative, and the app has to know its own address.
 *
 * Order of preference:
 *
 *   1. `NEXT_PUBLIC_APP_URL`, when configured. The authoritative answer, and
 *      the one to set in production - it is the only source a proxy header
 *      cannot influence.
 *   2. The request's own `Host`, honouring `X-Forwarded-*` so the link is right
 *      behind Vercel, a load balancer or a tunnel rather than saying
 *      `localhost:3000` to somebody on the other side of one.
 *
 * The forwarded headers are attacker-influenceable in principle. The blast
 * radius here is small and worth stating plainly: this value is only ever used
 * to build a link that is shown to the signed-in PA who asked for it, never to
 * decide access, redirect a browser, or address a request. A poisoned header
 * produces a link that does not work, which the PA sees immediately - and
 * setting `NEXT_PUBLIC_APP_URL` removes even that.
 *
 * The rules themselves - trailing slashes, schemes, what is not a host - live
 * in `lib/share/url.ts`, which is pure and tested. This function is only the
 * two reads.
 */
export async function getAppOrigin(): Promise<string | null> {
  // Written as the full literal rather than looked up dynamically: Next.js
  // inlines `process.env.NEXT_PUBLIC_X` at build time only when it can see the
  // whole expression.
  const configured = process.env.NEXT_PUBLIC_APP_URL;

  warnOnUnusableAppUrl(configured);

  const headerList = await headers();

  return resolveAppOrigin({
    configured,
    host: headerList.get("host"),
    forwardedHost: headerList.get("x-forwarded-host"),
    forwardedProto: headerList.get("x-forwarded-proto"),
  });
}

/** An absolute URL for a path, or the path itself when the origin is unknown. */
export async function absoluteUrl(path: string): Promise<string> {
  return joinUrl(await getAppOrigin(), path);
}

let warned = false;

/**
 * Says so, once, when `NEXT_PUBLIC_APP_URL` is set to something unusable.
 *
 * The fallback is silent by design - a blank variable in development is the
 * normal case - but a variable that was *set* and then ignored is a
 * misconfiguration, and the symptom is a share link that quietly says
 * `localhost` to somebody's phone. Logged rather than thrown: a wrong address
 * should not take the dashboard down.
 */
function warnOnUnusableAppUrl(configured: string | undefined): void {
  if (warned || !configured?.trim() || normalizeAppUrl(configured)) {
    return;
  }

  warned = true;
  console.warn(
    "[share] NEXT_PUBLIC_APP_URL is set but is not a usable http(s) origin; " +
      "falling back to the request host. Expected something like " +
      "https://hm2.example.com",
  );
}
