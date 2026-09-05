"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { HmAvatar } from "@/components/hm/hm-avatar";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { removeHmPhotoAction, setHmPhotoAction } from "@/lib/actions/hms";
import {
  HM_PHOTOS_BUCKET,
  HM_PHOTO_MAX_BYTES,
  HM_PHOTO_MIME_TYPES,
  hmPhotoPath,
  validateHmPhoto,
} from "@/lib/storage";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { HM } from "@/types/models";

type PhotoUploaderProps = {
  hm: HM;
  onDone: () => void;
};

/**
 * Uploads an HM photo.
 *
 * The file goes straight from the browser to Supabase Storage rather than
 * through a Server Action, for two reasons: a 5 MB image is well past the
 * default Server Action body limit, and the bucket already enforces the size
 * and MIME rules itself (Stage 1 storage migration), so routing the bytes
 * through the server would add a hop and a second copy of the same rules.
 *
 * The upload runs as the signed-in user with the anon key, so the storage
 * policy - active manager or PA - still decides whether it is allowed. Only the
 * resulting storage *path* is handed to the Server Action, which derives the
 * public URL server-side; the client never gets to choose what goes into
 * `hms.photo_url`.
 */
export function PhotoUploader({ hm, onDone }: PhotoUploaderProps) {
  /**
   * The chosen file and its preview URL, held together.
   *
   * An object URL is an external resource, not derived state: creating it in an
   * effect keyed on the file would render one frame with the new file and no
   * preview, and would need a second effect to revoke the old one. Minting and
   * revoking it in the same handler that changes the file keeps the two in step.
   */
  const [selection, setSelection] = useState<{
    file: File;
    previewUrl: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Releases each preview URL once it is no longer the current one.
   *
   * The cleanup closes over the selection it was created for, so it fires both
   * when a different file is chosen and when the dialog closes mid-selection -
   * an object URL pins the whole file in memory until it is revoked.
   */
  useEffect(() => {
    const url = selection?.previewUrl;

    return () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [selection]);

  function choose(selected: File | null) {
    setError(null);

    const problem = selected ? validateHmPhoto(selected) : null;

    if (problem) {
      setError(problem.message);

      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }

    setSelection(
      selected && !problem
        ? { file: selected, previewUrl: URL.createObjectURL(selected) }
        : null,
    );
  }

  async function upload() {
    if (!selection) {
      return;
    }

    const { file } = selection;

    setError(null);
    setIsUploading(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const path = hmPhotoPath(hm.id, file.name);

      const { error: uploadError } = await supabase.storage
        .from(HM_PHOTOS_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });

      if (uploadError) {
        setError(
          "The photo could not be uploaded. Check your connection and try again.",
        );
        return;
      }

      const result = await setHmPhotoAction(hm.id, path);

      if (result.status === "error") {
        setError(result.message ?? "The photo could not be saved.");
        return;
      }

      onDone();
    } finally {
      setIsUploading(false);
    }
  }

  function remove() {
    setError(null);

    startTransition(async () => {
      const result = await removeHmPhotoAction(hm.id);

      if (result.status === "error") {
        setError(result.message ?? "The photo could not be removed.");
        return;
      }

      onDone();
    });
  }

  const busy = isUploading || isPending;

  return (
    <div className="space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="flex items-center gap-4">
        <HmAvatar
          name={hm.name}
          photoUrl={selection?.previewUrl ?? hm.photo_url}
          size="lg"
        />
        <div className="min-w-0 text-sm">
          <p className="font-medium text-slate-900">{hm.name}</p>
          <p className="text-slate-500">
            {selection
              ? "Preview — not saved yet."
              : hm.photo_url
                ? "Current photo. Uploading a new one replaces it."
                : "No photo yet. Initials are shown instead."}
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor={`photo-${hm.id}`}
          className="block text-sm font-medium text-slate-700"
        >
          Choose an image
        </label>
        <input
          ref={inputRef}
          id={`photo-${hm.id}`}
          type="file"
          accept={HM_PHOTO_MIME_TYPES.join(",")}
          disabled={busy}
          onChange={(event) => choose(event.target.files?.[0] ?? null)}
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
        />
        <p className="text-xs text-slate-500">
          JPEG, PNG, WebP or AVIF, up to{" "}
          {Math.round(HM_PHOTO_MAX_BYTES / (1024 * 1024))} MB.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {hm.photo_url ? (
          <Button variant="ghost" onClick={remove} disabled={busy}>
            Remove photo
          </Button>
        ) : (
          <span />
        )}

        <div className="flex gap-2">
          <Button variant="secondary" onClick={onDone} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={upload} disabled={!selection || busy}>
            {isUploading ? "Uploading…" : "Save photo"}
          </Button>
        </div>
      </div>
    </div>
  );
}
