import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  ClipboardList,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import ScheduleChat from "@/components/ScheduleChat";
import { useSchedules } from "@/hooks/useSchedules";
import type {
  ScheduleAuditFinding,
  ScheduleAuditResult,
  ScheduleDetail,
  ScheduleCourseItem,
  ScheduleGoalAlignment,
} from "@/types/schedules";

function normalizeGoalAlignment(
  raw: ScheduleAuditResult["goalAlignment"],
): ScheduleGoalAlignment | null {
  if (raw == null || typeof raw !== "object") return null;
  const score =
    typeof raw.score === "number" || raw.score === null ? raw.score : null;
  return {
    score,
    rationale: typeof raw.rationale === "string" ? raw.rationale : "",
    alignedGoals: Array.isArray(raw.alignedGoals)
      ? raw.alignedGoals.filter((g): g is string => typeof g === "string")
      : [],
    conflicts: Array.isArray(raw.conflicts)
      ? raw.conflicts.filter((g): g is string => typeof g === "string")
      : [],
  };
}

/**
 * Schedule page — route: /schedules/:id
 *
 * On load: GET /api/schedules/:id → populates name, courses list.
 * Left  (~60%): ScheduleChat panel (#121)
 * Right (~40%): Course list + workload audit panel (#132)
 */

function formatAuditTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function extractAuditView(result: ScheduleAuditResult | null | undefined) {
  if (!result) {
    return {
      workloadRange: null,
      narrative: null,
      missingData: null,
      goalAlignment: null,
    };
  }

  const workloadRange = result.workloadRange
    ? `${result.workloadRange.min}-${result.workloadRange.max} hrs/week`
    : null;

  return {
    workloadRange,
    narrative: result.narrativeSummary?.trim() || null,
    missingData: result.missingEvaluationData?.length
      ? result.missingEvaluationData.join(", ")
      : null,
    goalAlignment: normalizeGoalAlignment(result.goalAlignment),
    findings: result.findings ?? [],
  };
}

function formatPreferenceLabel(values: string[]): string | null {
  if (values.length === 0) return null;
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

function buildAlignmentBullets(
  goalAlignment: ScheduleGoalAlignment | null,
  findings: ScheduleAuditFinding[],
) {
  const matches = new Set<string>(goalAlignment?.alignedGoals ?? []);
  const conflicts = new Set<string>(goalAlignment?.conflicts ?? []);

  for (const finding of findings) {
    if (finding.category !== "preference_alignment") continue;

    const courseLabel = finding.courseCode ?? finding.sisOfferingName ?? "This course";
    const evidence = finding.evidence[0] ?? "meeting details unavailable";
    const satisfied = formatPreferenceLabel(finding.satisfiedPreferences ?? []);
    const violated = formatPreferenceLabel(finding.violatedPreferences ?? []);

    if (satisfied) {
      matches.add(`${courseLabel}: ${evidence} matches your ${satisfied}.`);
    }

    if (violated) {
      conflicts.add(`${courseLabel}: ${evidence} conflicts with your ${violated}.`);
    }
  }

  return {
    matches: [...matches],
    conflicts: [...conflicts],
  };
}

function toAuditErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";

  if (raw === "HTTP 404") {
    return "Workload audit is not available right now for this schedule. Please try again in a bit.";
  }
  if (raw === "HTTP 403" || raw === "Forbidden") {
    return "You do not have permission to run an audit for this schedule.";
  }
  if (raw === "HTTP 401" || raw === "Unauthorized") {
    return "Your session expired. Please sign in again and retry the audit.";
  }
  if (raw === "HTTP 500") {
    return "The server could not complete the workload audit. Please try again.";
  }
  if (raw.trim().length > 0) return raw;

  return "Failed to run workload audit.";
}

function toScheduleCourseKeys(courses: ScheduleCourseItem[]): Set<string> {
  return new Set(courses.map((c) => `${c.courseCode}|${c.sisOfferingName}|${c.term}`));
}

export default function SchedulePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getSchedule, deleteSchedule, removeCourse, runScheduleAudit } = useSchedules();

  const [schedule, setSchedule] = useState<ScheduleDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showFullAudit, setShowFullAudit] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [runningAudit, setRunningAudit] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  /**
   * Single source of truth for which courses are in this schedule.
   * Rebuilt from a confirmed server response on initial load and after any
   * chat-side add/remove. Sidebar deletions do a targeted key removal so they
   * never clobber optimistic adds that are still in-flight to the server.
   */
  const [scheduleCourseIds, setScheduleCourseIds] = useState<Set<string>>(new Set());

  const loadSchedule = useCallback(() => {
    if (!id) return;
    setLoadError(null);
    getSchedule(id)
      .then((data) => {
        setSchedule(data);
        setScheduleCourseIds(toScheduleCourseKeys(data.courses));
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [id, getSchedule]);

  useEffect(() => {
    loadSchedule();
  }, [id, loadSchedule]);

  /** Refetch after add/remove from chat — rebuilds scheduleCourseIds from confirmed server data. */
  const refreshScheduleList = useCallback(() => {
    if (!id) return;
    getSchedule(id)
      .then((data) => {
        setSchedule(data);
        setScheduleCourseIds(toScheduleCourseKeys(data.courses));
      })
      .catch(() => {});
  }, [id, getSchedule]);

  const handleRemoveCourse = async (course: ScheduleCourseItem) => {
    if (!id || !schedule) return;
    try {
      await removeCourse(id, {
        courseCode: course.courseCode,
        sisOfferingName: course.sisOfferingName,
        term: course.term,
      });
      // Targeted removal — avoids overwriting optimistic chat-side adds that
      // haven’t been confirmed by the server yet.
      const key = `${course.courseCode}|${course.sisOfferingName}|${course.term}`;
      setScheduleCourseIds((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
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

  const handleRunAudit = useCallback(async () => {
    if (!id) return;
    setAuditError(null);
    setRunningAudit(true);

    try {
      await runScheduleAudit(id);
      const updated = await getSchedule(id);
      setSchedule(updated);
    } catch (err) {
      const message = toAuditErrorMessage(err);
      setAuditError(message);
    } finally {
      setRunningAudit(false);
    }
  }, [id, runScheduleAudit, getSchedule]);

  const auditView = extractAuditView(schedule?.latestAudit?.result);
  const alignmentBullets = buildAlignmentBullets(auditView.goalAlignment, auditView.findings ?? []);
  const lastRunLabel = formatAuditTimestamp(schedule?.latestAudit?.createdAt);
  const hasAudit = Boolean(schedule?.latestAudit);

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
              scheduleCourseIds={scheduleCourseIds}
              onScheduleCourseIdsChange={setScheduleCourseIds}
              onScheduleCoursesChanged={refreshScheduleList}
            />
          )}
        </div>

        {/* Right: Course list + Audit panel */}
        <div
          className="hidden md:flex flex-col w-80 lg:w-96 shrink-0 overflow-hidden"
          data-testid="schedule-page-content"
        >
          {/* Course list */}
          <div className="basis-2/5 min-h-0 border-b border-border p-4 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Courses</h2>
              <span className="ml-auto text-xs text-muted-foreground">
                {schedule ? `${schedule.courses.length} added` : "—"}
              </span>
            </div>

            <div className="min-h-0 overflow-y-auto pr-1">
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
          </div>

          {/* Audit panel */}
          <div className="basis-3/5 min-h-0 p-4 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Schedule audit</h2>
            </div>
            <div className="rounded-xl border border-border bg-muted/30 p-3.5 min-h-0 overflow-y-auto">
              {!hasAudit && (
                <>
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    className="w-full h-8 text-xs"
                    onClick={handleRunAudit}
                    disabled={!schedule || runningAudit}
                  >
                    {runningAudit ? (
                      <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        Running…
                      </>
                    ) : (
                      "Run workload audit"
                    )}
                  </Button>

                  {auditError && (
                    <p className="mt-2 rounded-md border border-destructive/20 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                      {auditError}
                    </p>
                  )}
                </>
              )}

              {hasAudit && (
                <div className="space-y-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-muted-foreground">
                      {lastRunLabel ? `Last run: ${lastRunLabel}` : "Last run: not yet"}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      onClick={handleRunAudit}
                      disabled={!schedule || runningAudit}
                    >
                      {runningAudit ? (
                        <>
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          Running…
                        </>
                      ) : (
                        <>
                          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                          Re-run workload audit
                        </>
                      )}
                    </Button>
                  </div>

                  {auditError && (
                    <p className="rounded-md border border-destructive/20 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                      {auditError}
                    </p>
                  )}

                  <div className="flex items-center justify-between gap-2 rounded-md bg-background/70 px-2.5 py-2">
                    <span className="text-muted-foreground">Weekly workload</span>
                    <span className="font-medium text-right">{auditView.workloadRange ?? "Not available"}</span>
                  </div>
                  {auditView.missingData && (
                    <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-800 dark:text-amber-200">
                      Missing evaluation data: {auditView.missingData}
                    </p>
                  )}

                  <div className="rounded-md border border-border bg-background/70 px-2.5 py-2">
                    <p className="text-[11px] text-muted-foreground mb-1">Summary</p>
                    <p className="leading-relaxed">{auditView.narrative ?? "No narrative summary returned."}</p>
                  </div>

                  <div className="rounded-md border border-border bg-background/70 px-2.5 py-2">
                    <p className="text-[11px] text-muted-foreground mb-1">Goal Alignment</p>
                    {auditView.goalAlignment ? (
                      <div className="space-y-2">
                        <p className="leading-relaxed">{auditView.goalAlignment.rationale}</p>
                        {alignmentBullets.matches.length > 0 && (
                          <div>
                            <p className="text-[11px] text-muted-foreground mb-1">Matches</p>
                            <ul className="space-y-1">
                              {alignmentBullets.matches.map((match) => (
                                <li key={match} className="text-[11px] leading-relaxed">- {match}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {alignmentBullets.conflicts.length > 0 && (
                          <div>
                            <p className="text-[11px] text-muted-foreground mb-1">Conflicts</p>
                            <ul className="space-y-1">
                              {alignmentBullets.conflicts.map((conflict) => (
                                <li key={conflict} className="text-[11px] leading-relaxed">- {conflict}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="leading-relaxed">No goal-alignment analysis returned.</p>
                    )}
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full h-8 text-xs"
                    onClick={() => setShowFullAudit(true)}
                  >
                    View full audit
                  </Button>
                </div>
              )}
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

      {showFullAudit && hasAudit && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
          onClick={(e) => e.target === e.currentTarget && setShowFullAudit(false)}
        >
          <div className="w-full max-w-xl max-h-[80vh] overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Schedule audit</h2>
              <button
                type="button"
                onClick={() => setShowFullAudit(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                aria-label="Close full audit"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-1 text-xs text-muted-foreground">
              {lastRunLabel ? `Last run: ${lastRunLabel}` : "Last run: not yet"}
            </p>

            <div className="mt-4 space-y-3">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <h3 className="text-xs font-semibold">Narrative summary</h3>
                <p className="mt-1.5 text-sm leading-relaxed">
                  {auditView.narrative ?? "No narrative summary returned."}
                </p>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <h3 className="text-xs font-semibold">Goal Alignment</h3>
                {auditView.goalAlignment ? (
                  <div className="mt-2 space-y-2 text-sm">
                    <p>{auditView.goalAlignment.rationale}</p>
                    {alignmentBullets.matches.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground">Matches</p>
                        <ul className="mt-1 space-y-1">
                          {alignmentBullets.matches.map((match) => (
                            <li key={match}>- {match}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {alignmentBullets.conflicts.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground">Conflicts</p>
                        <ul className="mt-1 space-y-1">
                          {alignmentBullets.conflicts.map((conflict) => (
                            <li key={conflict}>- {conflict}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="mt-1.5 text-sm leading-relaxed">No goal-alignment analysis returned.</p>
                )}
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <h3 className="text-xs font-semibold">Metrics</h3>
                <ul className="mt-2 space-y-2 text-sm">
                  <li className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Weekly workload</span>
                    <span>{auditView.workloadRange ?? "Not available"}</span>
                  </li>
                </ul>
              </div>

              {auditView.missingData && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <h3 className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                    Missing evaluation data
                  </h3>
                  <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
                    {auditView.missingData}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
