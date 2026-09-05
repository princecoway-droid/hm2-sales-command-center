import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";

/**
 * Shown while the dashboard's data is being fetched.
 *
 * Next renders this instantly on navigation and swaps in the page when the
 * server render completes - which is why the skeleton mirrors the real
 * layout's measurements rather than being a spinner: the swap should look like
 * figures appearing, not like the page rebuilding itself.
 */
export default function DashboardLoading() {
  return <DashboardSkeleton />;
}
