import Link from "next/link";

import { DEFAULT_AUTHENTICATED_ROUTE } from "@/lib/routes";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-base font-semibold text-slate-900">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          That page does not exist.
        </p>
        <Link
          href={DEFAULT_AUTHENTICATED_ROUTE}
          className="mt-4 inline-block text-sm font-medium text-sky-700 hover:text-sky-800"
        >
          Back to the dashboard
        </Link>
      </div>
    </div>
  );
}
