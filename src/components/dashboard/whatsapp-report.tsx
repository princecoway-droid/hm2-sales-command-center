"use client";

import { useCallback, useRef, useState, useTransition } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  generateShareReportAction,
  revokeShareLinkAction,
  type ShareReportPayload,
} from "@/lib/actions/share";
import type { ShareLinkSummary } from "@/lib/data/share";
import {
  applyRevokedLink,
  countShareLinks,
  isTokenRevoked,
} from "@/lib/share/link-list";
import { cn } from "@/lib/utils";

/**
 * Generate -> preview -> copy.
 *
 * Three steps and no fourth. The PA opens this, reads exactly what is about to
 * be pasted, copies it, and goes to WhatsApp; everything else on the panel -
 * the link, its terms, the list of links that exist - is there to be glanced at
 * rather than worked through.
 *
 * ---------------------------------------------------------------------------
 * The preview IS the message
 * ---------------------------------------------------------------------------
 * The textarea below holds the exact string the clipboard receives. It is not a
 * rendering of the report, or a summary of it, or a second build of it from the
 * same data - it is the string, generated once on the server by
 * `generateWhatsAppReport` and carried here whole. A preview that could differ
 * from what was copied would be worse than no preview at all.
 *
 * That also gives the clipboard fallback for free: when `navigator.clipboard`
 * is unavailable - an insecure origin, an old browser, a locked-down phone -
 * the text is already on screen, selectable, and the button selects it and says
 * so instead of failing silently.
 */

type WhatsAppReportProps = {
  /** The `?month=` value currently on screen. The report is about this month. */
  month: string;
  monthLabel: string;
};

export function WhatsAppReport({ month, monthLabel }: WhatsAppReportProps) {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<ShareReportPayload | null>(null);
  /**
   * Every link, held HERE rather than inside the list that draws it.
   *
   * This is the one piece of state two different actions both change - creating
   * a link and revoking one - so it belongs above both of them. Held lower, in
   * `useState(initialLinks)` inside the table, the initialiser would run once
   * and never again: creating a new link would insert a row in the database,
   * hand the fresh list back with the result, and the table would go on showing
   * the list it was mounted with until the page was reloaded.
   *
   * Re-seeded wholesale from the server on every generate, and updated in place
   * from the returned row on every revoke. Nothing here is guessed.
   */
  const [links, setLinks] = useState<ShareLinkSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const generate = useCallback(
    (options: { rotate?: boolean } = {}) => {
      setError(null);
      setNotice(null);

      startTransition(async () => {
        const result = await generateShareReportAction(month, options);

        if (result.status === "error" || !result.payload) {
          setError(result.message ?? "The report could not be generated.");
          return;
        }

        setPayload(result.payload);
        // The whole list, as the server sees it after the write. Rotating
        // revokes the old link and creates a new one in a single action, so a
        // merge of just the new row would leave the old one still reading
        // Active - two changes, one refreshed list.
        setLinks(result.payload.links);
        setNotice(result.message);
      });
    },
    [month],
  );

  /**
   * True once the PA revokes the very link this panel is showing.
   *
   * Derived from the list rather than stored alongside it. Without it, the
   * panel would go on offering a dead URL to copy; stored separately, it would
   * be a second answer to a question the list already answers, free to drift
   * from it. A link the list has not heard of is treated as live - the list is
   * capped at the most recent 25, and "not in the list" is not evidence of
   * revocation.
   */
  const currentRevoked = payload ? isTokenRevoked(links, payload.token) : false;

  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);

          // Regenerated on every open rather than cached: the point of the
          // report is that it carries today's figures, and a panel that showed
          // Tuesday's because it had been opened once already would be the
          // quietest possible way to post the wrong numbers.
          generate();
        }}
      >
        Generate WhatsApp report
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="WhatsApp report"
        description={`${monthLabel} · copy and paste into the HM2 group`}
        className="w-[min(46rem,calc(100vw-2rem))]"
      >
        <div className="space-y-4">
          {error ? (
            <Alert tone="error" title="Could not generate the report">
              <p>{error}</p>
            </Alert>
          ) : null}

          {notice ? <Alert tone="success">{notice}</Alert> : null}

          {isPending && !payload ? (
            <p className="py-8 text-center text-sm text-slate-500">
              Building the report…
            </p>
          ) : null}

          {payload ? (
            <>
              <ReportPreview text={payload.reportText} />

              <ShareLinkPanel
                payload={payload}
                revoked={currentRevoked}
                onRotate={() => generate({ rotate: true })}
                pending={isPending}
              />

              <ManageLinks
                links={links}
                onRevoked={(revoked) =>
                  setLinks((current) => applyRevokedLink(current, revoked))
                }
              />
            </>
          ) : null}

          <div className="flex justify-end gap-2 border-t hairline pt-4">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// -----------------------------------------------------------------------------
// Preview + copy
// -----------------------------------------------------------------------------

function ReportPreview({ text }: { text: string }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Report preview
        </h3>
        <CopyButton
          value={text}
          label="Copy report"
          copiedLabel="✓ Report copied"
          selectOnFallback={textareaRef}
        />
      </div>

      {/* Read-only rather than disabled: a disabled textarea cannot be focused,
          and focusing it is exactly what the clipboard fallback needs to do.
          `whitespace-pre` is not needed - a textarea preserves it - and the
          monospace face makes the dividers line up as they will in the chat. */}
      <textarea
        ref={textareaRef}
        readOnly
        value={text}
        rows={16}
        spellCheck={false}
        aria-label="WhatsApp report text"
        className="w-full rounded-control border hairline bg-white/60 p-3.5 font-mono text-xs leading-5 text-slate-800 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-sky-600"
      />
    </section>
  );
}

function ShareLinkPanel({
  payload,
  revoked,
  onRotate,
  pending,
}: {
  payload: ShareReportPayload;
  /** This link has just been switched off; it must stop being offered. */
  revoked: boolean;
  onRotate: () => void;
  pending: boolean;
}) {
  return (
    <section className="glass-card space-y-2 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Share link
        </h3>
        <span className="text-[11px] text-slate-500">
          {/* The terms are stated at the moment of generation, never left to be
              discovered when the link stops working. */}
          {revoked
            ? "Revoked"
            : payload.expiresAt
              ? `Expires ${formatStamp(payload.expiresAt)}`
              : "Does not expire · revoke to switch it off"}
        </span>
      </div>

      {revoked ? (
        <Alert tone="warning">
          <p>
            This link has been revoked and no longer opens the report. The
            message above still contains it — create a new link before sharing.
          </p>
        </Alert>
      ) : (
        <>
          <p className="rounded-inner border hairline bg-white/60 px-2.5 py-1.5 font-mono text-[11px] break-all text-slate-700">
            {payload.shareUrl}
          </p>

          <div className="flex flex-wrap gap-2">
            <CopyButton
              value={payload.shareUrl}
              label="Copy link"
              copiedLabel="✓ Link copied"
            />

            <a
              href={payload.shareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="glass-chrome inline-flex min-h-11 items-center justify-center rounded-control px-4 py-2 text-sm font-medium text-slate-700 shadow-[var(--shadow-control)] ring-1 ring-inset ring-slate-900/10 transition-colors hover:bg-white"
            >
              Open preview
            </a>
          </div>
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant={revoked ? "primary" : "ghost"}
          onClick={onRotate}
          disabled={pending}
        >
          {pending ? "Working…" : "Create a new link"}
        </Button>
      </div>

      <p className="text-[11px] text-slate-500">
        Read-only. It shows this month&apos;s figures and updates as they do -
        anyone with the link sees the group report, and nothing else.
      </p>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Clipboard
// -----------------------------------------------------------------------------

type CopyState = "idle" | "copied" | "manual";

/**
 * Copy, with a fallback that says what happened.
 *
 * `navigator.clipboard` needs a secure context. On plain http - which is what a
 * PA on the office LAN may well be on - it is simply absent, and a button that
 * did nothing would look like the app was broken. So the failure path selects
 * the text and tells them to press Ctrl+C, which is a working instruction
 * rather than an apology.
 */
function CopyButton({
  value,
  label,
  copiedLabel,
  selectOnFallback,
}: {
  value: string;
  label: string;
  copiedLabel: string;
  selectOnFallback?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [state, setState] = useState<CopyState>("idle");

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }

      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      const textarea = selectOnFallback?.current;

      if (textarea) {
        textarea.focus();
        textarea.select();
      }

      setState("manual");
    }

    window.setTimeout(() => setState("idle"), 3000);
  };

  return (
    <span className="flex items-center gap-2">
      <Button onClick={copy}>{label}</Button>

      {/* Announced, not just shown: the label does not change, so a screen
          reader user would otherwise get no confirmation at all. */}
      <span
        role="status"
        aria-live="polite"
        className={cn(
          "text-xs font-medium",
          state === "copied" && "text-emerald-700",
          state === "manual" && "text-amber-700",
        )}
      >
        {state === "copied" ? copiedLabel : null}
        {state === "manual"
          ? "Selected — press Ctrl+C (⌘C) to copy"
          : null}
      </span>
    </span>
  );
}

// -----------------------------------------------------------------------------
// Link management
// -----------------------------------------------------------------------------

/**
 * Every link that exists, and the one control that matters.
 *
 * Deliberately small: month, when it was made, whether it works, and a way to
 * switch it off. There is no editing, no analytics and no bulk anything -
 * managing share links is not a job anybody has, it is something they do twice
 * a year when a link needs withdrawing.
 */
function ManageLinks({
  links,
  onRevoked,
}: {
  /** Owned by the panel above; this table only draws it. */
  links: ShareLinkSummary[];
  /** The row as the database left it, for the owner to fold back in. */
  onRevoked: (link: ShareLinkSummary) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (links.length === 0) {
    return null;
  }

  /**
   * Revoke, then update the one row that changed.
   *
   * The action returns the revoked link, so there is nothing to re-read: no
   * second query, and no window in which the table shows Active for a link the
   * database has already switched off. Deliberately not a re-generate either -
   * that would ask for "this month's link", find none, and mint a replacement,
   * undoing the revoke that was just requested.
   */
  const revoke = (link: ShareLinkSummary) => {
    setError(null);

    startTransition(async () => {
      const result = await revokeShareLinkAction(link.id);

      if (result.status === "error" || !result.link) {
        setError(result.message ?? "That link could not be revoked.");
        return;
      }

      onRevoked(result.link);
    });
  };

  // Counted from the rows on screen rather than tracked alongside them, so the
  // heading cannot say "1 active" over a table showing two.
  const counts = countShareLinks(links);

  return (
    <details className="glass-card">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        All share links ({counts.total}) &middot; {counts.active} active
        &middot; {counts.revoked} revoked
      </summary>

      <div className="border-t hairline px-3 py-2">
        {error ? (
          <p className="mb-2 text-xs text-red-700" role="alert">
            {error}
          </p>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-xs">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                <th scope="col" className="py-1.5 pr-3 font-medium">Month</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">Created</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">Status</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">Expiry</th>
                <th scope="col" className="py-1.5 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {links.map((link) => (
                <tr key={link.id}>
                  <td className="py-2 pr-3 font-medium text-slate-900">
                    {link.monthLabel}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-slate-600">
                    {formatStamp(link.createdAt)}
                  </td>
                  <td className="py-2 pr-3">
                    {link.isActive ? (
                      <Badge tone="positive">Active</Badge>
                    ) : (
                      <Badge tone="muted">Revoked</Badge>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-slate-600">
                    {link.expiresAt ? formatStamp(link.expiresAt) : "None"}
                  </td>
                  <td className="py-2 text-right">
                    {link.isActive ? (
                      <button
                        type="button"
                        onClick={() => revoke(link)}
                        disabled={isPending}
                        className="rounded px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                      >
                        Revoke
                      </button>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

/**
 * A timestamp the office can read.
 *
 * Formatted in the browser here rather than on the server, unlike the dashboard
 * stamp: these dates sit inside a dialog that only ever exists after a click,
 * so there is no server render for a locale difference to mismatch against.
 */
function formatStamp(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}
