import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  Brain,
  ChevronDown,
  Loader2,
  MessageSquare,
  PenLine,
  Trash2,
} from "lucide-react";
import Header from "@/components/Header";
import { AddManualMemoryDialog } from "@/components/AddManualMemoryDialog";
import { DeleteAccountDialog } from "@/components/DeleteAccountDialog";
import { TranscriptReviewDialog } from "@/components/TranscriptReviewDialog";
import { Button } from "@/components/ui/button";
import {
  useApi,
  type ManualMemoryType,
  type MemoryItem,
  type SisCourseSuggestion,
  type TranscriptReviewEntry,
} from "@/hooks/useApi";
import { extractTranscriptCoursesFromPdf } from "@/lib/transcriptParser";
import { cn } from "@/lib/utils";

type TranscriptReviewDialogEntry = Omit<TranscriptReviewEntry, "status"> & {
  status: TranscriptReviewEntry["status"] | "verifying";
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Compact MM/DD (year in parent `title` on `<time>`). */
function formatShortMonthDay(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}`;
}

function memoryTypeAbbrev(type: string): { letter: string; fullLabel: string } {
  const key = type.toLowerCase();
  if (key === "constraint") return { letter: "C", fullLabel: "Constraint" };
  if (key === "goal") return { letter: "G", fullLabel: "Goal" };
  if (key === "preference") return { letter: "P", fullLabel: "Preference" };
  if (key === "learning_style") return { letter: "L", fullLabel: "Learning style" };
  const words = type.replace(/_/g, " ");
  return { letter: words.slice(0, 1).toUpperCase() || "?", fullLabel: words };
}

function isDeletableSource(source: string): boolean {
  return source === "chat" || source === "manual";
}

/** Filled wedge from 12 o'clock clockwise; 0 = empty track, 1 = full circle. */
function ConfidencePie({ confidence }: { confidence: number }) {
  const pct = Math.min(1, Math.max(0, confidence));
  const pctLabel = `${(pct * 100).toFixed(0)}%`;
  const fillDeg = pct * 360;
  return (
    <div
      className="h-5 w-5 shrink-0 rounded-full border border-border bg-background p-[2px]"
      title={`Confidence ${pctLabel}`}
      role="img"
      aria-label={`Confidence ${pctLabel}`}
    >
      <div
        className="h-full w-full rounded-full"
        style={{
          background: `conic-gradient(from -90deg, hsl(var(--primary) / 1) 0deg ${fillDeg}deg, hsl(var(--muted) / 0.55) ${fillDeg}deg 360deg)`,
        }}
      />
    </div>
  );
}

function MemorySourceIcon({ source }: { source: string }) {
  if (source === "chat") {
    return (
      <span
        title="Chat"
        aria-label="From chat"
        className="flex h-6 w-6 cursor-default items-center justify-center rounded border border-border bg-muted/60 text-muted-foreground"
      >
        <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      </span>
    );
  }
  if (source === "manual") {
    return (
      <span
        title="Manual"
        aria-label="Manual entry"
        className="flex h-6 w-6 cursor-default items-center justify-center rounded border border-border bg-muted/60 text-muted-foreground"
      >
        <PenLine className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      </span>
    );
  }
  return (
    <span
      title={source}
      className="flex h-6 min-w-[1.5rem] cursor-default items-center justify-center rounded border border-border bg-muted/60 px-1 text-[10px] font-semibold uppercase text-foreground"
    >
      {source.slice(0, 1)}
    </span>
  );
}

function DeletableMemoryRow({
  memory,
  onDelete,
  deleting,
}: {
  memory: MemoryItem;
  onDelete: (id: string) => void;
  deleting: boolean;
}) {
  const { letter, fullLabel } = memoryTypeAbbrev(memory.type);
  return (
    <div className="flex h-full min-h-0 min-w-0 gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-sm sm:gap-3">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <p className="min-h-0 flex-1 break-words text-sm leading-snug text-foreground">{memory.text}</p>
        <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-1.5">
          <abbr
            title={fullLabel}
            className="flex h-6 min-w-[1.5rem] cursor-default select-none items-center justify-center rounded border border-border bg-muted/60 px-1.5 text-xs font-semibold tracking-tight text-foreground no-underline"
          >
            {letter}
          </abbr>
          <MemorySourceIcon source={memory.source} />
          <ConfidencePie confidence={memory.confidence} />
          <time
            dateTime={memory.createdAt}
            title={formatWhen(memory.createdAt)}
            className="text-xs tabular-nums text-muted-foreground"
          >
            {formatShortMonthDay(memory.createdAt)}
          </time>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end justify-start pt-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          aria-label="Delete memory"
          disabled={deleting}
          onClick={() => onDelete(memory.id)}
        >
          {deleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

function NonDeletableMemoryRow({ memory }: { memory: MemoryItem }) {
  const { letter, fullLabel } = memoryTypeAbbrev(memory.type);
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
      <p className="min-h-0 flex-1 break-words text-sm leading-snug text-foreground">{memory.text}</p>
      <div className="mt-auto flex shrink-0 items-center justify-end gap-2 pt-1.5">
        <abbr
          title={fullLabel}
          className="flex h-6 min-w-[1.5rem] cursor-default select-none items-center justify-center rounded border border-border bg-muted/60 px-1.5 text-xs font-semibold tracking-tight text-foreground no-underline"
        >
          {letter}
        </abbr>
        <ConfidencePie confidence={memory.confidence} />
        <time
          dateTime={memory.createdAt}
          title={formatWhen(memory.createdAt)}
          className="text-xs tabular-nums text-muted-foreground"
        >
          {formatShortMonthDay(memory.createdAt)}
        </time>
      </div>
    </div>
  );
}

function CollapsibleMemorySection({
  title,
  count,
  open,
  onToggle,
  singularLabel = "memory",
  pluralLabel = "memories",
  allowOverflow = false,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  singularLabel?: string;
  pluralLabel?: string;
  allowOverflow?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card/30",
        allowOverflow ? "overflow-visible" : "overflow-hidden",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/40"
        aria-expanded={open}
      >
        <span className="font-medium text-foreground">{title}</span>
        <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          <span>
            {count} {count === 1 ? singularLabel : pluralLabel}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 transition-transform duration-200",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </span>
      </button>
      {open ? (
        <div className="border-t border-border px-4 py-4">{children}</div>
      ) : null}
    </div>
  );
}

export default function MemoriesPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const {
    getUserMemories,
    userMemories,
    memoriesLoading,
    memoriesError,
    deleteUserMemory,
    memoryDeleteId,
    addCourseHistoryMemory,
    clearConversationMemories,
    addManualMemory,
    processTranscriptCourseCodes,
    saveTranscriptReview,
    deleteUserAccount,
    accountDeleteLoading,
    searchSisCourses,
  } = useApi();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [accountDeleteError, setAccountDeleteError] = useState<string | null>(null);
  const [deletableOpen, setDeletableOpen] = useState(false);
  const [nonDeletableOpen, setNonDeletableOpen] = useState(false);
  const [courseHistoryOpen, setCourseHistoryOpen] = useState(false);
  const [deleteAccountDialogOpen, setDeleteAccountDialogOpen] = useState(false);
  const [courseInput, setCourseInput] = useState("");
  const [courseSuggestions, setCourseSuggestions] = useState<SisCourseSuggestion[]>([]);
  const [courseSuggestionsLoading, setCourseSuggestionsLoading] = useState(false);
  const [courseSuggestionsError, setCourseSuggestionsError] = useState<string | null>(null);
  const [courseDeleteId, setCourseDeleteId] = useState<string | null>(null);
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [manualDialogError, setManualDialogError] = useState<string | null>(null);
  const [clearConversationsLoading, setClearConversationsLoading] = useState(false);
  const [manualSaveLoading, setManualSaveLoading] = useState(false);
  const [clearConversationError, setClearConversationError] = useState<string | null>(null);
  const [transcriptDialogOpen, setTranscriptDialogOpen] = useState(false);
  const [transcriptReviewEntries, setTranscriptReviewEntries] = useState<TranscriptReviewDialogEntry[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptVerifying, setTranscriptVerifying] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const transcriptFileInputRef = useRef<HTMLInputElement | null>(null);
  const transcriptVerifyAbortRef = useRef<AbortController | null>(null);
  const memoriesActionBusy = clearConversationsLoading || manualSaveLoading;

  const goToPreferenceSurvey = () => {
    navigate("/onboarding", { state: { returnTo: pathname } });
  };

  useEffect(() => {
    void getUserMemories();
  }, [getUserMemories]);

  useEffect(() => {
    const query = courseInput.trim();
    if (query.length < 5) {
      setCourseSuggestions([]);
      setCourseSuggestionsLoading(false);
      setCourseSuggestionsError(null);
      return;
    }

    let cancelled = false;
    setCourseSuggestionsLoading(true);
    setCourseSuggestionsError(null);

    const timeout = window.setTimeout(() => {
      void searchSisCourses(query, 8)
        .then((results) => {
          if (cancelled) return;
          setCourseSuggestions(results);
        })
        .catch((error) => {
          if (cancelled) return;
          setCourseSuggestions([]);
          setCourseSuggestionsError(
            error instanceof Error ? error.message : "Could not search courses",
          );
        })
        .finally(() => {
          if (!cancelled) setCourseSuggestionsLoading(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [courseInput, searchSisCourses]);

  const { deletable, nonDeletable } = useMemo(() => {
    const list = userMemories ?? [];
    const d: MemoryItem[] = [];
    const nd: MemoryItem[] = [];
    for (const m of list) {
      if (m.type === "course_history") continue;
      if (isDeletableSource(m.source)) d.push(m);
      else nd.push(m);
    }
    return { deletable: d, nonDeletable: nd };
  }, [userMemories]);

  const handleDelete = async (id: string) => {
    setDeleteError(null);
    try {
      await deleteUserMemory(id);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Could not delete memory");
    }
  };

  const handleClearAllConversations = async () => {
    if (
      !window.confirm(
        "Remove all memories from chat and manual entries in this section? Onboarding and course history are not affected.",
      )
    ) {
      return;
    }
    setClearConversationError(null);
    setClearConversationsLoading(true);
    try {
      await clearConversationMemories();
    } catch (e) {
      setClearConversationError(
        e instanceof Error ? e.message : "Could not clear conversation memories",
      );
    } finally {
      setClearConversationsLoading(false);
    }
  };

  const handleManualDialogSave = async (text: string, memoryType: ManualMemoryType) => {
    setManualDialogError(null);
    setManualSaveLoading(true);
    try {
      await addManualMemory(text, memoryType);
      setManualDialogOpen(false);
    } catch (e) {
      setManualDialogError(e instanceof Error ? e.message : "Could not save manual memory");
    } finally {
      setManualSaveLoading(false);
    }
  };

  const handleAddCourseFromSuggestion = async (offeringName: string) => {
    const normalized = offeringName.trim().toUpperCase();
    if (!normalized) return;
    setCourseSuggestionsError(null);
    try {
      await addCourseHistoryMemory(normalized);
      await getUserMemories();
      setCourseInput("");
      setCourseSuggestions([]);
    } catch (error) {
      setCourseSuggestionsError(
        error instanceof Error ? error.message : "Could not save course history",
      );
    }
  };

  const handleDeleteCourse = async (memoryId: string) => {
    if (courseDeleteId) return;
    setCourseSuggestionsError(null);
    setCourseDeleteId(memoryId);
    try {
      await deleteUserMemory(memoryId);
    } catch (error) {
      setCourseSuggestionsError(
        error instanceof Error ? error.message : "Could not delete course history",
      );
    } finally {
      setCourseDeleteId(null);
    }
  };

  const handleTranscriptButtonClick = () => {
    setTranscriptError(null);
    transcriptFileInputRef.current?.click();
  };

  const handleTranscriptFileSelected = async (file: File) => {
    transcriptVerifyAbortRef.current?.abort();
    setTranscriptError(null);
    setTranscriptLoading(true);
    const abortController = new AbortController();
    transcriptVerifyAbortRef.current = abortController;
    try {
      const testCodes =
        import.meta.env.MODE === "test"
          ? (globalThis as { __ATLAS_TEST_TRANSCRIPT_CODES?: string[] })
              .__ATLAS_TEST_TRANSCRIPT_CODES
          : undefined;
      const parsed = testCodes
        ? { extractedText: "", normalizedCodes: testCodes }
        : await extractTranscriptCoursesFromPdf(file);
      if (parsed.normalizedCodes.length === 0) {
        throw new Error("No transcript course fragments found (expected 000.000 pattern).");
      }
      setTranscriptReviewEntries(
        parsed.normalizedCodes.map((code) => ({
          rawCode: code,
          canonicalCode: code,
          status: "verifying",
          options: [],
        })),
      );
      setTranscriptDialogOpen(true);
      setTranscriptVerifying(true);
      setTranscriptLoading(false);

      const updates = parsed.normalizedCodes.map(async (code, idx) => {
        try {
          const processed = await processTranscriptCourseCodes([code], {
            signal: abortController.signal,
          });
          const next = processed.reviewedEntries[0];
          if (!next) return;
          setTranscriptReviewEntries((prev) =>
            prev.map((entry, i) => (i === idx ? next : entry)),
          );
        } catch (error) {
          if (abortController.signal.aborted) return;
          setTranscriptReviewEntries((prev) =>
            prev.map((entry, i) =>
              i === idx
                ? {
                    ...entry,
                    status: "unmatched",
                    options: [],
                    optionDetails: [],
                    resolvedCourseTitle: null,
                  }
                : entry,
            ),
          );
          setTranscriptError(
            error instanceof Error ? error.message : "One or more courses could not be verified",
          );
        }
      });
      await Promise.allSettled(updates);
      if (!abortController.signal.aborted) {
        setTranscriptVerifying(false);
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
        setTranscriptVerifying(false);
      }
      setTranscriptError(error instanceof Error ? error.message : "Could not process transcript");
    } finally {
      if (!abortController.signal.aborted) {
        setTranscriptLoading(false);
      }
      if (transcriptFileInputRef.current) transcriptFileInputRef.current.value = "";
      if (transcriptVerifyAbortRef.current === abortController) {
        transcriptVerifyAbortRef.current = null;
      }
    }
  };

  const handleSaveTranscriptReview = async () => {
    setTranscriptError(null);
    setTranscriptLoading(true);
    try {
      const reviewedEntries = transcriptReviewEntries.filter(
        (entry): entry is TranscriptReviewEntry => entry.status !== "verifying",
      );
      await saveTranscriptReview(reviewedEntries);
      await getUserMemories();
      setTranscriptDialogOpen(false);
      setTranscriptReviewEntries([]);
    } catch (error) {
      setTranscriptError(error instanceof Error ? error.message : "Could not save transcript results");
    } finally {
      setTranscriptLoading(false);
    }
  };

  const showMemoryLists = !memoriesLoading && !memoriesError && userMemories !== null;
  const sortedCourseHistory = useMemo(() => {
    const list = userMemories ?? [];
    const courseEntries = list
      .filter((m) => m.type === "course_history")
      .map((m) => ({ id: m.id, code: m.text.trim().toUpperCase() }))
      .filter((m) => m.code.length > 0)
      .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
    return courseEntries;
  }, [userMemories]);

  return (
    <div className="app-root">
      <Header title="Atlas: Saved memories" />

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-10">
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Brain className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  Saved memories
                </h1>
                <p className="text-sm text-muted-foreground">
                  What Atlas remembers about your goals and preferences
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="self-start sm:self-center"
              onClick={() => void getUserMemories()}
              disabled={memoriesLoading}
            >
              {memoriesLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Refreshing…
                </>
              ) : (
                "Refresh"
              )}
            </Button>
          </div>

          {(deleteError || accountDeleteError || clearConversationError) && (
            <div
              role="alert"
              className="mb-6 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {accountDeleteError ?? clearConversationError ?? deleteError}
            </div>
          )}

          {memoriesLoading && userMemories === null && (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">Loading memories…</p>
            </div>
          )}

          {!memoriesLoading && memoriesError && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <p className="font-medium text-foreground">Couldn't load memories</p>
              <p className="text-sm text-muted-foreground">{memoriesError}</p>
              <Button variant="outline" onClick={() => void getUserMemories()}>
                Try again
              </Button>
            </div>
          )}

          {showMemoryLists && userMemories.length === 0 && (
            <p className="mb-4 text-sm text-muted-foreground">
              No memories yet. You can add a manual memory under Conversations or complete onboarding
              to build your profile.
            </p>
          )}

          {showMemoryLists && (
            <div className="space-y-4">
              <CollapsibleMemorySection
                title="Conversations"
                count={deletable.length}
                open={deletableOpen}
                onToggle={() => setDeletableOpen((v) => !v)}
              >
                <div className="mb-4 flex flex-col gap-2 rounded-lg border border-border/80 bg-muted/20 px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Actions
                  </span>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full sm:w-auto text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                      disabled={memoriesActionBusy || deletable.length === 0}
                      onClick={() => void handleClearAllConversations()}
                    >
                      Clear all conversations
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full sm:w-auto"
                      disabled={memoriesActionBusy}
                      onClick={() => {
                        setManualDialogError(null);
                        setManualDialogOpen(true);
                      }}
                    >
                      Add manual memory
                    </Button>
                  </div>
                </div>
                {deletable.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No chat or manual memories yet. Use Add manual memory above, or chat with Atlas
                    to populate this section.
                  </p>
                ) : (
                  <ul
                    role="list"
                    className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 xl:grid-cols-3"
                  >
                    {deletable.map((m) => (
                      <li key={m.id} className="min-w-0">
                        <DeletableMemoryRow
                          memory={m}
                          onDelete={handleDelete}
                          deleting={memoryDeleteId === m.id}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </CollapsibleMemorySection>

              <CollapsibleMemorySection
                title="Onboarding Survey"
                count={nonDeletable.length}
                open={nonDeletableOpen}
                onToggle={() => {
                  setNonDeletableOpen((v) => !v);
                  setDeleteAccountDialogOpen(false);
                }}
              >
                <div className="mb-4 flex flex-col gap-2 rounded-lg border border-border/80 bg-muted/20 px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Clear options
                  </span>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full sm:w-auto"
                      onClick={goToPreferenceSurvey}
                    >
                      Modify preference survey
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full sm:w-auto text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setDeleteAccountDialogOpen(true)}
                    >
                      Delete account
                    </Button>
                  </div>
                </div>
                {nonDeletable.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No onboarding-derived memories yet. Complete the preference survey to populate
                    this section.
                  </p>
                ) : (
                  <ul
                    role="list"
                    className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 xl:grid-cols-3"
                  >
                    {nonDeletable.map((m) => (
                      <li key={m.id} className="min-w-0">
                        <NonDeletableMemoryRow memory={m} />
                      </li>
                    ))}
                  </ul>
                )}
              </CollapsibleMemorySection>

              <CollapsibleMemorySection
                title="Course History"
                count={sortedCourseHistory.length}
                singularLabel="course"
                pluralLabel="courses"
                allowOverflow
                open={courseHistoryOpen}
                onToggle={() => setCourseHistoryOpen((v) => !v)}
              >
                <div className="space-y-4">
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Manage your completed courses for advising context.
                    </p>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="relative w-full sm:w-1/2">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">
                          Manually add course
                        </p>
                        <input
                          value={courseInput}
                          onChange={(e) => setCourseInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                            }
                          }}
                          placeholder="e.g. AS.030.101 or Calculus"
                          aria-label="Course code or name"
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        {courseInput.trim().length > 0 && (
                          <div className="absolute z-20 mt-1 max-h-[min(16rem,calc(100vh-12rem))] w-full overflow-y-auto rounded-md border border-border bg-background shadow-lg">
                            {courseInput.trim().length < 5 ? (
                              <div className="px-3 py-2 text-sm text-muted-foreground">
                                Enter at least 5 characters (course code or name) to search.
                              </div>
                            ) : courseSuggestionsLoading ? (
                              <div className="px-3 py-2 text-sm text-muted-foreground">
                                Searching courses...
                              </div>
                            ) : courseSuggestionsError ? (
                              <div className="px-3 py-2 text-sm text-destructive">
                                {courseSuggestionsError}
                              </div>
                            ) : courseSuggestions.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-muted-foreground">
                                No matching courses found.
                              </div>
                            ) : (
                              <ul>
                                {courseSuggestions.map((course) => (
                                  <li key={course.code}>
                                    <button
                                      type="button"
                                      className="flex w-full items-center px-3 py-2 text-left hover:bg-muted/40"
                                      onClick={() => void handleAddCourseFromSuggestion(course.code)}
                                    >
                                      <span className="mr-2 shrink-0 text-sm font-medium text-foreground">
                                        {course.code}
                                      </span>
                                      <span className="truncate text-sm font-medium text-muted-foreground">
                                        {course.title}
                                      </span>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="w-full space-y-2 sm:w-1/2 sm:pl-4 sm:border-l sm:border-border/60">
                        <p className="text-center text-xs font-medium uppercase tracking-wide text-muted-foreground sm:text-left">
                          or
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full justify-center"
                          onClick={handleTranscriptButtonClick}
                          disabled={transcriptLoading}
                          data-testid="transcript-upload-button"
                        >
                          {transcriptLoading ? "Processing transcript..." : "Bulk import by uploading transcript"}
                        </Button>
                        <input
                          ref={transcriptFileInputRef}
                          type="file"
                          accept="application/pdf"
                          className="hidden"
                          data-testid="transcript-file-input"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void handleTranscriptFileSelected(file);
                          }}
                        />
                        {transcriptError ? (
                          <p className="text-xs text-destructive" role="alert">
                            {transcriptError}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {sortedCourseHistory.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                      No courses added yet. Add a course code on the right to start your history.
                    </p>
                  ) : (
                    <ul className="flex flex-wrap gap-2">
                      {sortedCourseHistory.map((course) => (
                        <li
                          key={course.id}
                          className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1"
                        >
                          <span className="text-xs font-medium text-foreground">{course.code}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-muted-foreground hover:text-destructive"
                            aria-label={`Delete ${course.code}`}
                            disabled={courseDeleteId !== null}
                            onClick={() => void handleDeleteCourse(course.id)}
                          >
                            {courseDeleteId === course.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CollapsibleMemorySection>
            </div>
          )}
        </div>
      </main>

      <AddManualMemoryDialog
        open={manualDialogOpen}
        loading={manualSaveLoading}
        errorText={manualDialogError}
        onClose={() => {
          if (!manualSaveLoading) {
            setManualDialogOpen(false);
            setManualDialogError(null);
          }
        }}
        onSave={(text, memoryType) => handleManualDialogSave(text, memoryType)}
      />

      <TranscriptReviewDialog
        open={transcriptDialogOpen}
        entries={transcriptReviewEntries}
        loading={transcriptLoading}
        verifying={transcriptVerifying}
        errorText={transcriptError}
        onClose={() => {
          transcriptVerifyAbortRef.current?.abort();
          transcriptVerifyAbortRef.current = null;
          setTranscriptDialogOpen(false);
          setTranscriptError(null);
          setTranscriptVerifying(false);
          setTranscriptLoading(false);
        }}
        onChangeEntry={(idx, next) => {
          setTranscriptReviewEntries((prev) => prev.map((entry, i) => (i === idx ? next : entry)));
        }}
        onRemoveEntry={(idx) => {
          setTranscriptReviewEntries((prev) => prev.filter((_, i) => i !== idx));
        }}
        onSave={() => void handleSaveTranscriptReview()}
      />

      <DeleteAccountDialog
        open={deleteAccountDialogOpen}
        loading={accountDeleteLoading}
        errorText={accountDeleteError}
        onCancel={() => {
          if (!accountDeleteLoading) {
            setDeleteAccountDialogOpen(false);
            setAccountDeleteError(null);
          }
        }}
        onConfirm={async () => {
          setAccountDeleteError(null);
          try {
            await deleteUserAccount();
            window.location.assign("/");
          } catch {
            setAccountDeleteError("Could not delete account. Try again or contact support.");
          }
        }}
      />
    </div>
  );
}
