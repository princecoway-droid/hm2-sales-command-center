import { HmDetailSkeleton } from "@/components/hm-detail/hm-detail-skeleton";

/**
 * Shown while an HM's figures are being fetched.
 *
 * It exists so that arriving from a dashboard card does NOT fall back to the
 * dashboard's own skeleton one segment up - eight KPI cards and a bar chart
 * flashing up before an HM profile appears would look like the wrong page
 * loading.
 */
export default function HmDetailLoading() {
  return <HmDetailSkeleton />;
}
