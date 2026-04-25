import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ManualMemoryType } from "@/hooks/useApi";

export type AddManualMemoryDialogProps = {
  open: boolean;
  onClose: () => void;
  onSave: (text: string, memoryType: ManualMemoryType) => void | Promise<void>;
  loading?: boolean;
  errorText?: string | null;
};

/**
 * Modal for adding a user-confirmed manual memory (stored at full confidence on the server).
 */
export function AddManualMemoryDialog({
  open,
  onClose,
  onSave,
  loading = false,
  errorText,
}: AddManualMemoryDialogProps) {
  const [text, setText] = useState("");
  const [memoryType, setMemoryType] = useState<ManualMemoryType>("preference");

  useEffect(() => {
    if (open) {
      setText("");
      setMemoryType("preference");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, loading, onClose]);

  if (!open) return null;

  const trimmed = text.trim();
  const canSave = trimmed.length > 0 && !loading;

  const handleSubmit = () => {
    if (!canSave) return;
    void onSave(trimmed, memoryType);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm"
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && !loading && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-manual-memory-title"
        className="mx-4 w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="add-manual-memory-title" className="text-base font-semibold text-foreground">
          Add manual memory
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Saved with 100% confidence — Atlas treats this as a certain preference or constraint.
        </p>
        {errorText ? (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {errorText}
          </p>
        ) : null}
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-medium text-foreground" htmlFor="add-manual-memory-type">
            Type
          </label>
          <select
            id="add-manual-memory-type"
            value={memoryType}
            onChange={(e) => setMemoryType(e.target.value as ManualMemoryType)}
            disabled={loading}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="preference">Preference</option>
            <option value="goal">Goal</option>
            <option value="constraint">Constraint</option>
            <option value="learning_style">Learning style</option>
          </select>
          <label className="block text-sm font-medium text-foreground" htmlFor="add-manual-memory-text">
            Text
          </label>
          <textarea
            id="add-manual-memory-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={loading}
            rows={4}
            maxLength={2000}
            placeholder="Short phrase, e.g. Prefers morning sections"
            className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="sm:min-w-[100px]" disabled={loading} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" className="sm:min-w-[100px]" disabled={!canSave} onClick={handleSubmit}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Saving…
              </>
            ) : (
              "Save memory"
            )}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
