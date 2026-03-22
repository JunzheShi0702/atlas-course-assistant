import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays,
  Plus,
  Sparkles,
  X,
  AlertCircle,
  BookOpen,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import { useSchedules } from "@/hooks/useSchedules";
import type { Schedule } from "@/types/schedules";

const TERMS = [
  "Spring 2025",
  "Summer 2025",
  "Fall 2025",
  "Spring 2026",
  "Summer 2026",
  "Fall 2026",
];

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
}

function ScheduleCard({ schedule, onClick }: ScheduleCardProps) {
  return (
    <button
      data-testid="schedule-card"
      onClick={() => onClick(schedule.id)}
      className="group relative flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition-all duration-200 hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <BookOpen className="h-4 w-4" />
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
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
  );
}

// ── Create schedule modal ─────────────────────────────────────────────────────

interface CreateModalProps {
  onClose: () => void;
  onCreate: (name: string, term: string) => Promise<void>;
}

function CreateModal({ onClose, onCreate }: CreateModalProps) {
  const [name, setName] = useState("");
  const [term, setTerm] = useState(TERMS[3]); // default Spring 2026
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
  const { schedules, loading, error, loadSchedules, createSchedule } =
    useSchedules();
  const [showCreate, setShowCreate] = useState(false);

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

  return (
    <div className="app-root">
      <Header title="Atlas: Your 24/7 Course Advisor" />

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-10">
          {/* Page header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Sparkles className="h-5 w-5" />
              </div>
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
                <ScheduleCard key={s.id} schedule={s} onClick={handleCardClick} />
              ))}
            </div>
          )}
        </div>
      </main>

      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />
      )}
    </div>
  );
}
