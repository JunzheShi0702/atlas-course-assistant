export type ScheduleOperation = "add" | "drop" | "replace";

export type ModifyScheduleFailureReasonCode =
  | "not_found"
  | "ambiguous_reference"
  | "already_in_schedule"
  | "not_in_schedule"
  | "term_mismatch"
  | "forbidden"
  | "invalid_input";

export interface ScheduleCourseRef {
  courseCode: string;
  sisOfferingName: string;
  term: string;
  courseTitle?: string;
  credits?: number;
}

export interface ModifyScheduleCoursesInput {
  scheduleId: string;
  operation: ScheduleOperation;
  addCourses?: ScheduleCourseRef[];
  dropCourses?: ScheduleCourseRef[];
}

export interface ModifyScheduleFailure {
  action: "add" | "drop";
  reasonCode: ModifyScheduleFailureReasonCode;
  message: string;
  candidates?: Array<{
    courseCode: string;
    sisOfferingName: string;
    term: string;
  }>;
}

export interface ModifyScheduleCoursesOutput {
  ok: boolean;
  needsClarification: boolean;
  added: Array<{ courseCode: string; sisOfferingName: string; term: string }>;
  removed: Array<{ courseCode: string; sisOfferingName: string; term: string }>;
  failed: ModifyScheduleFailure[];
}

export interface ModifyScheduleCoursesDependencies {
  addCourse?: (course: ScheduleCourseRef) => Promise<{ added: boolean }>;
  dropCourse?: (course: ScheduleCourseRef) => Promise<{ removed: boolean }>;
  preflightFailures?: ModifyScheduleFailure[];
}

function isBlank(value: string | undefined): boolean {
  return typeof value !== "string" || value.trim() === "";
}

function isAmbiguousRef(ref: ScheduleCourseRef): boolean {
  const hasCode = !isBlank(ref.courseCode);
  const hasOffering = !isBlank(ref.sisOfferingName);
  const hasTitle = !isBlank(ref.courseTitle);
  const hasTerm = !isBlank(ref.term);
  return !hasTerm || (!hasCode && !hasOffering && !hasTitle);
}

function normalizeRefs(refs: ScheduleCourseRef[] | undefined): ScheduleCourseRef[] {
  if (!Array.isArray(refs)) return [];
  return refs
    .map((r) => ({
      ...r,
      courseCode: r.courseCode?.trim() ?? "",
      sisOfferingName: r.sisOfferingName?.trim() ?? "",
      term: r.term?.trim() ?? "",
      courseTitle: r.courseTitle?.trim(),
    }));
}

function requiredCourseCounts(operation: ScheduleOperation): { addMin: number; dropMin: number } {
  if (operation === "add") return { addMin: 1, dropMin: 0 };
  if (operation === "drop") return { addMin: 0, dropMin: 1 };
  return { addMin: 1, dropMin: 1 };
}

export async function modifyScheduleCourses(
  input: ModifyScheduleCoursesInput,
  deps: ModifyScheduleCoursesDependencies = {},
): Promise<ModifyScheduleCoursesOutput> {
  const failures: ModifyScheduleFailure[] = [...(deps.preflightFailures ?? [])];
  const preflightFailureCount = failures.length;

  if (isBlank(input.scheduleId)) {
    return {
      ok: false,
      needsClarification: false,
      added: [],
      removed: [],
      failed: [
        {
          action: "add",
          reasonCode: "forbidden",
          message: "A valid scheduleId is required.",
        },
      ],
    };
  }

  const addCourses = normalizeRefs(input.addCourses);
  const dropCourses = normalizeRefs(input.dropCourses);
  const { addMin, dropMin } = requiredCourseCounts(input.operation);

  const hasAddFailure = failures.some((f) => f.action === "add");
  const hasDropFailure = failures.some((f) => f.action === "drop");

  if (addCourses.length < addMin && !hasAddFailure) {
    failures.push({
      action: "add",
      reasonCode: "invalid_input",
      message: "Please specify at least one course to add for this request.",
    });
  }
  if (dropCourses.length < dropMin && !hasDropFailure) {
    failures.push({
      action: "drop",
      reasonCode: "invalid_input",
      message: "Please specify at least one course to drop for this request.",
    });
  }

  const ambiguousAdd = addCourses.filter(isAmbiguousRef);
  const ambiguousDrop = dropCourses.filter(isAmbiguousRef);

  if (ambiguousAdd.length > 0) {
    failures.push({
      action: "add",
      reasonCode: "ambiguous_reference",
      message: "I need a clearer add target (course code or exact title + term).",
      candidates: [],
    });
  }
  if (ambiguousDrop.length > 0) {
    failures.push({
      action: "drop",
      reasonCode: "ambiguous_reference",
      message: "I need a clearer drop target (course code or exact title + term).",
      candidates: [],
    });
  }

  const validationFailuresAdded = failures.length > preflightFailureCount;
  if (validationFailuresAdded) {
    return {
      ok: false,
      needsClarification: failures.some((f) => f.reasonCode === "ambiguous_reference"),
      added: [],
      removed: [],
      failed: failures,
    };
  }

  const added: Array<{ courseCode: string; sisOfferingName: string; term: string }> = [];
  const removed: Array<{ courseCode: string; sisOfferingName: string; term: string }> = [];

  if (deps.addCourse) {
    for (const course of addCourses) {
      try {
        const result = await deps.addCourse(course);
        if (result.added) {
          added.push({
            courseCode: course.courseCode,
            sisOfferingName: course.sisOfferingName,
            term: course.term,
          });
        } else {
          failures.push({
            action: "add",
            reasonCode: "already_in_schedule",
            message: `${course.sisOfferingName} is already in this schedule.`,
          });
        }
      } catch {
        failures.push({
          action: "add",
          reasonCode: "forbidden",
          message: "Could not add this course to the schedule.",
        });
      }
    }
  }

  if (deps.dropCourse) {
    for (const course of dropCourses) {
      try {
        const result = await deps.dropCourse(course);
        if (result.removed) {
          removed.push({
            courseCode: course.courseCode,
            sisOfferingName: course.sisOfferingName,
            term: course.term,
          });
        } else {
          failures.push({
            action: "drop",
            reasonCode: "not_in_schedule",
            message: `${course.sisOfferingName} is not currently in this schedule.`,
          });
        }
      } catch {
        failures.push({
          action: "drop",
          reasonCode: "forbidden",
          message: "Could not remove this course from the schedule.",
        });
      }
    }
  }

  return {
    ok: failures.length === 0,
    needsClarification: failures.some((f) => f.reasonCode === "ambiguous_reference"),
    added,
    removed,
    failed: failures,
  };
}
