import { APP_NAME } from "@/lib/app";

/**
 * What an unusable share link shows.
 *
 * ONE message for every failure: never issued, revoked, expired, or bound to a
 * month that no longer exists. The reasons are deliberately not distinguished -
 * telling a visitor "this link was revoked" confirms it once existed, and
 * telling them "no such link" confirms the ones that do not get that message
 * do. A single generic answer gives a prober nothing to sort tokens by.
 *
 * There is nothing to click. No login prompt, no "request access", no link into
 * the application: somebody holding a dead token is not somebody to route
 * towards the sign-in page.
 */
export function ShareUnavailable() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-16 text-center">
      <div className="w-full max-w-sm">
        <h1 className="text-lg font-semibold tracking-tight text-slate-900">
          Report unavailable
        </h1>

        <p className="mt-2 text-sm text-slate-600">
          This report link is not available. Ask whoever shared it for a current
          link.
        </p>

        <p className="mt-8 text-xs text-slate-400">{APP_NAME}</p>
      </div>
    </main>
  );
}
