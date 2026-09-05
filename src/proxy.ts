import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy-client";

/**
 * Next.js 16 renamed `middleware.ts` to `proxy.ts`; the behaviour is unchanged.
 * Runs before every matched request - see `updateSession` for what it does.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *   _next/static, _next/image  - build output
     *   favicon.ico, static assets - no session needed
     * Auth cookies still need refreshing on data requests, so API-ish routes
     * are intentionally left in.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)",
  ],
};
