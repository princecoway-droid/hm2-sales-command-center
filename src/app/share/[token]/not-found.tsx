import { ShareUnavailable } from "@/components/share/share-unavailable";

/**
 * What `/share/<token>` shows when the token does not resolve.
 *
 * Segment-local, so an unusable share link gets this page and a 404 rather than
 * the application's own "page not found" - which links back into the app and
 * would send an outsider to a login screen they have no business at.
 */
export default function ShareNotFound() {
  return <ShareUnavailable />;
}
