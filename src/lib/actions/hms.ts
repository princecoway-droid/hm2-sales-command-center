"use server";

import { revalidatePath } from "next/cache";

import { isManager, requireAuth } from "@/lib/auth/session";
import { mapDatabaseError } from "@/lib/errors";
import { failure, success, type ActionState } from "@/lib/result";
import { ROUTES } from "@/lib/routes";
import {
  HM_PHOTOS_BUCKET,
  hmPhotoPathFromPublicUrl,
  isHmPhotoPathFor,
} from "@/lib/storage";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hmSchema } from "@/lib/validation/hm";
import { toFieldErrors, uuid } from "@/lib/validation/utils";
import { HM_STATUSES, type HMStatus } from "@/types/models";

/**
 * HM master-record mutations.
 *
 * Shape every action here follows:
 *
 *   1. `requireAuth()` - a Server Action is reachable by direct POST, so the
 *      guard belongs inside the function, not only on the page that renders the
 *      button.
 *   2. Validate with the Stage 1 Zod schema.
 *   3. Write through the request-scoped client, so RLS applies as the signed-in
 *      user. Nothing here touches the service-role client.
 *   4. Map a constraint violation back to a field.
 *
 * Audit columns are never sent: a database trigger stamps created_by/updated_by
 * from `auth.uid()`, and a client-supplied value would be overwritten anyway.
 */

/**
 * Every screen that names an HM is refreshed after a write.
 *
 * The dashboard and the HP listing are in the list because of the HM Code: it
 * is shown on the HM cards and on every HP row, and the Stage 8 import matches
 * on it, so an edit that left either page showing the old code would be an edit
 * the PA could not trust.
 */
function revalidateHmSurfaces(): void {
  revalidatePath(ROUTES.hmManagement);
  revalidatePath(ROUTES.dataEntry);
  revalidatePath(ROUTES.dashboard);
  revalidatePath(ROUTES.hpListing);
}

function readHmForm(formData: FormData) {
  return {
    name: formData.get("name"),
    hm_code: formData.get("hm_code"),
    office: formData.get("office"),
    status: formData.get("status") ?? "active",
    display_order: formData.get("display_order") || 0,
  };
}

export async function createHmAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAuth();

  const parsed = hmSchema.safeParse(readHmForm(formData));

  if (!parsed.success) {
    return failure(
      "Check the highlighted fields and try again.",
      toFieldErrors(parsed.error),
    );
  }

  const supabase = await createSupabaseServerClient();
  const { name, hm_code, office, status, display_order } = parsed.data;

  // photo_url is deliberately not settable here: a photo is uploaded against an
  // existing HM id, so it arrives through setHmPhotoAction once the row exists.
  const { error } = await supabase
    .from("hms")
    .insert({ name, hm_code, office, status, display_order });

  if (error) {
    const mapped = mapDatabaseError(error);
    return failure(mapped.message, mapped.fieldErrors);
  }

  revalidateHmSurfaces();

  return success(`${name} added.`);
}

export async function updateHmAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAuth();

  const id = uuid("HM").safeParse(formData.get("id"));

  if (!id.success) {
    return failure("That HM record could not be identified.");
  }

  const parsed = hmSchema.safeParse(readHmForm(formData));

  if (!parsed.success) {
    return failure(
      "Check the highlighted fields and try again.",
      toFieldErrors(parsed.error),
    );
  }

  const supabase = await createSupabaseServerClient();
  const { name, hm_code, office, status, display_order } = parsed.data;

  const { data, error } = await supabase
    .from("hms")
    .update({ name, hm_code, office, status, display_order })
    .eq("id", id.data)
    .select("id");

  if (error) {
    const mapped = mapDatabaseError(error);
    return failure(mapped.message, mapped.fieldErrors);
  }

  // A failing RLS `USING` clause does not raise - the statement simply matches
  // no rows. Treating that as success would tell the PA their edit saved when
  // the database refused it.
  if (!data || data.length === 0) {
    return failure(
      "That HM could not be updated. It may have been removed, or you may not have permission.",
    );
  }

  revalidateHmSurfaces();

  return success(`${name} updated.`);
}

/**
 * Activate or deactivate an HM.
 *
 * The everyday alternative to deletion. An inactive HM drops out of the current
 * month's grid but keeps every performance row they ever had, and still appears
 * on the months they worked.
 */
export async function setHmStatusAction(
  hmId: string,
  status: HMStatus,
): Promise<ActionState> {
  await requireAuth();

  const id = uuid("HM").safeParse(hmId);

  if (!id.success) {
    return failure("That HM record could not be identified.");
  }

  if (!HM_STATUSES.includes(status)) {
    return failure("Status must be active or inactive.");
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("hms")
    .update({ status })
    .eq("id", id.data)
    .select("id, name");

  if (error) {
    const mapped = mapDatabaseError(error);
    return failure(mapped.message, mapped.fieldErrors);
  }

  if (!data || data.length === 0) {
    return failure("That HM could not be updated.");
  }

  revalidateHmSurfaces();

  return success(
    `${data[0].name} ${status === "active" ? "activated" : "deactivated"}.`,
  );
}

/**
 * Permanently delete an HM. Manager only, matching the Stage 1 RLS policy.
 *
 * `hms.id` cascades into both performance tables, so this erases history.
 * Deactivation is the right answer for anyone who has ever worked a month; this
 * exists for records created by mistake.
 */
export async function deleteHmAction(hmId: string): Promise<ActionState> {
  const user = await requireAuth();

  // Checked rather than redirected: this runs behind a button, and a PA who
  // somehow reaches it should get a message, not be thrown off the page. RLS
  // enforces the same rule regardless of what happens here.
  if (!isManager(user)) {
    return failure("Only a manager can delete an HM record.");
  }

  const id = uuid("HM").safeParse(hmId);

  if (!id.success) {
    return failure("That HM record could not be identified.");
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("hms")
    .delete()
    .eq("id", id.data)
    .select("id");

  if (error) {
    const mapped = mapDatabaseError(error);
    return failure(mapped.message, mapped.fieldErrors);
  }

  if (!data || data.length === 0) {
    return failure(
      "That HM was not deleted. It may already be gone, or you may not have permission.",
    );
  }

  revalidateHmSurfaces();

  return success("HM deleted.");
}

/**
 * Point an HM at a photo that has already been uploaded to the bucket.
 *
 * The browser uploads the file itself, because a 5 MB image is far past the
 * default Server Action body limit and Supabase Storage already enforces the
 * size and MIME rules from the Stage 1 bucket policy.
 *
 * What the client sends is the storage *path*, never a URL. The public URL is
 * derived here, so `hms.photo_url` can only ever address our own bucket - a
 * client that posted `https://tracker.example/pixel.png` gets rejected by the
 * path check rather than having its URL stored and later rendered for every
 * viewer.
 */
export async function setHmPhotoAction(
  hmId: string,
  storagePath: string,
): Promise<ActionState> {
  await requireAuth();

  const id = uuid("HM").safeParse(hmId);

  if (!id.success) {
    return failure("That HM record could not be identified.");
  }

  if (!isHmPhotoPathFor(id.data, storagePath)) {
    return failure("That photo could not be saved. Please try uploading again.");
  }

  const supabase = await createSupabaseServerClient();

  const { data: existing, error: readError } = await supabase
    .from("hms")
    .select("photo_url")
    .eq("id", id.data)
    .maybeSingle();

  if (readError) {
    const mapped = mapDatabaseError(readError);
    return failure(mapped.message, mapped.fieldErrors);
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(HM_PHOTOS_BUCKET).getPublicUrl(storagePath);

  const { data, error } = await supabase
    .from("hms")
    .update({ photo_url: publicUrl })
    .eq("id", id.data)
    .select("id");

  if (error) {
    const mapped = mapDatabaseError(error);
    return failure(mapped.message, mapped.fieldErrors);
  }

  if (!data || data.length === 0) {
    return failure("That photo could not be attached to the HM record.");
  }

  // Best effort. The new photo is already live, so a failed cleanup leaves an
  // orphaned object rather than a broken avatar - not worth failing the action.
  const previousPath = hmPhotoPathFromPublicUrl(existing?.photo_url ?? null);

  if (previousPath && previousPath !== storagePath) {
    await supabase.storage.from(HM_PHOTOS_BUCKET).remove([previousPath]);
  }

  revalidateHmSurfaces();

  return success("Photo updated.");
}

/** Clears the photo, falling back to the initials avatar. */
export async function removeHmPhotoAction(hmId: string): Promise<ActionState> {
  await requireAuth();

  const id = uuid("HM").safeParse(hmId);

  if (!id.success) {
    return failure("That HM record could not be identified.");
  }

  const supabase = await createSupabaseServerClient();

  // Read before clearing: the UPDATE ... RETURNING would hand back the new
  // NULL, leaving nothing to identify the object that needs deleting.
  const { data: existing, error: readError } = await supabase
    .from("hms")
    .select("photo_url")
    .eq("id", id.data)
    .maybeSingle();

  if (readError) {
    const mapped = mapDatabaseError(readError);
    return failure(mapped.message, mapped.fieldErrors);
  }

  const { data, error } = await supabase
    .from("hms")
    .update({ photo_url: null })
    .eq("id", id.data)
    .select("id");

  if (error) {
    const mapped = mapDatabaseError(error);
    return failure(mapped.message, mapped.fieldErrors);
  }

  if (!data || data.length === 0) {
    return failure("That photo could not be removed.");
  }

  const previousPath = hmPhotoPathFromPublicUrl(existing?.photo_url ?? null);

  if (previousPath) {
    await supabase.storage.from(HM_PHOTOS_BUCKET).remove([previousPath]);
  }

  revalidateHmSurfaces();

  return success("Photo removed.");
}
