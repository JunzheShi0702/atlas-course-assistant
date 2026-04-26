import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays,
  Plus,
  X,
  AlertCircle,
  BookOpen,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import { useSchedules } from "@/hooks/useSchedules";
import type { Schedule } from "@/types/schedules";

const TERMS = ["Spring 2026"];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Schedule card ────────────────────────────────────────────────────────────

interface ScheduleCardProps {
  schedule: Schedule;
  onClick: (id: string) => void;
  onDelete: (id: string) => void;
}

function ScheduleCard({ schedule, onClick, onDelete }: ScheduleCardProps) {
  return (
    <div
      data-testid="schedule-card"
      className="group relative flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm transition-all duration-200 hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5"
    >
      {/* Delete button */}
      <button
        data-testid="delete-schedule-btn"
        onClick={(e) => { e.stopPropagation(); onDelete(schedule.id); }}
        className="absolute right-3 top-3 hidden rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:flex"
        aria-label="Delete schedule"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      <button
        className="flex flex-col gap-3 text-left focus-visible:outline-none"
        onClick={() => onClick(schedule.id)}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <BookOpen className="h-4 w-4" />
          </div>
        </div>

        <div className="space-y-1">
          <h3 className="font-semibold text-foreground leading-tight line-clamp-2">
            {schedule.name}
          </h3>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays className="h-3 w-3" />
            <span>{schedule.term}</span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground/70 mt-auto">
          Created {formatDate(schedule.createdAt)}
        </p>
      </button>
    </div>
  );
}

// ── Delete confirm dialog ─────────────────────────────────────────────────────

interface DeleteDialogProps {
  scheduleName: string;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}

function DeleteDialog({ scheduleName, onConfirm, onCancel, deleting }: DeleteDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
      data-testid="delete-dialog"
    >
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl">
        <h2 className="text-base font-semibold">Delete schedule?</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{scheduleName}</span> and all its
          courses will be permanently deleted.
        </p>
        <div className="mt-5 flex gap-2">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="flex-1 rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            data-testid="confirm-delete-btn"
            className="flex-1 rounded-xl bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create schedule modal ─────────────────────────────────────────────────────

interface CreateModalProps {
  onClose: () => void;
  onCreate: (name: string, term: string) => Promise<void>;
}

function CreateModal({ onClose, onCreate }: CreateModalProps) {
  const [name, setName] = useState("");
  const [term, setTerm] = useState(TERMS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(name.trim(), term);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create schedule");
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid="create-modal"
    >
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 className="text-lg font-semibold mb-1">New Schedule</h2>
        <p className="text-sm text-muted-foreground mb-5">
          Give your schedule a name and pick a term to get started.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="schedule-name" className="text-sm font-medium">
              Schedule name
            </label>
            <input
              id="schedule-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My Spring Plan"
              required
              autoFocus
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="schedule-term" className="text-sm font-medium">
              Term
            </label>
            <select
              id="schedule-term"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {TERMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5" />
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={submitting || !name.trim()}
            >
              {submitting ? "Creating…" : "Create schedule"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function ScheduleCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 animate-pulse">
      <div className="h-9 w-9 rounded-xl bg-muted" />
      <div className="space-y-2">
        <div className="h-4 w-3/4 rounded bg-muted" />
        <div className="h-3 w-1/3 rounded bg-muted" />
      </div>
      <div className="h-3 w-2/5 rounded bg-muted mt-auto" />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SchedulesDashboard() {
  const navigate = useNavigate();
  const { schedules, loading, error, loadSchedules, createSchedule, deleteSchedule } =
    useSchedules();
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Schedule | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

  const handleCreate = async (name: string, term: string) => {
    const created = await createSchedule({ name, term });
    setShowCreate(false);
    navigate(`/schedules/${created.id}`);
  };

  const handleCardClick = (id: string) => {
    navigate(`/schedules/${id}`);
  };

  const handleDeleteRequest = (id: string) => {
    const schedule = schedules.find((s) => s.id === id) ?? null;
    setDeleteTarget(schedule);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteSchedule(deleteTarget.id);
      setDeleteTarget(null);
    } catch {
      // error already reflected via hook
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="app-root">
      <Header />

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-10">
          {/* Page header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  My Schedules
                </h1>
                <p className="text-sm text-muted-foreground">
                  Build and compare your course plans
                </p>
              </div>
            </div>
            <Button onClick={() => setShowCreate(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />
              New schedule
            </Button>
          </div>

          {/* States */}
          {loading && (
            <div
              data-testid="loading-state"
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              {Array.from({ length: 3 }).map((_, i) => (
                <ScheduleCardSkeleton key={i} />
              ))}
            </div>
          )}

          {!loading && error && (
            <div
              data-testid="error-state"
              className="flex flex-col items-center justify-center gap-3 py-20 text-center"
            >
              <AlertCircle className="h-8 w-8 text-destructive" />
              <p className="font-medium">Couldn't load schedules</p>
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" onClick={loadSchedules}>
                Try again
              </Button>
            </div>
          )}

          {!loading && !error && schedules.length === 0 && (
            <div
              data-testid="empty-state"
              className="flex flex-col items-center justify-center gap-4 py-20 text-center"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
                <BookOpen className="h-7 w-7 text-muted-foreground" />
              </div>
              <div>
                <p className="font-semibold text-lg">No schedules yet</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                  Create your first schedule to start planning your courses with
                  AI assistance.
                </p>
              </div>
              <Button onClick={() => setShowCreate(true)} className="gap-1.5">
                <Plus className="h-4 w-4" />
                Create your first schedule
              </Button>
            </div>
          )}

          {!loading && !error && schedules.length > 0 && (
            <div
              data-testid="schedules-grid"
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              {schedules.map((s) => (
                <ScheduleCard key={s.id} schedule={s} onClick={handleCardClick} onDelete={handleDeleteRequest} />
              ))}
            </div>
          )}
        </div>
      </main>

      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />
      )}

      {deleteTarget && (
        <DeleteDialog
          scheduleName={deleteTarget.name}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
          deleting={deleting}
        />
      )}
    </div>
  );
}
