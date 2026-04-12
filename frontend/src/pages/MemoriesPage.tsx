import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  Brain,
  ChevronDown,
  Loader2,
  Trash2,
} from "lucide-react";
import Header from "@/components/Header";
import { DeleteAccountDialog } from "@/components/DeleteAccountDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useApi, type MemoryItem } from "@/hooks/useApi";
import { cn } from "@/lib/utils";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isDeletableSource(source: string): boolean {
  return source === "chat" || source === "manual";
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
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm leading-relaxed text-foreground">{memory.text}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="font-normal capitalize">
            {memory.type.replace(/_/g, " ")}
          </Badge>
          <Badge variant="outline" className="font-normal capitalize">
            {memory.source}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Confidence {(memory.confidence * 100).toFixed(0)}%
          </span>
          <span className="text-xs text-muted-foreground">
            {formatWhen(memory.createdAt)}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 justify-end sm:pt-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive"
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
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="text-sm leading-relaxed text-foreground">{memory.text}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="font-normal capitalize">
          {memory.type.replace(/_/g, " ")}
        </Badge>
        <Badge variant="outline" className="font-normal capitalize">
          {memory.source}
        </Badge>
        <span className="text-xs text-muted-foreground">
          Confidence {(memory.confidence * 100).toFixed(0)}%
        </span>
        <span className="text-xs text-muted-foreground">
          {formatWhen(memory.createdAt)}
        </span>
      </div>
    </div>
  );
}

function CollapsibleMemorySection({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card/30">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/40"
        aria-expanded={open}
      >
        <span className="font-medium text-foreground">{title}</span>
        <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          <span>
            {count} {count === 1 ? "memory" : "memories"}
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
    deleteUserAccount,
    accountDeleteLoading,
  } = useApi();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [accountDeleteError, setAccountDeleteError] = useState<string | null>(null);
  const [deletableOpen, setDeletableOpen] = useState(false);
  const [nonDeletableOpen, setNonDeletableOpen] = useState(false);
  const [deleteAccountDialogOpen, setDeleteAccountDialogOpen] = useState(false);

  const goToPreferenceSurvey = () => {
    navigate("/onboarding", { state: { returnTo: pathname } });
  };

  useEffect(() => {
    void getUserMemories();
  }, [getUserMemories]);

  const { deletable, nonDeletable } = useMemo(() => {
    const list = userMemories ?? [];
    const d: MemoryItem[] = [];
    const nd: MemoryItem[] = [];
    for (const m of list) {
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

  const showMemoryLists =
    !memoriesLoading && !memoriesError && userMemories !== null && userMemories.length > 0;

  return (
    <div className="app-root">
      <Header title="Atlas: Saved memories" />

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-10">
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 -ml-2"
                aria-label="Back"
                onClick={() => navigate(-1)}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
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

          {(deleteError || accountDeleteError) && (
            <div
              role="alert"
              className="mb-6 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {accountDeleteError ?? deleteError}
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

          {!memoriesLoading &&
            !memoriesError &&
            userMemories !== null &&
            userMemories.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-16 text-center">
                <Brain className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                <p className="font-medium text-foreground">No memories yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Complete onboarding or chat with Atlas to build your profile.
                </p>
              </div>
            )}

          {showMemoryLists && (
            <div className="space-y-4">
              <CollapsibleMemorySection
                title="Deletable Memory"
                count={deletable.length}
                open={deletableOpen}
                onToggle={() => setDeletableOpen((v) => !v)}
              >
                {deletable.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No chat or manual memories yet. Memories from conversation can be removed
                    here when available.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {deletable.map((m) => (
                      <li key={m.id}>
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
                title="Non Deletable Memory"
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
                  <ul className="space-y-3">
                    {nonDeletable.map((m) => (
                      <li key={m.id}>
                        <NonDeletableMemoryRow memory={m} />
                      </li>
                    ))}
                  </ul>
                )}
              </CollapsibleMemorySection>
            </div>
          )}
        </div>
      </main>

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
            window.location.assign("/login");
          } catch {
            setAccountDeleteError("Could not delete account. Try again or contact support.");
          }
        }}
      />
    </div>
  );
}
