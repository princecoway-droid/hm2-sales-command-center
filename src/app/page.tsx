import { redirect } from "next/navigation";

import { DEFAULT_AUTHENTICATED_ROUTE } from "@/lib/routes";

/** The app has no marketing surface; `/` is just a doorway. */
export default function RootPage() {
  redirect(DEFAULT_AUTHENTICATED_ROUTE);
}
