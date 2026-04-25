import { createPortal } from "react-dom";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TranscriptReviewEntry } from "@/hooks/useApi";

type TranscriptDialogEntry = Omit<TranscriptReviewEntry, "status"> & {
  status: TranscriptReviewEntry["status"] | "verifying";
};

type TranscriptReviewDialogProps = {
  open: boolean;
  entries: TranscriptDialogEntry[];
  loading?: boolean;
  verifying?: boolean;
  errorText?: string | null;
  onClose: () => void;
  onChangeEntry: (idx: number, next: TranscriptDialogEntry) => void;
  onRemoveEntry: (idx: number) => void;
  onSave: () => void;
};

export function TranscriptReviewDialog({
  open,
  entries,
  loading = false,
  verifying = false,
  errorText,
  onClose,
  onChangeEntry,
  onRemoveEntry,
  onSave,
}: TranscriptReviewDialogProps) {
  if (!open) return null;

  const unresolvedAmbiguous = entries.some(
    (entry) => entry.status === "ambiguous" && !entry.selectedCourseCode,
  );
  const hasVerifyingRows = entries.some((entry) => entry.status === "verifying");
  const hasEntries = entries.length > 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm"
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && !loading && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="transcript-review-title"
        className="mx-4 w-full max-w-3xl rounded-2xl border border-border bg-card p-5 shadow-xl"
        data-testid="transcript-review-dialog"
      >
        <h2 id="transcript-review-title" className="text-base font-semibold text-foreground">
          Review transcript import
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Resolve ambiguous entries before saving to completed course history.
        </p>
        {errorText ? (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {errorText}
          </p>
        ) : null}
        {verifying ? (
          <div className="mt-3 flex items-center justify-center gap-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Verifying extracted courses with SIS...
          </div>
        ) : null}
        <div className="mt-4 max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {entries.map((entry, idx) => (
            <div key={`${entry.rawCode}-${idx}`} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{entry.canonicalCode}</span>
                    <span
                      className={
                        entry.status === "matched"
                          ? "rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700"
                          : entry.status === "ambiguous"
                            ? "rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700"
                            : entry.status === "verifying"
                              ? "inline-flex items-center gap-1 rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700"
                            : "rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                      }
                    >
                      {entry.status === "verifying" ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          verifying
                        </>
                      ) : (
                        entry.status
                      )}
                    </span>
                  </div>
                  {(entry.status === "matched" || entry.selectedCourseCode) && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {entry.status === "matched"
                        ? entry.resolvedCourseTitle ?? "Matched course title unavailable"
                        : entry.optionDetails?.find((d) => d.courseCode === entry.selectedCourseCode)?.title ??
                          "Selected course title unavailable"}
                    </p>
                  )}
                </div>
                <span
                  className="shrink-0"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => onRemoveEntry(idx)}
                    disabled={loading}
                    aria-label={`Remove ${entry.canonicalCode}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </span>
              </div>

              {entry.status === "ambiguous" ? (
                <div className="mt-2">
                  <label className="block text-xs text-muted-foreground" htmlFor={`transcript-option-${idx}`}>
                    Select the correct course
                  </label>
                  <select
                    id={`transcript-option-${idx}`}
                    data-testid={`transcript-option-${idx}`}
                    className="mt-1 w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                    value={entry.selectedCourseCode ?? ""}
                    disabled={loading}
                    onChange={(e) => onChangeEntry(idx, { ...entry, selectedCourseCode: e.target.value || undefined })}
                  >
                    <option value="">Choose one…</option>
                    {entry.options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                        {entry.optionDetails?.find((d) => d.courseCode === opt)?.title
                          ? ` - ${entry.optionDetails?.find((d) => d.courseCode === opt)?.title}`
                          : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={loading} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            data-testid="transcript-save-button"
            disabled={loading || verifying || hasVerifyingRows || unresolvedAmbiguous || !hasEntries}
            onClick={onSave}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save transcript courses"
            )}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

