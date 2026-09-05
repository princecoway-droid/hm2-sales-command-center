"use client";

import { useState, useTransition } from "react";

import { HmAvatar } from "@/components/hm/hm-avatar";
import { HmForm } from "@/components/hm/hm-form";
import { PhotoUploader } from "@/components/hm/photo-uploader";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { deleteHmAction, setHmStatusAction } from "@/lib/actions/hms";
import type { HM } from "@/types/models";

type HmManagementTableProps = {
  hms: readonly HM[];
  /** Deleting outright is manager-only, matching the RLS policy. */
  canDelete: boolean;
};

type DialogState =
  | { kind: "closed" }
  | { kind: "add" }
  | { kind: "edit"; hm: HM }
  | { kind: "photo"; hm: HM }
  | { kind: "delete"; hm: HM };

/**
 * The HM master list.
 *
 * One flat table with the actions on the row. Everything that needs a form
 * opens exactly one dialog and closes it again - no nesting, no drawer inside a
 * modal, because the whole job here is four fields and a photo.
 */
export function HmManagementTable({ hms, canDelete }: HmManagementTableProps) {
  const [dialog, setDialog] = useState<DialogState>({ kind: "closed" });
  const [notice, setNotice] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const close = () => setDialog({ kind: "closed" });

  function toggleStatus(hm: HM) {
    const next = hm.status === "active" ? "inactive" : "active";
    setPendingId(hm.id);
    setNotice(null);

    startTransition(async () => {
      const result = await setHmStatusAction(hm.id, next);

      setPendingId(null);
      setNotice({
        tone: result.status === "error" ? "error" : "success",
        message: result.message ?? "Done.",
      });
    });
  }

  function confirmDelete(hm: HM) {
    setPendingId(hm.id);
    setNotice(null);

    startTransition(async () => {
      const result = await deleteHmAction(hm.id);

      setPendingId(null);
      close();
      setNotice({
        tone: result.status === "error" ? "error" : "success",
        message: result.message ?? "Done.",
      });
    });
  }

  return (
    <div className="space-y-4">
      {notice ? (
        <Alert tone={notice.tone === "error" ? "error" : "success"}>
          {notice.message}
        </Alert>
      ) : null}

      <div className="flex justify-end">
        <Button onClick={() => setDialog({ kind: "add" })}>Add HM</Button>
      </div>

      {hms.length === 0 ? (
        <Alert tone="info" title="No HMs yet">
          <p>
            Add the Health Managers who report into this group. Names are never
            hardcoded — everything the dashboard shows comes from this list.
          </p>
        </Alert>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th scope="col" className="py-2 pr-4 font-medium">
                  HM
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Office
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Order
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Status
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {hms.map((hm) => {
                const busy = pendingId === hm.id;

                return (
                  <tr key={hm.id} className={busy ? "opacity-60" : undefined}>
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-3">
                        <HmAvatar name={hm.name} photoUrl={hm.photo_url} />
                        <span className="font-medium text-slate-900">
                          {hm.name}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-slate-600">{hm.office}</td>
                    <td className="py-2.5 pr-4 tabular-nums text-slate-500">
                      {hm.display_order}
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge tone={hm.status === "active" ? "positive" : "muted"}>
                        {hm.status === "active" ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="py-2.5">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          variant="ghost"
                          onClick={() => setDialog({ kind: "edit", hm })}
                          disabled={busy}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => setDialog({ kind: "photo", hm })}
                          disabled={busy}
                        >
                          Photo
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => toggleStatus(hm)}
                          disabled={busy}
                        >
                          {hm.status === "active" ? "Deactivate" : "Activate"}
                        </Button>
                        {canDelete ? (
                          <Button
                            variant="ghost"
                            className="text-red-700 hover:bg-red-50"
                            onClick={() => setDialog({ kind: "delete", hm })}
                            disabled={busy}
                          >
                            Delete
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={dialog.kind === "add"}
        title="Add HM"
        description="A photo can be added once the record exists."
        onClose={close}
      >
        {dialog.kind === "add" ? (
          <HmForm
            onSaved={() => {
              close();
              setNotice({ tone: "success", message: "HM added." });
            }}
            onCancel={close}
          />
        ) : null}
      </Modal>

      <Modal
        open={dialog.kind === "edit"}
        title="Edit HM"
        onClose={close}
      >
        {dialog.kind === "edit" ? (
          <HmForm
            hm={dialog.hm}
            onSaved={() => {
              close();
              setNotice({ tone: "success", message: "HM updated." });
            }}
            onCancel={close}
          />
        ) : null}
      </Modal>

      <Modal
        open={dialog.kind === "photo"}
        title="HM photo"
        description="Replaces the current photo. The old file is removed."
        onClose={close}
      >
        {dialog.kind === "photo" ? (
          <PhotoUploader
            hm={dialog.hm}
            onDone={() => {
              close();
              setNotice({ tone: "success", message: "Photo updated." });
            }}
          />
        ) : null}
      </Modal>

      <Modal
        open={dialog.kind === "delete"}
        title="Delete HM permanently?"
        onClose={close}
      >
        {dialog.kind === "delete" ? (
          <div className="space-y-4">
            <Alert tone="warning" title="This also deletes their history">
              <p>
                Every monthly and weekly performance record for{" "}
                <span className="font-medium">{dialog.hm.name}</span> is removed
                with them, on every month.
              </p>
              <p className="mt-1">
                Deactivating keeps the history and takes them out of the current
                month instead — that is almost always what you want for someone
                who has actually worked a month.
              </p>
            </Alert>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button
                className="bg-red-700 hover:bg-red-800 focus-visible:outline-red-700"
                onClick={() => confirmDelete(dialog.hm)}
                disabled={pendingId === dialog.hm.id}
              >
                {pendingId === dialog.hm.id ? "Deleting…" : "Delete permanently"}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
