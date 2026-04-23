import { searchCourseDescriptions } from "./search-course-descriptions";
import {
  searchCoursesBySisConstraints,
  type SisCourse,
} from "./search-courses-by-sis-constraints";
import type { CourseSearchParameters } from "../types/sis";
import {
  catalogCourseCodeFromOfferingName,
  generateDaysOfWeek,
} from "../types/sis";
import type { SearchResult, SearchMatchType } from "../types/search";

export type SearchCoursesInput = Omit<Partial<CourseSearchParameters>, "School" | "Level"> & {
  School?: string | string[];
  Level?: string | string[];
  days?: string[];
  dayMatchType?: "all" | "any";
  query?: string;
  limit?: number;
};

export interface SearchCoursesOutput {
  results: SearchResult[];
}

interface UnifiedRow {
  row: SearchResult;
  hasSemantic: boolean;
  hasStructured: boolean;
  hasExactStructured: boolean;
}

const VALID_DAY_NAMES = new Set([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeLooseText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function toDottedCourseCode(value: string): string | null {
  const compact = normalizeCode(value);
  if (!/^[A-Z]{2,4}\d{6}$/.test(compact)) {
    return null;
  }

  const school = compact.slice(0, compact.length - 6);
  const dept = compact.slice(compact.length - 6, compact.length - 3);
  const course = compact.slice(compact.length - 3);
  return `${school}.${dept}.${course}`;
}

function normalizeCourseNumber(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/^[A-Z]{2}\.\d/i.test(trimmed)) return trimmed.replace(/\./g, "");
  if (/^\d{3}$/.test(trimmed)) return `EN${trimmed}`;
  return trimmed;
}

function normalizeInstructor(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.includes(" ") ? trimmed.split(/\s+/).pop() ?? "" : trimmed;
}

function extractExplicitCodeFromQuery(query: string): string | null {
  const dotted = query.match(/\b[A-Za-z]{2,4}\.\d{3}\.\d{3}\b/);
  if (dotted) return dotted[0];
  const compact = query.match(/\b[A-Za-z]{2,4}\d{6}\b/);
  return compact ? compact[0] : null;
}

function normalizeSisParams(input: SearchCoursesInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (key === "query" || key === "limit" || key === "days" || key === "dayMatchType") continue;
    if (value == null) continue;

    if (Array.isArray(value)) {
      const normalized = value
        .map((item) => String(item).trim())
        .filter((item) => item.length > 0);
      if (normalized.length > 0) {
        out[key] = normalized;
      }
      continue;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) continue;
      if (key === "CourseNumber") {
        out.CourseNumber = normalizeCourseNumber(trimmed);
      } else if (key === "Instructor") {
        const normalizedInstructor = normalizeInstructor(trimmed);
        if (normalizedInstructor) out.Instructor = normalizedInstructor;
      } else {
        out[key] = trimmed;
      }
      continue;
    }

    out[key] = value;
  }

  if (!out.CourseNumber && typeof input.query === "string" && input.query.trim() !== "") {
    const explicitFromQuery = extractExplicitCodeFromQuery(input.query);
    if (explicitFromQuery) {
      out.CourseNumber = normalizeCourseNumber(explicitFromQuery);
    }
  }

  const rawDays = Array.isArray(input.days)
    ? input.days
        .map((day) => String(day).trim())
        .filter((day) => VALID_DAY_NAMES.has(day.toLowerCase()))
    : [];
  if (rawDays.length > 0) {
    const normalizedDays = rawDays.map(
      (day) => `${day[0].toUpperCase()}${day.slice(1).toLowerCase()}`,
    ) as Array<
      | "Monday"
      | "Tuesday"
      | "Wednesday"
      | "Thursday"
      | "Friday"
      | "Saturday"
      | "Sunday"
    >;
    out.DaysOfWeek = generateDaysOfWeek({
      days: normalizedDays,
      matchType: input.dayMatchType ?? "any",
    });
  }

  return out;
}

function extractExplicitCode(input: SearchCoursesInput): string | null {
  const courseNumberCode = input.CourseNumber
    ? toDottedCourseCode(String(input.CourseNumber))
    : null;
  if (courseNumberCode) return normalizeText(courseNumberCode);

  if (!input.query) return null;
  const match = input.query.match(/[A-Za-z]{2,4}\.\d{3}\.\d{3}/);
  return match ? normalizeText(match[0]) : null;
}

function isExactStructuredMatch(
  row: SearchResult,
  input: SearchCoursesInput,
  explicitCode: string | null,
): boolean {
  if (explicitCode && normalizeText(row.code) === explicitCode) {
    return true;
  }

  if (!input.CourseTitle) {
    return false;
  }

  return normalizeLooseText(row.title) === normalizeLooseText(String(input.CourseTitle));
}

function hasSisParams(input: SearchCoursesInput): boolean {
  const keys = Object.keys(input).filter((key) => key !== "query" && key !== "limit");
  return keys.some((key) => {
    const value = (input as Record<string, unknown>)[key];
    if (value == null) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  });
}

function toSearchResultFromSis(course: SisCourse, term: string): SearchResult {
  const code = catalogCourseCodeFromOfferingName(course.offeringName);
  return {
    courseId: "",
    sisOfferingName: course.offeringName,
    code,
    title: course.title,
    description: course.description,
    term,
    schoolName: course.schoolName,
    department: course.department,
    level: course.level,
    timeOfDay: course.timeOfDay,
    daysOfWeek: course.daysOfWeek,
    instructors: course.instructors,
    rank: 0,
    relevanceScore: 0,
  };
}

function getPrimaryKey(row: SearchResult): string | null {
  const courseId = row.courseId.trim();
  return courseId ? `id:${courseId}` : null;
}

function getSecondaryKey(row: SearchResult): string | null {
  const sisOfferingName = normalizeText(row.sisOfferingName);
  const term = normalizeText(row.term);
  if (!sisOfferingName || !term) {
    return null;
  }
  return `off:${sisOfferingName}|${term}`;
}

function getFallbackKey(row: SearchResult): string {
  const code = normalizeCode(row.code);
  const term = normalizeText(row.term);
  return `code:${code}|${term}`;
}

function mergeRows(base: SearchResult, incoming: SearchResult): SearchResult {
  return {
    courseId: base.courseId || incoming.courseId,
    sisOfferingName: base.sisOfferingName || incoming.sisOfferingName,
    code: base.code || incoming.code,
    title: base.title || incoming.title,
    description: base.description || incoming.description,
    term: base.term || incoming.term,
    credits: base.credits ?? incoming.credits,
    schoolName: base.schoolName ?? incoming.schoolName,
    department: base.department ?? incoming.department,
    level: base.level ?? incoming.level,
    timeOfDay: base.timeOfDay ?? incoming.timeOfDay,
    daysOfWeek: base.daysOfWeek ?? incoming.daysOfWeek,
    instructors: base.instructors ?? incoming.instructors,
    writingIntensive: base.writingIntensive ?? incoming.writingIntensive,
    rank: base.rank || incoming.rank,
    relevanceScore: Math.max(base.relevanceScore, incoming.relevanceScore),
    clearlyMatches: base.clearlyMatches ?? incoming.clearlyMatches,
    matchExplanation: base.matchExplanation ?? incoming.matchExplanation,
  };
}

function resolveMatchType(entry: UnifiedRow): SearchMatchType {
  if (entry.hasSemantic && entry.hasStructured) {
    return "hybrid";
  }
  if (entry.hasStructured && entry.hasExactStructured) {
    return "exact";
  }
  if (entry.hasStructured) {
    return "constraint";
  }
  return "semantic";
}

export async function searchCourses(input: SearchCoursesInput): Promise<SearchCoursesOutput> {
  const query = input.query?.trim();
  const limit = input.limit;
  const semanticLimit = limit ?? 5;
  const sisParams = normalizeSisParams(input);
  const explicitCode = extractExplicitCode({
    ...input,
    CourseNumber:
      typeof sisParams.CourseNumber === "string" ? sisParams.CourseNumber : input.CourseNumber,
  });
  const shouldRunSemantic = Boolean(query) && !explicitCode;
  const shouldRunSis = hasSisParams({ ...input, ...sisParams });

  const [semanticOutput, sisOutput] = await Promise.all([
    shouldRunSemantic ? searchCourseDescriptions({ query: query!, limit: semanticLimit }) : Promise.resolve({ results: [] }),
    shouldRunSis
      ? searchCoursesBySisConstraints(
          sisParams as Parameters<typeof searchCoursesBySisConstraints>[0],
          limit,
        )
      : Promise.resolve({ courses: [] }),
  ]);

  const term = String(input.Term ?? "");

  const unifiedRows: UnifiedRow[] = [];
  const primaryIndex = new Map<string, number>();
  const secondaryIndex = new Map<string, number>();
  const fallbackIndex = new Map<string, number>();

  const upsert = (row: SearchResult, source: "semantic" | "structured", exactStructured: boolean) => {
    const primaryKey = getPrimaryKey(row);
    const secondaryKey = getSecondaryKey(row);
    const fallbackKey = getFallbackKey(row);

    let idx: number | undefined;
    if (primaryKey && primaryIndex.has(primaryKey)) {
      idx = primaryIndex.get(primaryKey);
    }
    if (idx === undefined && secondaryKey && secondaryIndex.has(secondaryKey)) {
      idx = secondaryIndex.get(secondaryKey);
    }
    if (idx === undefined && fallbackIndex.has(fallbackKey)) {
      idx = fallbackIndex.get(fallbackKey);
    }

    if (idx === undefined) {
      idx = unifiedRows.length;
      unifiedRows.push({
        row,
        hasSemantic: source === "semantic",
        hasStructured: source === "structured",
        hasExactStructured: source === "structured" ? exactStructured : false,
      });
    } else {
      const existing = unifiedRows[idx];
      existing.row = mergeRows(existing.row, row);
      if (source === "semantic") {
        existing.hasSemantic = true;
      }
      if (source === "structured") {
        existing.hasStructured = true;
        existing.hasExactStructured = existing.hasExactStructured || exactStructured;
      }
    }

    const finalRow = unifiedRows[idx].row;
    const finalPrimary = getPrimaryKey(finalRow);
    const finalSecondary = getSecondaryKey(finalRow);
    const finalFallback = getFallbackKey(finalRow);

    if (finalPrimary) primaryIndex.set(finalPrimary, idx);
    if (finalSecondary) secondaryIndex.set(finalSecondary, idx);
    fallbackIndex.set(finalFallback, idx);
  };

  semanticOutput.results.forEach((row) => {
    upsert(row, "semantic", false);
  });

  sisOutput.courses.forEach((course) => {
    const row = toSearchResultFromSis(course, term);
    const exactStructured = isExactStructuredMatch(row, input, explicitCode);
    upsert(row, "structured", exactStructured);
  });

  const results = unifiedRows.map((entry, index) => ({
    ...entry.row,
    rank: index + 1,
    matchType: resolveMatchType(entry),
  }));

  return { results };
}
