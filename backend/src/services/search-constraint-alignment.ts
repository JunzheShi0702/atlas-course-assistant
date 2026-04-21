import { catalogCourseCodeFromOfferingName, CODE_TO_DAY } from "../types/sis";
import type { ConstraintMismatchReason } from "../types/search";

type TimeBucket = "morning" | "afternoon" | "evening";

type ExplicitQueryConstraints = {
  days: Set<string>;
  timeBucket: TimeBucket | null;
  schools: Set<string>;
  levels: Set<string>;
  departments: Set<string>;
  credits: number | null;
  writingIntensive: "Yes" | "No" | null;
  courseNumber: string | null;
  instructorLastName: string | null;
};

function normalizeDayToken(input: string): string | null {
  const value = input.toLowerCase();
  if (/(^|\b)(mon|monday)(\b|$)/.test(value)) return "monday";
  if (/(^|\b)(tue|tues|tuesday)(\b|$)/.test(value)) return "tuesday";
  if (/(^|\b)(wed|wednesday)(\b|$)/.test(value)) return "wednesday";
  if (/(^|\b)(thu|thur|thurs|thursday)(\b|$)/.test(value)) return "thursday";
  if (/(^|\b)(fri|friday)(\b|$)/.test(value)) return "friday";
  if (/(^|\b)(sat|saturday)(\b|$)/.test(value)) return "saturday";
  if (/(^|\b)(sun|sunday)(\b|$)/.test(value)) return "sunday";
  return null;
}

function parseDaysFromText(text: string): Set<string> {
  const dayRegex = /\b(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi;
  const out = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = dayRegex.exec(text)) !== null) {
    const normalized = normalizeDayToken(match[1]);
    if (normalized) out.add(normalized);
  }
  return out;
}

function parseTimeBucketFromText(text: string): TimeBucket | null {
  const lower = text.toLowerCase();
  if (/\bmorning\b|before\s+noon|before\s+12|before\s+11/.test(lower)) return "morning";
  if (/\bafternoon\b|after\s+noon|after\s+12/.test(lower)) return "afternoon";
  if (/\bevening\b|\bnight\b|after\s+5|after\s+6|after\s+7/.test(lower)) return "evening";
  return null;
}

function extractCourseDays(row: Record<string, unknown>): Set<string> {
  const source =
    (typeof row.daysOfWeek === "string" && row.daysOfWeek) ||
    (typeof row.meetingDays === "string" && row.meetingDays) ||
    "";
  return parseDaysFromText(source);
}

function extractCourseTimeBucket(row: Record<string, unknown>): TimeBucket | null {
  const source =
    (typeof row.timeOfDay === "string" && row.timeOfDay) ||
    (typeof row.meetingTime === "string" && row.meetingTime) ||
    "";
  if (!source) return null;
  return parseTimeBucketFromText(source);
}

function hasIntersection(a: Set<string>, b: Set<string>): boolean {
  for (const value of a) {
    if (b.has(value)) return true;
  }
  return false;
}

function normalizeSchoolName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeLevelName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeInstructorLastName(value: string): string {
  const parts = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "";
}

function normalizeDepartment(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeCourseNumberConstraint(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function extractCourseNumberConstraintFromMessage(message: string): string | null {
  const exactCode = message.match(/\b[A-Z]{2,4}\.\d{3}\.\d{3}\b/i);
  if (exactCode) return normalizeCourseNumberConstraint(exactCode[0]);

  const compactCode = message.match(/\b[A-Z]{2,4}\d{6}\b/i);
  if (compactCode) return normalizeCourseNumberConstraint(compactCode[0]);

  return null;
}

function extractInstructorConstraintFromMessage(message: string): string | null {
  const byPattern = message.match(
    /\b(?:with|by|prof(?:essor)?|instructor)\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*)?)\b/i,
  );
  if (!byPattern) return null;
  const lastName = normalizeInstructorLastName(byPattern[1]);
  return lastName || null;
}

function extractCreditsConstraintFromMessage(message: string): number | null {
  const match = message.match(/\b(\d+(?:\.\d+)?)\s*credits?\b/i);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractWritingIntensiveConstraintFromMessage(message: string): "Yes" | "No" | null {
  const lower = message.toLowerCase();
  if (/\b(not|non)\s+writing[-\s]?intensive\b/.test(lower)) return "No";
  if (/\bwriting[-\s]?intensive\b|\bwi\b/.test(lower)) return "Yes";
  return null;
}

function parseCredits(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseWritingIntensive(value: unknown): "Yes" | "No" | null {
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "yes") return "Yes";
  if (normalized === "no") return "No";
  return null;
}

function decodeDaysOfWeekConstraint(encodedDays: string): Set<string> {
  const out = new Set<string>();
  const match = encodedDays.trim().match(/^(?:all|any)\|(\d+)$/);
  if (!match) return out;
  const mask = Number.parseInt(match[1], 10);
  if (Number.isNaN(mask) || mask <= 0) return out;

  for (const [bitString, dayLabel] of Object.entries(CODE_TO_DAY)) {
    const bit = Number.parseInt(bitString, 10);
    if ((mask & bit) !== 0) {
      const normalized = normalizeDayToken(dayLabel);
      if (normalized) out.add(normalized);
    }
  }
  return out;
}

function extractExplicitConstraintsFromMessage(userMessage: string): ExplicitQueryConstraints {
  const days = parseDaysFromText(userMessage);
  const timeBucket = parseTimeBucketFromText(userMessage);
  const schools = new Set<string>();
  if (/\bkrieger\b|\bksas\b|krieger school of arts and sciences/i.test(userMessage)) {
    schools.add(normalizeSchoolName("Krieger School of Arts and Sciences"));
  }
  if (/\bwhiting\b|\bwse\b|whiting school of engineering/i.test(userMessage)) {
    schools.add(normalizeSchoolName("Whiting School of Engineering"));
  }

  const levels = new Set<string>();
  if (/\blower[- ]?level undergraduate\b|\blower level\b/i.test(userMessage)) {
    levels.add(normalizeLevelName("Lower Level Undergraduate"));
  }
  if (/\bupper[- ]?level undergraduate\b|\bupper level\b/i.test(userMessage)) {
    levels.add(normalizeLevelName("Upper Level Undergraduate"));
  }

  return {
    days,
    timeBucket,
    schools,
    levels,
    departments: new Set<string>(),
    credits: extractCreditsConstraintFromMessage(userMessage),
    writingIntensive: extractWritingIntensiveConstraintFromMessage(userMessage),
    courseNumber: extractCourseNumberConstraintFromMessage(userMessage),
    instructorLastName: extractInstructorConstraintFromMessage(userMessage),
  };
}

function getLatestStructuredSearchToolInput(
  steps: Array<{ toolCalls?: Array<{ toolName?: string; input?: unknown }> }>,
): Record<string, unknown> | null {
  let lastInput: Record<string, unknown> | null = null;
  for (const step of steps) {
    for (const call of step.toolCalls ?? []) {
      if (!call || typeof call !== "object") continue;
      const toolName = typeof call.toolName === "string" ? call.toolName : "";
      if (toolName !== "searchCoursesBySisConstraints" && toolName !== "searchCourses") continue;
      if (!call.input || typeof call.input !== "object") continue;
      lastInput = call.input as Record<string, unknown>;
    }
  }
  return lastInput;
}

function mergeExplicitConstraintsWithToolInput(
  fromMessage: ExplicitQueryConstraints,
  toolInput: Record<string, unknown> | null,
): ExplicitQueryConstraints {
  if (!toolInput) return fromMessage;

  const days = new Set<string>(fromMessage.days);
  if (typeof toolInput.DaysOfWeek === "string") {
    for (const day of decodeDaysOfWeekConstraint(toolInput.DaysOfWeek)) {
      days.add(day);
    }
  }

  const timeBucket =
    (typeof toolInput.TimeOfDay === "string"
      ? parseTimeBucketFromText(toolInput.TimeOfDay)
      : null) ?? fromMessage.timeBucket;

  const schools = new Set<string>(fromMessage.schools);
  const rawSchools = Array.isArray(toolInput.School) ? toolInput.School : [toolInput.School];
  for (const school of rawSchools) {
    if (typeof school === "string" && school.trim() !== "") {
      schools.add(normalizeSchoolName(school));
    }
  }

  const levels = new Set<string>(fromMessage.levels);
  const rawLevels = Array.isArray(toolInput.Level) ? toolInput.Level : [toolInput.Level];
  for (const level of rawLevels) {
    if (typeof level === "string" && level.trim() !== "") {
      levels.add(normalizeLevelName(level));
    }
  }

  const departments = new Set<string>(fromMessage.departments);
  const rawDepartments = Array.isArray(toolInput.Department)
    ? toolInput.Department
    : [toolInput.Department];
  for (const department of rawDepartments) {
    if (typeof department === "string" && department.trim() !== "") {
      departments.add(normalizeDepartment(department));
    }
  }

  const credits = parseCredits(toolInput.Credits) ?? fromMessage.credits;
  const writingIntensive =
    parseWritingIntensive(toolInput.WritingIntensive) ?? fromMessage.writingIntensive;

  const courseNumber =
    typeof toolInput.CourseNumber === "string" && toolInput.CourseNumber.trim() !== ""
      ? normalizeCourseNumberConstraint(toolInput.CourseNumber)
      : fromMessage.courseNumber;

  const instructorLastName =
    typeof toolInput.Instructor === "string" && toolInput.Instructor.trim() !== ""
      ? normalizeInstructorLastName(toolInput.Instructor)
      : fromMessage.instructorLastName;

  return {
    days,
    timeBucket,
    schools,
    levels,
    departments,
    credits,
    writingIntensive,
    courseNumber,
    instructorLastName,
  };
}

function hasAnyExplicitQueryConstraints(constraints: ExplicitQueryConstraints): boolean {
  return (
    constraints.days.size > 0 ||
    constraints.timeBucket !== null ||
    constraints.schools.size > 0 ||
    constraints.levels.size > 0 ||
    constraints.departments.size > 0 ||
    constraints.credits !== null ||
    constraints.writingIntensive !== null ||
    constraints.courseNumber !== null ||
    constraints.instructorLastName !== null
  );
}

function normalizeCourseCodeForComparison(row: Record<string, unknown>): string {
  if (typeof row.code === "string" && row.code.trim() !== "") {
    return normalizeCourseNumberConstraint(row.code);
  }
  if (typeof row.sisOfferingName === "string" && row.sisOfferingName.trim() !== "") {
    return normalizeCourseNumberConstraint(catalogCourseCodeFromOfferingName(row.sisOfferingName));
  }
  if (typeof row.offeringName === "string" && row.offeringName.trim() !== "") {
    return normalizeCourseNumberConstraint(catalogCourseCodeFromOfferingName(row.offeringName));
  }
  return "";
}

function extractInstructorLastNames(row: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  if (Array.isArray(row.instructors)) {
    for (const instructor of row.instructors) {
      if (typeof instructor !== "string") continue;
      const normalized = normalizeInstructorLastName(instructor);
      if (normalized) names.add(normalized);
    }
    return names;
  }

  if (typeof row.instructors === "string") {
    for (const instructor of row.instructors.split(",")) {
      const normalized = normalizeInstructorLastName(instructor);
      if (normalized) names.add(normalized);
    }
  }
  return names;
}

export function applyDeterministicConstraintAlignment(
  modelResults: unknown[],
  userMessage: string,
  steps: Array<{ toolCalls?: Array<{ toolName?: string; input?: unknown }> }>,
): unknown[] {
  const messageConstraints = extractExplicitConstraintsFromMessage(userMessage);
  const toolInputConstraints = mergeExplicitConstraintsWithToolInput(
    messageConstraints,
    getLatestStructuredSearchToolInput(steps),
  );
  if (!hasAnyExplicitQueryConstraints(toolInputConstraints)) {
    return modelResults;
  }

  return modelResults.map((result) => {
    if (!result || typeof result !== "object") return result;
    const row = result as Record<string, unknown>;
    const mismatchReasons: ConstraintMismatchReason[] = [];
    let hasUnknown = false;

    if (toolInputConstraints.days.size > 0) {
      const rowDays = extractCourseDays(row);
      if (rowDays.size === 0) {
        hasUnknown = true;
      } else if (!hasIntersection(toolInputConstraints.days, rowDays)) {
        mismatchReasons.push("days");
      }
    }

    if (toolInputConstraints.timeBucket !== null) {
      const rowTimeBucket = extractCourseTimeBucket(row);
      if (rowTimeBucket === null) {
        hasUnknown = true;
      } else if (rowTimeBucket !== toolInputConstraints.timeBucket) {
        mismatchReasons.push("time_window");
      }
    }

    if (toolInputConstraints.schools.size > 0) {
      if (typeof row.schoolName !== "string" || row.schoolName.trim() === "") {
        hasUnknown = true;
      } else if (!toolInputConstraints.schools.has(normalizeSchoolName(row.schoolName))) {
        mismatchReasons.push("school");
      }
    }

    if (toolInputConstraints.levels.size > 0) {
      if (typeof row.level !== "string" || row.level.trim() === "") {
        hasUnknown = true;
      } else if (!toolInputConstraints.levels.has(normalizeLevelName(row.level))) {
        mismatchReasons.push("level");
      }
    }

    if (toolInputConstraints.departments.size > 0) {
      if (typeof row.department !== "string" || row.department.trim() === "") {
        hasUnknown = true;
      } else {
        const rowDept = normalizeDepartment(row.department);
        const matchedDepartment = [...toolInputConstraints.departments].some(
          (wanted) => rowDept === wanted || rowDept.includes(wanted) || wanted.includes(rowDept),
        );
        if (!matchedDepartment) mismatchReasons.push("department");
      }
    }

    if (toolInputConstraints.credits !== null) {
      const rowCredits = parseCredits(row.credits);
      if (rowCredits === null) {
        hasUnknown = true;
      } else if (Math.abs(rowCredits - toolInputConstraints.credits) > 0.01) {
        mismatchReasons.push("credits");
      }
    }

    if (toolInputConstraints.writingIntensive !== null) {
      const rowWritingIntensive = parseWritingIntensive(
        row.writingIntensive ?? row.isWritingIntensive,
      );
      if (rowWritingIntensive === null) {
        hasUnknown = true;
      } else if (rowWritingIntensive !== toolInputConstraints.writingIntensive) {
        mismatchReasons.push("writing_intensive");
      }
    }

    if (toolInputConstraints.courseNumber !== null) {
      const rowCode = normalizeCourseCodeForComparison(row);
      if (!rowCode) {
        hasUnknown = true;
      } else if (
        rowCode !== toolInputConstraints.courseNumber &&
        !rowCode.startsWith(toolInputConstraints.courseNumber)
      ) {
        mismatchReasons.push("course_number");
      }
    }

    if (toolInputConstraints.instructorLastName !== null) {
      const rowInstructorLastNames = extractInstructorLastNames(row);
      if (rowInstructorLastNames.size === 0) {
        hasUnknown = true;
      } else if (!rowInstructorLastNames.has(toolInputConstraints.instructorLastName)) {
        mismatchReasons.push("instructor");
      }
    }

    if (mismatchReasons.length > 0) {
      return {
        ...row,
        constraintAlignment: "mismatch",
        constraintMismatchReasons: mismatchReasons,
      };
    }

    if (hasUnknown) {
      return {
        ...row,
        constraintAlignment: "unknown",
      };
    }

    return {
      ...row,
      constraintAlignment: "aligned",
    };
  });
}
