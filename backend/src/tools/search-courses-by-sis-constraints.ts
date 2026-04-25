import { fetchSisClasses } from "../services/sis-client";
import {
  CourseSearchParameters,
  RawSisCourse,
  parseDaysOfWeek,
} from "../types/sis";
import {
  normalizeSisCourseNumber,
  normalizeSisInstructor,
} from "../lib/sis-query-normalization";

/** Trimmed, camelCase output shape returned to callers */
export interface SisCourse {
  offeringName: string;
  sectionName: string;
  title: string;
  description: string;
  schoolName: string;
  department: string;
  level: string;
  timeOfDay: string;
  daysOfWeek: string;
  location: string;
  instructors: string[];
  status: string;
}

export interface FilterSisCoursesOutput {
  courses: SisCourse[];
  /** Present when an error occurred (e.g. from catch block). */
  error?: string;
}

/** Map a raw SIS course to our trimmed camelCase shape. */
export function mapRawToSisCourse(raw: RawSisCourse): SisCourse {
  return {
    offeringName: raw.OfferingName ?? "",
    sectionName: raw.SectionName ?? "",
    title: raw.Title ?? "",
    description: "", // Not provided by the SIS /classes endpoint
    schoolName: raw.SchoolName ?? "",
    department: raw.Department ?? "",
    level: raw.Level ?? "",
    timeOfDay: raw.TimeOfDay ?? "",
    daysOfWeek: parseDaysOfWeek(raw.DOW ?? ""),
    location: raw.Location ?? "",
    instructors: raw.InstructorsFullName
      ? raw.InstructorsFullName.split(",").map((s) => s.trim())
      : [],
    status: raw.Status ?? "",
  };
}

function inferSchoolPrefixes(
  school: string | string[] | undefined,
): Array<"AS" | "EN"> {
  if (!school) return [];
  const schools = Array.isArray(school) ? school : [school];
  const out: Array<"AS" | "EN"> = [];

  for (const value of schools) {
    const normalized = value.trim().toLowerCase();
    if (!normalized) continue;
    if (normalized.includes("krieger") || normalized.includes("arts and sciences")) {
      if (!out.includes("AS")) out.push("AS");
      continue;
    }
    if (normalized.includes("whiting") || normalized.includes("engineering")) {
      if (!out.includes("EN")) out.push("EN");
    }
  }
  return out;
}

function buildDepartmentCandidates(
  department: string,
  school: string | string[] | undefined,
): string[] {
  const trimmed = department.trim();
  if (!trimmed) return [];
  if (/^(AS|EN)\s+/i.test(trimmed)) return [trimmed];
  const prefixes = inferSchoolPrefixes(school);
  if (prefixes.length === 0) return [trimmed];
  return prefixes.map((prefix) => `${prefix} ${trimmed}`);
}

function departmentPrefix(department: string): "AS" | "EN" | null {
  const match = department.trim().match(/^(AS|EN)\s+/i);
  if (!match) return null;
  const normalized = match[1].toUpperCase();
  return normalized === "AS" || normalized === "EN" ? normalized : null;
}

function buildDepartmentAttemptQueries(
  query: Record<string, string | string[]>,
  departmentCandidates: string[],
): Array<Record<string, string | string[]>> {
  const schools = Array.isArray(query.School)
    ? query.School.map((value) => value.trim()).filter((value) => value.length > 0)
    : [];
  if (schools.length <= 1) {
    return departmentCandidates.map((candidate) => ({
      ...query,
      Department: candidate,
    }));
  }

  const attempts: Array<Record<string, string | string[]>> = [];
  for (const school of schools) {
    const allowedPrefixes = inferSchoolPrefixes(school);
    for (const candidate of departmentCandidates) {
      const prefix = departmentPrefix(candidate);
      if (prefix && allowedPrefixes.length > 0 && !allowedPrefixes.includes(prefix)) {
        continue;
      }
      attempts.push({
        ...query,
        School: school,
        Department: candidate,
      });
    }
  }

  return attempts.length > 0
    ? attempts
    : departmentCandidates.map((candidate) => ({
        ...query,
        Department: candidate,
      }));
}

/** SIS expects DaysOfWeek as "all|N" or "any|N". Other values (e.g. "Monday") cause 500 Critical Exception. */
function isValidDaysOfWeek(value: string): boolean {
  return /^(all|any)\|\d+$/.test(value.trim());
}

/**
 * Main tool function: pass SIS query params to the API, with minor normalizations
 * so CourseNumber and param names match SIS Advanced Search.
 *
 * Params use PascalCase keys matching the SIS API (Term, School, Department,
 * CourseNumber, DaysOfWeek=all|21, TimeOfDay=morning|afternoon|evening, etc.).
 */
export async function searchCoursesBySisConstraints(
  params: Omit<Partial<CourseSearchParameters>, "School" | "Level"> & {
    // Allow SIS multi-select parameters (passed as repeated query params).
    // Keep these permissive because the SIS API accepts repeated query params,
    // and our callers sometimes build arrays dynamically (widening to string[]).
    School?: string | string[];
    Level?: string | string[];
  },
  limit: number = 10,
): Promise<FilterSisCoursesOutput> {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      const normalized = value
        .map((v) => String(v).trim())
        .filter((v) => v.length > 0);
      if (normalized.length > 0) {
        query[key] = normalized;
      }
      continue;
    }
    let out = String(value).trim();
    if (key === "CourseNumber") {
      out = normalizeSisCourseNumber(out);
    }
    // SIS Instructor field matches by last name only — "Ali Madooei" returns 0 results,
    // "Madooei" returns results. Strip everything except the last word.
    if (key === "Instructor") {
      out = normalizeSisInstructor(out);
    }
    if (key === "DaysOfWeek" && !isValidDaysOfWeek(out)) {
      console.warn(
        "[searchCoursesBySisConstraints] Skipping invalid DaysOfWeek (use generateDaysOfWeek):",
        out,
      );
      continue;
    }
    query[key] = out;
  }

  // CourseNumber prefix (e.g. EN.601, EN.520) already scopes results to that department/school.
  // Combining it with School or Department causes SIS to return 0 results (or 500 errors on bad
  // department names), so drop both when CourseNumber is present.
  if (query.CourseNumber) {
    if (query.School) {
      console.warn(
        "[searchCoursesBySisConstraints] Dropping School (CourseNumber already scopes by school):",
        query.School,
      );
      delete query.School;
    }
    if (query.Department) {
      console.warn(
        "[searchCoursesBySisConstraints] Dropping Department (CourseNumber already scopes by dept):",
        query.Department,
      );
      delete query.Department;
    }
  }

  let raw: RawSisCourse[] = [];
  if (!query.Department || typeof query.Department !== "string") {
    raw = await fetchSisClasses(query);
  } else {
    const departmentCandidates = buildDepartmentCandidates(query.Department, query.School);
    const attemptQueries = buildDepartmentAttemptQueries(query, departmentCandidates);
    let lastError: unknown = null;
    let found = false;
    const aggregated: RawSisCourse[] = [];

    for (const attemptQuery of attemptQueries) {
      try {
        const attemptRaw = await fetchSisClasses(attemptQuery);
        aggregated.push(...attemptRaw);
        found = true;
      } catch (error) {
        lastError = error;
      }
    }

    if (!found) {
      const retryQuery = { ...query };
      delete retryQuery.Department;
      console.warn(
        "[searchCoursesBySisConstraints] SIS request failed with Department candidates; retrying without Department",
        JSON.stringify({ attemptedDepartments: departmentCandidates }),
      );
      try {
        raw = await fetchSisClasses(retryQuery);
      } catch (fallbackError) {
        throw lastError ?? fallbackError;
      }
    } else {
      raw = aggregated;
    }
  }

  // Deduplicate by OfferingName before slicing — SIS returns all sections of a
  // course as separate rows, so slicing first would give only 1 unique course
  // when a popular offering has many sections (e.g. 20+ sections of the same course).
  const seen = new Set<string>();
  const unique = raw.filter((c) => {
    const name = c.OfferingName ?? "";
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });

  const courses = unique.slice(0, limit).map(mapRawToSisCourse);

  return { courses };
}
