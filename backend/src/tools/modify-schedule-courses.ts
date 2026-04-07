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

interface ModifyScheduleFailure {
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
): Promise<ModifyScheduleCoursesOutput> {
  const failures: ModifyScheduleFailure[] = [];

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

  if (addCourses.length < addMin) {
    failures.push({
      action: "add",
      reasonCode: "invalid_input",
      message: "Please specify at least one course to add for this request.",
    });
  }
  if (dropCourses.length < dropMin) {
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

  const needsClarification = failures.some((f) => f.reasonCode === "ambiguous_reference");
  const ok = failures.length === 0;

  // #186 scope: classify/validate only. No schedule mutation happens here yet.
  return {
    ok,
    needsClarification,
    added: [],
    removed: [],
    failed: failures,
  };
}
