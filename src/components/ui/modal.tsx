"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type ModalProps = {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
};

/**
 * A single-level dialog, built on the native `<dialog>` element.
 *
 * `showModal()` brings focus trapping, the inert background, Escape-to-close and
 * the ::backdrop pseudo-element for free - all of which a hand-rolled overlay
 * would have to reimplement, usually incompletely.
 *
 * Deliberately not nestable: the HM screens open one dialog at a time, and a
 * stack of them is the thing that makes this kind of admin UI unusable.
 */
export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  className,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="modal-title"
      // `cancel` fires on Escape; without preventing it the element closes
      // itself and React's `open` prop falls out of step with the DOM.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(event) => {
        // The dialog box is a child, so a click landing on the element itself
        // is a click on the backdrop.
        if (event.target === dialogRef.current) {
          onClose();
        }
      }}
      className={cn(
        "glass-panel m-auto w-[min(32rem,calc(100vw-2rem))] p-0",
        // A blurred scrim rather than a flat wash: the page behind stays
        // recognisable as the place the dialog was opened from.
        "backdrop:bg-slate-900/25 backdrop:backdrop-blur-[3px]",
        className,
      )}
    >
      <div className="border-b hairline px-5 py-4">
        <h2
          id="modal-title"
          className="text-sm font-semibold tracking-tight text-slate-900"
        >
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        ) : null}
      </div>

      <div className="px-5 py-4">{children}</div>
    </dialog>
  );
}
