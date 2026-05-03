import { BookOpen, Info, Loader2, X } from "lucide-react";
import PrereqOutcomeTag, { type PrereqOutcome } from "@/components/PrereqOutcomeTag";
import type { ScheduleCourseItem, ScheduleDetail } from "@/types/schedules";

type CourseListProps = {
  schedule: ScheduleDetail | null;
  loadError: string | null;
  shortlistStatuses: Record<string, { loading: boolean; outcome: PrereqOutcome | null }>;
  onOpenCourseInfo: (course: ScheduleCourseItem) => void;
  onRemoveCourse: (course: ScheduleCourseItem) => void;
  courseColorMap: Record<string, string>;
};

export default function CourseList({
  schedule,
  loadError,
  shortlistStatuses,
  onOpenCourseInfo,
  onRemoveCourse,
  courseColorMap,
}: CourseListProps) {
  return (
    <div className="basis-3/5 min-h-0 p-4 flex flex-col">
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
            <p className="text-xs text-muted-foreground">No courses added yet.</p>
            <p className="text-xs text-muted-foreground/60">
              Search in the chat and click the bookmark icon.
            </p>
          </div>
        )}

        {schedule && schedule.courses.length > 0 && (
          <ul className="space-y-2" data-testid="course-list">
            {schedule.courses.map((course) => {
              const colorVar = courseColorMap[course.courseCode.trim().toUpperCase()];
              const colorStyle = colorVar
                ? {
                    backgroundColor: `color-mix(in srgb, var(${colorVar}) 18%, white)`,
                    borderColor: `color-mix(in srgb, var(${colorVar}) 45%, white)`,
                  }
                : undefined;
              return (
                <li
                  key={`${course.courseCode}-${course.sisOfferingName}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2.5"
                  style={colorStyle}
                  data-testid="course-list-item"
                >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">
                    {course.courseTitle?.trim() || course.courseCode}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {course.courseTitle?.trim()
                      ? `${course.courseCode} · ${course.term}`
                      : course.term}
                  </p>
                  {(() => {
                    const key = `${course.courseCode}|${course.sisOfferingName}|${course.term}`;
                    const state = shortlistStatuses[key];
                    if (!state || state.loading) {
                      return (
                        <span className="mt-1 inline-flex rounded border border-border/80 bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Checking prereqs...
                        </span>
                      );
                    }
                    if (!state.outcome) return null;
                    const label = state.outcome === "unknown" ? "Status unknown" : undefined;
                    return (
                      <PrereqOutcomeTag
                        outcome={state.outcome}
                        label={label}
                        className="mt-1"
                        testId="shortlist-prereq-outcome"
                      />
                    );
                  })()}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onOpenCourseInfo(course)}
                    className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={`Course info ${course.courseCode}`}
                    data-testid="shortlist-course-info-button"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => onRemoveCourse(course)}
                    className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Remove ${course.courseCode}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
