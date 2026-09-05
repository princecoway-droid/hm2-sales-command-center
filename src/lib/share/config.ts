/**
 * Share-link policy, in one place.
 *
 * ---------------------------------------------------------------------------
 * The expiry decision, and why it is what it is
 * ---------------------------------------------------------------------------
 * Share links do NOT expire by default. They live until somebody revokes them.
 *
 * The alternative considered was a seven-day expiry. It was rejected because of
 * where these links actually live: a WhatsApp group, scrolled back to. A report
 * that quietly stops working ten days after it was posted is indistinguishable,
 * to the twenty people in that group, from the dashboard being broken - and the
 * PA finds out about it from them rather than from the app. Revocation is the
 * honest version of the same control: it is deliberate, it is visible in the
 * link list, and it happens when somebody decides it should.
 *
 * The schema, the resolver and the tests all support expiry regardless, so
 * turning it on is this one constant. Set it to a number of days and every link
 * created from then on carries an `expires_at`; existing links keep the terms
 * they were created under, which is the point of storing the date on the row
 * rather than computing it at read time.
 *
 * Whatever this says, the UI states the terms at the moment of generation -
 * "Does not expire" or the expiry date - so nothing about a link's lifetime is
 * left to be discovered.
 */

/** Days until a newly created share link expires. `null` = no expiry. */
export const SHARE_LINK_EXPIRY_DAYS: number | null = null;

/**
 * Bytes of randomness in a token. 32 bytes = 256 bits.
 *
 * Far past the point where guessing is the attack: the interesting property is
 * that it is generated from a CSPRNG and derived from nothing - not the month,
 * not an HM, not a row id, not a counter.
 */
export const SHARE_TOKEN_BYTES = 32;

/** Length of the base64url encoding of `SHARE_TOKEN_BYTES`, unpadded. */
export const SHARE_TOKEN_LENGTH = 43;

/**
 * The shortest token the database will store.
 *
 * Mirrors `share_links_token_length`. Kept looser than `SHARE_TOKEN_LENGTH` so
 * a future change to the byte count does not have to be a migration, but tight
 * enough that a uuid (36) or a month id is rejected on length alone.
 */
export const SHARE_TOKEN_MIN_LENGTH = 32;
export const SHARE_TOKEN_MAX_LENGTH = 128;
