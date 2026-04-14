import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

const REQUIRED_PHRASE = "DELETE";

export type DeleteAccountDialogProps = {
  open: boolean;
  onCancel: () => void;
  /** Called after the user types DELETE and confirms (second step). */
  onConfirm: () => void;
  loading?: boolean;
  /** Shown under the description when the last delete attempt failed. */
  errorText?: string | null;
};

/**
 * Modal: explains impact, requires typing DELETE, then allows destructive confirm.
 */
export function DeleteAccountDialog({
  open,
  onCancel,
  onConfirm,
  loading = false,
  errorText,
}: DeleteAccountDialogProps) {
  const [phrase, setPhrase] = useState("");

  useEffect(() => {
    if (!open) setPhrase("");
  }, [open]);

  if (!open) return null;

  const phraseOk = phrase.trim().toUpperCase() === REQUIRED_PHRASE;
  const canSubmit = phraseOk && !loading;

  // Portal to document.body so `position: fixed` is viewport-relative (not clipped or offset by header/transform ancestors).
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm"
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && !loading && onCancel()}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-account-title"
        aria-describedby="delete-account-desc"
        className="mx-4 w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
      >
        <h2 id="delete-account-title" className="text-base font-semibold">
          Delete account?
        </h2>
        <p
          id="delete-account-desc"
          className="mt-2 text-sm text-muted-foreground leading-relaxed"
        >
          This permanently removes your Atlas profile, all saved memories, schedules, and chat
          history. You cannot undo this.
        </p>
        {errorText ? (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {errorText}
          </p>
        ) : null}
        <label htmlFor="delete-account-confirm" className="mt-4 block text-sm font-medium text-foreground">
          Type <span className="font-mono">{REQUIRED_PHRASE}</span> to confirm
        </label>
        <input
          id="delete-account-confirm"
          type="text"
          autoComplete="off"
          disabled={loading}
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder={REQUIRED_PHRASE}
          data-testid="delete-account-confirm-input"
        />
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="sm:min-w-[100px]" disabled={loading} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="sm:min-w-[100px]"
            disabled={!canSubmit}
            data-testid="delete-account-confirm-button"
            onClick={onConfirm}
          >
            {loading ? "Deleting…" : "Delete my account"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
