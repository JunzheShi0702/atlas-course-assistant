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
import {
  extractExplicitCourseCode,
  normalizeCourseNumberConstraint,
  normalizeLooseText,
} from "../lib/search-text";
import {
  normalizeSisCourseNumber,
  normalizeSisInstructor,
} from "../lib/sis-query-normalization";

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

const NON_SIS_INPUT_KEYS = new Set(["query", "limit", "days", "dayMatchType"]);
const DAY_NAME_BY_LOWER = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
} as const;
type SisDayName = (typeof DAY_NAME_BY_LOWER)[keyof typeof DAY_NAME_BY_LOWER];

function normalizeStringArray(values: unknown[]): string[] {
  return values
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0);
}

function parseSisDayNames(days: unknown): SisDayName[] {
  if (!Array.isArray(days)) return [];
  return normalizeStringArray(days)
    .map((day) => day.toLowerCase())
    .filter((day): day is keyof typeof DAY_NAME_BY_LOWER => day in DAY_NAME_BY_LOWER)
    .map((day) => DAY_NAME_BY_LOWER[day]);
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeCode(value: string): string {
  return normalizeCourseNumberConstraint(value);
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

function normalizeSisParams(input: SearchCoursesInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (NON_SIS_INPUT_KEYS.has(key)) continue;
    if (value == null) continue;

    if (Array.isArray(value)) {
      const normalized = normalizeStringArray(value);
      if (normalized.length > 0) {
        out[key] = normalized;
      }
      continue;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) continue;
      if (key === "CourseNumber") {
        out.CourseNumber = normalizeSisCourseNumber(trimmed);
      } else if (key === "Instructor") {
        const normalizedInstructor = normalizeSisInstructor(trimmed);
        if (normalizedInstructor) out.Instructor = normalizedInstructor;
      } else {
        out[key] = trimmed;
      }
      continue;
    }

    out[key] = value;
  }

  if (!out.CourseNumber && typeof input.query === "string" && input.query.trim() !== "") {
    const explicitFromQuery = extractExplicitCourseCode(input.query);
    if (explicitFromQuery) {
      out.CourseNumber = normalizeSisCourseNumber(explicitFromQuery);
    }
  }

  const normalizedDays = parseSisDayNames(input.days);
  if (normalizedDays.length > 0) {
    out.DaysOfWeek = generateDaysOfWeek({
      days: normalizedDays,
      matchType: input.dayMatchType ?? "any",
    });
  }

  return out;
}

function extractExplicitCode(input: SearchCoursesInput): string | null {
  const courseNumberCode = input.CourseNumber ? toDottedCourseCode(String(input.CourseNumber)) : null;
  if (courseNumberCode) return normalizeText(courseNumberCode);

  if (!input.query) return null;
  const queryCode = extractExplicitCourseCode(input.query);
  if (!queryCode) return null;
  const dotted = toDottedCourseCode(queryCode);
  return dotted ? normalizeText(dotted) : null;
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

function hasSisParams(sisParams: Record<string, unknown>): boolean {
  return Object.keys(sisParams).length > 0;
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

async function enrichSemanticOnlyRowsWithSisDetails(
  unifiedRows: UnifiedRow[],
  fallbackTerm: string,
  maxLookups: number,
): Promise<void> {
  const targets = unifiedRows
    .filter(
    (entry) =>
      !entry.hasStructured &&
      (typeof entry.row.daysOfWeek !== "string" || entry.row.daysOfWeek.trim() === ""),
    )
    .slice(0, Math.max(0, maxLookups));

  const lookupCache = new Map<string, SisCourse | null>();

  await Promise.all(
    targets.map(async (entry) => {
      const code = typeof entry.row.code === "string" ? entry.row.code.trim() : "";
      if (!code) return;

      const term =
        typeof entry.row.term === "string" && entry.row.term.trim() !== ""
          ? entry.row.term
          : fallbackTerm;
      if (!term) return;
      const lookupKey = `${normalizeCode(code)}|${normalizeText(term)}`;

      try {
        let sisCourse = lookupCache.get(lookupKey) ?? null;
        if (sisCourse === null && !lookupCache.has(lookupKey)) {
          const sisOut = await searchCoursesBySisConstraints(
            {
              CourseNumber: normalizeSisCourseNumber(code),
              Term: term,
            },
            1,
          );
          sisCourse = sisOut.courses[0] ?? null;
          lookupCache.set(lookupKey, sisCourse);
        }
        if (!sisCourse) return;
        entry.row = mergeRows(entry.row, toSearchResultFromSis(sisCourse, term));
      } catch {
        // Best-effort enrichment only; keep semantic row as-is if SIS detail lookup fails.
      }
    }),
  );
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
  const shouldRunSis = hasSisParams(sisParams);

  const [semanticOutput, sisOutput] = await Promise.all([
    shouldRunSemantic
      ? searchCourseDescriptions({ query: query!, limit: semanticLimit })
      : Promise.resolve({ results: [] }),
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

  if (shouldRunSis && unifiedRows.length > 0) {
    await enrichSemanticOnlyRowsWithSisDetails(unifiedRows, term, limit ?? 5);
  }

  const results = unifiedRows.map((entry, index) => ({
    ...entry.row,
    rank: index + 1,
    matchType: resolveMatchType(entry),
  }));

  return { results };
}
