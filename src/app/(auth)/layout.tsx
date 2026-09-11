import type { ReactNode } from "react";

import { APP_NAME, APP_TAGLINE } from "@/lib/app";

/** Centred, chrome-free layout for login and the no-access page. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            {APP_NAME}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{APP_TAGLINE}</p>
        </div>

        {children}
      </div>
    </div>
  );
}
