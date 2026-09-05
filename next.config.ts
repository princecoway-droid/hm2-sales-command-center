import type { NextConfig } from "next";

/**
 * HTTP security headers.
 *
 * ---------------------------------------------------------------------------
 * What is here, and what is deliberately not
 * ---------------------------------------------------------------------------
 * Every directive below is one this application can satisfy today, verified
 * against the running production build. Nothing here is aspirational: a header
 * that has to be relaxed the first time somebody uploads a photo or signs in is
 * worse than no header, because the next person reads it as a guarantee.
 *
 * There is deliberately NO `script-src`, `style-src`, `img-src` or
 * `connect-src`:
 *
 *   script-src   Next.js inlines its own bootstrap and streaming payload, so a
 *                meaningful `script-src` needs a per-request nonce threaded
 *                through the proxy. That is a real change to how every page
 *                renders, and doing it badly ends in `'unsafe-inline'`, which
 *                is the header saying nothing while looking like it says
 *                something.
 *   img-src      HM photos are served from the Supabase Storage CDN, whose host
 *                is part of `NEXT_PUBLIC_SUPABASE_URL` and therefore differs
 *                per deployment.
 *   connect-src  Same: every Supabase call from the browser goes to that host.
 *
 * What remains is the set that costs nothing and closes real doors:
 * clickjacking, MIME sniffing, `<base>` hijacking, plugin content, and a form
 * posted from our own page to somebody else's server.
 */
const SECURITY_HEADERS = [
  {
    // frame-ancestors is the modern half of the clickjacking pair; the two
    // agree, and both are here because X-Frame-Options is what older browsers
    // and some corporate proxies actually read.
    key: "Content-Security-Policy",
    value: [
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  {
    // Cross-origin requests send the origin only, never the path. That matters
    // here specifically: a share URL carries the token IN THE PATH, so a
    // referrer that included it would hand the capability to whatever the
    // viewer clicked next.
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    // The app asks for none of these, so it declines them for itself and for
    // anything it embeds.
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  // `X-Powered-By: Next.js` tells an attacker which framework's advisories to
  // read. It buys nothing.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
      {
        /**
         * The public report gets the strictest referrer policy there is.
         *
         * Its URL *is* the credential. `strict-origin-when-cross-origin` would
         * already strip the token from a cross-origin referrer, but this page
         * is the one URL that leaves the building - pasted into WhatsApp,
         * opened on somebody's phone - so it sends no referrer at all rather
         * than relying on a policy the next browser might interpret loosely.
         */
        source: "/share/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
