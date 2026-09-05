import {
  SHARE_TOKEN_BYTES,
  SHARE_TOKEN_MAX_LENGTH,
  SHARE_TOKEN_MIN_LENGTH,
} from "@/lib/share/config";

/**
 * Share tokens.
 *
 * A token is a CAPABILITY, not an identifier. Holding one is the whole of the
 * authorization to read one month's report, so the only property that matters
 * is that it cannot be arrived at by reasoning: not from a month id, not from
 * an HM id, not from a date, not from another token, and not by counting.
 *
 * Hence 32 bytes from the platform CSPRNG, base64url-encoded. Explicitly NOT:
 *
 *   a uuid                 - meaningful in the database, and v1/v7 leak time
 *   base64 of the month id - reversible, and the same for every link
 *   a slug or a date       - guessable in one attempt
 *   an incrementing id     - enumerable
 *
 * Pure and dependency-free: `crypto.getRandomValues` is on `globalThis` in
 * Node, in the Edge runtime and in browsers, so this file runs anywhere and is
 * testable without mocking. It is used on the server only, but nothing here
 * would be unsafe to bundle.
 */

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * The shape of a uuid, rejected explicitly.
 *
 * Not redundant with the checks below, which is the whole reason it is here: a
 * uuid is 36 characters, which clears the length floor, and its dashes are
 * legal base64url, so it satisfies the character class as well. Without this it
 * would pass the shape gate - and the single most obvious probe against this
 * feature is "try a month id as a token".
 *
 * It never reaches the lookup either way. This is about refusing to treat an
 * internal identifier as a capability at all, at the first opportunity, rather
 * than relying on it happening not to be in the table.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A fresh, cryptographically unpredictable share token. */
export function generateShareToken(bytes = SHARE_TOKEN_BYTES): string {
  const buffer = new Uint8Array(bytes);

  // Throws rather than falling back to Math.random if no CSPRNG is available.
  // A predictable token is worse than a failed generation: the failure is
  // visible and the PA retries, whereas a weak token is a public dashboard
  // nobody knows is public.
  crypto.getRandomValues(buffer);

  return toBase64Url(buffer);
}

/**
 * True when a string could have come from `generateShareToken`.
 *
 * A cheap shape check, run before the database is touched, so a probe carrying
 * a uuid, a month id, an empty string or a path fragment is rejected without a
 * query. It is not the security boundary - the token still has to exist, be
 * active and be unexpired - but it is what stops the obvious guesses
 * ("try the month id as a token") from even reaching the index, and it is
 * mirrored by `share_links_token_shape` in the database so neither side can
 * accept what the other would refuse.
 */
export function isShareTokenShaped(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= SHARE_TOKEN_MIN_LENGTH &&
    value.length <= SHARE_TOKEN_MAX_LENGTH &&
    BASE64URL.test(value) &&
    !UUID.test(value)
  );
}

/**
 * The `expires_at` for a link created now, or `null` for one that does not
 * expire.
 *
 * Resolved at creation and stored on the row rather than recomputed at read
 * time, so changing the policy never silently shortens or extends a link that
 * is already circulating.
 */
export function shareLinkExpiry(
  days: number | null,
  now: Date = new Date(),
): string | null {
  if (days === null || !Number.isFinite(days) || days <= 0) {
    return null;
  }

  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** True when a stored expiry has passed. `null` never expires. */
export function isExpired(
  expiresAt: string | null,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) {
    return false;
  }

  const at = new Date(expiresAt);

  // An unparseable stamp is treated as expired. The safe direction: a link that
  // stops working is a support question, one that should have stopped and did
  // not is a leak.
  return Number.isNaN(at.getTime()) || at.getTime() <= now.getTime();
}

/** Bytes -> base64url, unpadded. No Buffer, so this runs in every runtime. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
