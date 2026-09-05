/**
 * HM photo storage.
 *
 * Photos live in the `hm-photos` Supabase Storage bucket; the database only
 * holds the resulting URL in `hms.photo_url`. Every read and write goes through
 * this module, so switching the bucket from public to signed URLs later is a
 * one-file change.
 *
 * The upload UI itself belongs to a later stage - this is the contract it will
 * build on.
 */

export const HM_PHOTOS_BUCKET = "hm-photos";

/** Matches `allowed_mime_types` on the bucket. */
export const HM_PHOTO_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;

/** Matches `file_size_limit` on the bucket. */
export const HM_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Storage path for an HM's photo.
 *
 * Keyed by HM id and suffixed with a timestamp so a replacement gets a fresh
 * URL rather than being masked by a stale CDN cache entry.
 */
export function hmPhotoPath(hmId: string, fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "jpg";
  return `${hmId}/${Date.now()}.${extension}`;
}

export type PhotoValidationError = { message: string } | null;

export function validateHmPhoto(file: {
  type: string;
  size: number;
}): PhotoValidationError {
  if (!HM_PHOTO_MIME_TYPES.includes(file.type as (typeof HM_PHOTO_MIME_TYPES)[number])) {
    return { message: "Photo must be a JPEG, PNG, WebP or AVIF image." };
  }

  if (file.size > HM_PHOTO_MAX_BYTES) {
    return { message: "Photo must be 5 MB or smaller." };
  }

  return null;
}

/**
 * File extensions matching HM_PHOTO_MIME_TYPES, for path validation.
 * `jpg` and `jpeg` both map to image/jpeg.
 */
const HM_PHOTO_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "avif"] as const;

/**
 * The exact shape `hmPhotoPath()` produces: `<hm uuid>/<timestamp>.<ext>`.
 *
 * The browser uploads the file itself - a 5 MB image would blow past the
 * default Server Action body limit - and then hands the Server Action the
 * resulting *path*. The action derives the public URL from that path rather
 * than accepting a URL from the client, so `hms.photo_url` can only ever point
 * inside our own bucket. This regex is the check that makes that guarantee
 * hold, which is why it pins the HM id as well as the extension.
 */
export function isHmPhotoPathFor(hmId: string, path: string): boolean {
  // Parsed structurally rather than matched with an interpolated regex: the id
  // would have to be escaped before being spliced into a pattern, and splitting
  // on "/" rejects `<id>/../secret.png` on the segment count alone.
  const segments = path.split("/");

  if (segments.length !== 2 || segments[0] !== hmId) {
    return false;
  }

  const fileName = segments[1];
  const dot = fileName.lastIndexOf(".");

  if (dot <= 0) {
    return false;
  }

  const stem = fileName.slice(0, dot);
  const extension = fileName.slice(dot + 1).toLowerCase();

  return (
    /^[0-9]+$/.test(stem) &&
    (HM_PHOTO_EXTENSIONS as readonly string[]).includes(extension)
  );
}

/**
 * Storage path for a photo we previously stored, or null.
 *
 * Used to delete the old object after a replacement lands. Anything that is not
 * one of our own public URLs returns null and is simply left alone - deleting
 * based on a guessed path is how you remove somebody else's file.
 */
export function hmPhotoPathFromPublicUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }

  const marker = `/storage/v1/object/public/${HM_PHOTOS_BUCKET}/`;
  const index = url.indexOf(marker);

  if (index === -1) {
    return null;
  }

  const path = url.slice(index + marker.length).split("?")[0];

  return path.length > 0 ? decodeURIComponent(path) : null;
}
