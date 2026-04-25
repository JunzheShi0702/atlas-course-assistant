import { catalogCourseCodeFromOfferingName, CODE_TO_DAY } from "../types/sis";
import type { ConstraintMismatchReason } from "../types/search";
import {
  extractExplicitCourseCode,
  looseMessageIncludesValue,
  normalizeCaseAndWhitespace,
  normalizeCourseNumberConstraint,
  normalizeDayToken,
  normalizeLastToken,
  parseDaysFromText,
  parseTimeBucketFromText,
  tokenizeLooseText,
  tokensLooselyMatch,
  type TimeBucket,
} from "../lib/search-text";

type DayMatchType = "any" | "all" | "exact";

type ExplicitQueryConstraints = {
  days: Set<string>;
  dayMatchType: DayMatchType;
  timeBucket: TimeBucket | null;
  schools: Set<string>;
  levels: Set<string>;
  departments: Set<string>;
  credits: number | null;
  writingIntensive: "Yes" | "No" | null;
  courseNumber: string | null;
  instructorLastName: string | null;
};

function parseCompactCourseDays(text: string): Set<string> {
  const out = new Set<string>();
  const cleaned = text.trim().toUpperCase();
  if (!cleaned) return out;
  if (cleaned.length > 20) return out;
  if (!/^[A-Z/,&-\s]+$/.test(cleaned)) return out;

  const tokenMap: Record<string, string> = {
    M: "monday",
    T: "tuesday",
    TU: "tuesday",
    W: "wednesday",
    R: "thursday",
    TH: "thursday",
    F: "friday",
    SA: "saturday",
    SU: "sunday",
  };

  const slashTokens = cleaned
    .split(/[/,\s-&]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (slashTokens.length > 1) {
    for (const token of slashTokens) {
      const day = tokenMap[token];
      if (day) out.add(day);
    }
    return out;
  }

  const compact = cleaned.replace(/\s+/g, "");
  const pieces = compact.match(/TH|TU|SA|SU|M|T|W|R|F/g) ?? [];
  for (const piece of pieces) {
    const day = tokenMap[piece];
    if (day) out.add(day);
  }
  return out;
}

function parseDayMatchTypeFromText(text: string, days: Set<string>): DayMatchType {
  const lower = text.toLowerCase();
  if (
    /\bno other days\b/.test(lower) ||
    /\bonly (?:those|these) days\b/.test(lower) ||
    /\bexactly\b/.test(lower)
  ) {
    return "exact";
  }
  if (days.size >= 2 && /\bboth\b/.test(lower)) {
    return "all";
  }
  return "any";
}

function extractCourseDays(row: Record<string, unknown>): Set<string> {
  const source =
    (typeof row.daysOfWeek === "string" && row.daysOfWeek) ||
    (typeof row.meetingDays === "string" && row.meetingDays) ||
    "";
  const parsed = parseDaysFromText(source);
  if (parsed.size > 0) return parsed;
  return parseCompactCourseDays(source);
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

function userExplicitlyMentionsValue(userMessage: string, value: string): boolean {
  return looseMessageIncludesValue(userMessage, value);
}

function userLikelyMentionsDepartment(userMessage: string, department: string): boolean {
  if (userExplicitlyMentionsValue(userMessage, department)) return true;

  const messageTokens = tokenizeLooseText(userMessage);
  const departmentTokens = tokenizeLooseText(department).filter(
    (t) => t.length >= 3 && !["en", "as", "and", "of", "the", "department"].includes(t),
  );
  if (messageTokens.length === 0 || departmentTokens.length === 0) return false;

  let overlap = 0;
  for (const d of departmentTokens) {
    if (messageTokens.some((m) => tokensLooselyMatch(m, d))) {
      overlap += 1;
    }
  }
  return overlap >= Math.min(2, departmentTokens.length);
}

function extractCourseNumberConstraintFromMessage(message: string): string | null {
  const code = extractExplicitCourseCode(message);
  return code ? normalizeCourseNumberConstraint(code) : null;
}

function extractInstructorConstraintFromMessage(message: string): string | null {
  const byPattern = message.match(
    /\b(?:with|by|prof(?:essor)?|instructor)\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*)?)\b/i,
  );
  if (!byPattern) return null;
  const lastName = normalizeLastToken(byPattern[1]);
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

function decodeDaysOfWeekConstraint(encodedDays: string): { days: Set<string>; dayMatchType: DayMatchType | null } {
  const out = new Set<string>();
  const match = encodedDays.trim().match(/^(?:all|any)\|(\d+)$/);
  if (!match) return { days: out, dayMatchType: null };
  const mask = Number.parseInt(match[1], 10);
  if (Number.isNaN(mask) || mask <= 0) return { days: out, dayMatchType: null };

  for (const [bitString, dayLabel] of Object.entries(CODE_TO_DAY)) {
    const bit = Number.parseInt(bitString, 10);
    if ((mask & bit) !== 0) {
      const normalized = normalizeDayToken(dayLabel);
      if (normalized) out.add(normalized);
    }
  }
  return {
    days: out,
    dayMatchType: encodedDays.trim().startsWith("all|") ? "all" : "any",
  };
}

function extractExplicitConstraintsFromMessage(userMessage: string): ExplicitQueryConstraints {
  const days = parseDaysFromText(userMessage);
  const dayMatchType = parseDayMatchTypeFromText(userMessage, days);
  const timeBucket = parseTimeBucketFromText(userMessage);
  const schools = new Set<string>();
  if (/\bkrieger\b|\bksas\b|krieger school of arts and sciences/i.test(userMessage)) {
    schools.add(normalizeCaseAndWhitespace("Krieger School of Arts and Sciences"));
  }
  if (/\bwhiting\b|\bwse\b|whiting school of engineering/i.test(userMessage)) {
    schools.add(normalizeCaseAndWhitespace("Whiting School of Engineering"));
  }

  const levels = new Set<string>();
  if (/\blower[- ]?level undergraduate\b|\blower level\b/i.test(userMessage)) {
    levels.add(normalizeCaseAndWhitespace("Lower Level Undergraduate"));
  }
  if (/\bupper[- ]?level undergraduate\b|\bupper level\b/i.test(userMessage)) {
    levels.add(normalizeCaseAndWhitespace("Upper Level Undergraduate"));
  }

  return {
    days,
    dayMatchType,
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
      if (toolName !== "searchCourses") continue;
      if (!call.input || typeof call.input !== "object") continue;
      lastInput = call.input as Record<string, unknown>;
    }
  }
  return lastInput;
}

function mergeExplicitConstraintsWithToolInput(
  fromMessage: ExplicitQueryConstraints,
  toolInput: Record<string, unknown> | null,
  userMessage: string,
): ExplicitQueryConstraints {
  if (!toolInput) return fromMessage;

  const days = new Set<string>(fromMessage.days);
  let dayMatchType: DayMatchType = fromMessage.dayMatchType;
  if (typeof toolInput.DaysOfWeek === "string") {
    const decoded = decodeDaysOfWeekConstraint(toolInput.DaysOfWeek);
    for (const day of decoded.days) {
      days.add(day);
    }
    if (decoded.dayMatchType) {
      dayMatchType = decoded.dayMatchType;
    }
  }

  const timeBucket =
    (fromMessage.timeBucket !== null && typeof toolInput.TimeOfDay === "string"
      ? parseTimeBucketFromText(toolInput.TimeOfDay)
      : null) ?? fromMessage.timeBucket;

  const schools = new Set<string>(fromMessage.schools);
  const rawSchools = Array.isArray(toolInput.School) ? toolInput.School : [toolInput.School];
  for (const school of rawSchools) {
    if (
      typeof school === "string" &&
      school.trim() !== "" &&
      fromMessage.schools.size > 0
    ) {
      schools.add(normalizeCaseAndWhitespace(school));
    }
  }

  const levels = new Set<string>(fromMessage.levels);
  const rawLevels = Array.isArray(toolInput.Level) ? toolInput.Level : [toolInput.Level];
  for (const level of rawLevels) {
    if (
      typeof level === "string" &&
      level.trim() !== "" &&
      fromMessage.levels.size > 0
    ) {
      levels.add(normalizeCaseAndWhitespace(level));
    }
  }

  const departments = new Set<string>(fromMessage.departments);
  const rawDepartments = Array.isArray(toolInput.Department)
    ? toolInput.Department
    : [toolInput.Department];
  for (const department of rawDepartments) {
    if (
      typeof department === "string" &&
      department.trim() !== "" &&
      userLikelyMentionsDepartment(userMessage, department)
    ) {
      departments.add(normalizeCaseAndWhitespace(department));
    }
  }

  const credits =
    (fromMessage.credits !== null ? parseCredits(toolInput.Credits) : null) ??
    fromMessage.credits;
  const writingIntensive =
    (fromMessage.writingIntensive !== null
      ? parseWritingIntensive(toolInput.WritingIntensive)
      : null) ?? fromMessage.writingIntensive;

  const courseNumber =
    fromMessage.courseNumber !== null &&
    typeof toolInput.CourseNumber === "string" &&
    toolInput.CourseNumber.trim() !== ""
      ? normalizeCourseNumberConstraint(toolInput.CourseNumber)
      : fromMessage.courseNumber;

  const instructorLastName =
    fromMessage.instructorLastName !== null &&
    typeof toolInput.Instructor === "string" &&
    toolInput.Instructor.trim() !== ""
      ? normalizeLastToken(toolInput.Instructor)
      : fromMessage.instructorLastName;

  return {
    days,
    dayMatchType,
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

function hasAll(required: Set<string>, actual: Set<string>): boolean {
  for (const day of required) {
    if (!actual.has(day)) return false;
  }
  return true;
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
      const normalized = normalizeLastToken(instructor);
      if (normalized) names.add(normalized);
    }
    return names;
  }

  if (typeof row.instructors === "string") {
    for (const instructor of row.instructors.split(",")) {
      const normalized = normalizeLastToken(instructor);
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
    userMessage,
  );
  if (!hasAnyExplicitQueryConstraints(toolInputConstraints)) {
    return modelResults;
  }

  return modelResults.map((result) => {
    if (!result || typeof result !== "object") return result;
    const row = result as Record<string, unknown>;
    const mismatchReasons: ConstraintMismatchReason[] = [];
    let hasUnknown = false;
    const rowDays = extractCourseDays(row);
    const rowTimeBucket = extractCourseTimeBucket(row);
    const rowSchoolName =
      typeof row.schoolName === "string" && row.schoolName.trim() !== ""
        ? normalizeCaseAndWhitespace(row.schoolName)
        : null;
    const rowLevel =
      typeof row.level === "string" && row.level.trim() !== ""
        ? normalizeCaseAndWhitespace(row.level)
        : null;
    const rowDepartment =
      typeof row.department === "string" && row.department.trim() !== ""
        ? normalizeCaseAndWhitespace(row.department)
        : null;
    const rowCredits = parseCredits(row.credits);
    const rowWritingIntensive = parseWritingIntensive(row.writingIntensive ?? row.isWritingIntensive);
    const rowCode = normalizeCourseCodeForComparison(row);
    const rowInstructorLastNames = extractInstructorLastNames(row);

    if (toolInputConstraints.days.size > 0) {
      if (rowDays.size === 0) {
        hasUnknown = true;
      } else if (
        (toolInputConstraints.dayMatchType === "any" &&
          !hasIntersection(toolInputConstraints.days, rowDays)) ||
        (toolInputConstraints.dayMatchType === "all" &&
          !hasAll(toolInputConstraints.days, rowDays)) ||
        (toolInputConstraints.dayMatchType === "exact" &&
          (!hasAll(toolInputConstraints.days, rowDays) ||
            rowDays.size !== toolInputConstraints.days.size))
      ) {
        mismatchReasons.push("days");
      }
    }

    if (toolInputConstraints.timeBucket !== null) {
      if (rowTimeBucket === null) {
        hasUnknown = true;
      } else if (rowTimeBucket !== toolInputConstraints.timeBucket) {
        mismatchReasons.push("time_window");
      }
    }

    if (toolInputConstraints.schools.size > 0) {
      if (rowSchoolName === null) {
        hasUnknown = true;
      } else if (!toolInputConstraints.schools.has(rowSchoolName)) {
        mismatchReasons.push("school");
      }
    }

    if (toolInputConstraints.levels.size > 0) {
      if (rowLevel === null) {
        hasUnknown = true;
      } else if (!toolInputConstraints.levels.has(rowLevel)) {
        mismatchReasons.push("level");
      }
    }

    if (toolInputConstraints.departments.size > 0) {
      if (rowDepartment === null) {
        hasUnknown = true;
      } else {
        const matchedDepartment = [...toolInputConstraints.departments].some(
          (wanted) =>
            rowDepartment === wanted ||
            rowDepartment.includes(wanted) ||
            wanted.includes(rowDepartment),
        );
        if (!matchedDepartment) mismatchReasons.push("department");
      }
    }

    if (toolInputConstraints.credits !== null) {
      if (rowCredits === null) {
        hasUnknown = true;
      } else if (Math.abs(rowCredits - toolInputConstraints.credits) > 0.01) {
        mismatchReasons.push("credits");
      }
    }

    if (toolInputConstraints.writingIntensive !== null) {
      if (rowWritingIntensive === null) {
        hasUnknown = true;
      } else if (rowWritingIntensive !== toolInputConstraints.writingIntensive) {
        mismatchReasons.push("writing_intensive");
      }
    }

    if (toolInputConstraints.courseNumber !== null) {
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
