import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, BookOpen, ClipboardList, Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import ScheduleChat from "@/components/ScheduleChat";
import { useSchedules } from "@/hooks/useSchedules";
import type { ScheduleDetail, ScheduleCourseItem } from "@/types/schedules";

/**
 * Schedule page — route: /schedules/:id
 *
 * On load: GET /api/schedules/:id → populates name, courses list.
 * Left  (~60%): ScheduleChat panel (#121)
 * Right (~40%): Course list (this task) + Audit panel stub (#118)
 */
export default function SchedulePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getSchedule, deleteSchedule, removeCourse } = useSchedules();

  const [schedule, setSchedule] = useState<ScheduleDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadSchedule = useCallback(() => {
    if (!id) return;
    setLoadError(null);
    getSchedule(id)
      .then(setSchedule)
      .catch((err: Error) => setLoadError(err.message));
  }, [id, getSchedule]);

  useEffect(() => {
    loadSchedule();
  }, [id, loadSchedule]);

  /** Refetch after add/remove from chat — errors ignored so we don’t replace the page on a failed reload. */
  const refreshScheduleList = useCallback(() => {
    if (!id) return;
    getSchedule(id).then(setSchedule).catch(() => {});
  }, [id, getSchedule]);

  const handleRemoveCourse = async (course: ScheduleCourseItem) => {
    if (!id || !schedule) return;
    try {
      await removeCourse(id, {
        courseCode: course.courseCode,
        sisOfferingName: course.sisOfferingName,
        term: course.term,
      });
      setSchedule((prev) =>
        prev
          ? { ...prev, courses: prev.courses.filter((c) => c.courseCode !== course.courseCode || c.sisOfferingName !== course.sisOfferingName) }
          : prev,
      );
    } catch {
      /* silently fail — course stays in list */
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    try {
      await deleteSchedule(id);
      navigate("/schedules");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="app-root">
      <Header title="Atlas: Your 24/7 Course Advisor" />

      {/* Sub-header */}
      <div className="shrink-0 border-b border-border bg-background px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => navigate("/schedules")}
            aria-label="Back to schedules"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-sm font-semibold leading-tight">
              {schedule?.name ?? "Schedule"}
            </h1>
            <p className="text-xs text-muted-foreground">{schedule?.term ?? id}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 gap-1.5"
          onClick={() => setShowDeleteConfirm(true)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      </div>

      {/* Main split layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: Chat panel */}
        <div className="flex flex-col flex-1 min-w-0 border-r border-border">
          {loadError ? (
            <div className="flex flex-1 items-center justify-center text-sm text-destructive p-8 text-center">
              {loadError}
            </div>
          ) : (
            <ScheduleChat
              scheduleId={id ?? ""}
              scheduleName={schedule?.name}
              onScheduleCoursesChanged={refreshScheduleList}
            />
          )}
        </div>

        {/* Right: Course list + Audit panel */}
        <div
          className="hidden md:flex flex-col w-80 lg:w-96 shrink-0 overflow-y-auto"
          data-testid="schedule-page-content"
        >
          {/* Course list */}
          <div className="border-b border-border p-4">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Courses</h2>
              {schedule && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {schedule.courses.length} added
                </span>
              )}
            </div>

            {!schedule && !loadError && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {schedule && schedule.courses.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-center rounded-xl border border-dashed border-border bg-muted/30">
                <BookOpen className="h-6 w-6 text-muted-foreground/50" />
                <p className="text-xs text-muted-foreground">
                  No courses added yet.
                </p>
                <p className="text-xs text-muted-foreground/60">
                  Search in the chat and click the bookmark icon.
                </p>
              </div>
            )}

            {schedule && schedule.courses.length > 0 && (
              <ul className="space-y-2" data-testid="course-list">
                {schedule.courses.map((course) => (
                  <li
                    key={`${course.courseCode}-${course.sisOfferingName}`}
                    className="flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2.5"
                    data-testid="course-list-item"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">
                        {(course.courseTitle?.trim() || course.courseCode)}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {course.courseTitle?.trim()
                          ? `${course.courseCode} · ${course.term}`
                          : course.term}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRemoveCourse(course)}
                      className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`Remove ${course.courseCode}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Audit panel stub */}
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Schedule audit</h2>
            </div>
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center rounded-xl border border-dashed border-border bg-muted/30">
              <ClipboardList className="h-6 w-6 text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">Workload audit coming soon</p>
              <p className="text-xs text-muted-foreground/60">(#118)</p>
            </div>
          </div>
        </div>
      </div>

      {/* Delete confirm dialog */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && setShowDeleteConfirm(false)}
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl">
            <h2 className="text-base font-semibold">Delete this schedule?</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{schedule?.name}</span> and all
              its courses will be permanently deleted.
            </p>
            <div className="mt-5 flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
