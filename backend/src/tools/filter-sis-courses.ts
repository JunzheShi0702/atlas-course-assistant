import { fetchSisClasses } from "../services/sis-client";
import {
  CourseSearchParameters,
  RawSisCourse,
  parseDaysOfWeek,
} from "../types/sis";

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

/**
 * SIS advanced-search CourseNumber uses the concatenated format WITHOUT dots:
 *   EN.601.226 is stored as "EN601226"; searching CourseNumber=EN601 returns all EN.601.xxx
 *   courses. Passing "EN.601" returns 0 because SIS sees it as a literal prefix match on
 *   the concatenated string and no offering starts with "EN.601" in that format.
 *
 * Normalize user-supplied values:
 *   "601"      → "EN601"   (3-digit Whiting dept code)
 *   "EN.601"   → "EN601"   (dot-separated prefix → no-dot)
 *   "EN601226" → "EN601226" (already correct, pass through)
 */
function normalizeCourseNumber(courseNumber: string): string {
  const trimmed = courseNumber.trim();
  if (!trimmed) return trimmed;
  // Dot-separated prefix like "EN.601" or "EN.601.226" → strip dots
  if (/^[A-Z]{2}\.\d/i.test(trimmed)) {
    return trimmed.replace(/\./g, "");
  }
  // 3-digit dept code like "601" or "520" → prepend "EN"
  if (/^\d{3}$/.test(trimmed)) {
    return `EN${trimmed}`;
  }
  return trimmed;
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
export async function filterSisCourses(
  params: Partial<CourseSearchParameters>,
  limit: number = 10,
): Promise<FilterSisCoursesOutput> {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    let out = String(value).trim();
    if (key === "CourseNumber") {
      out = normalizeCourseNumber(out);
    }
    if (key === "DaysOfWeek" && !isValidDaysOfWeek(out)) {
      console.warn("[filterSisCourses] Skipping invalid DaysOfWeek (use generateDaysOfWeek):", out);
      continue;
    }
    query[key] = out;
  }

  // CourseNumber prefix (e.g. EN.601, EN.520) already scopes results to that department/school.
  // Combining it with School or Department causes SIS to return 0 results (or 500 errors on bad
  // department names), so drop both when CourseNumber is present.
  if (query.CourseNumber) {
    if (query.School) {
      console.warn("[filterSisCourses] Dropping School (CourseNumber already scopes by school):", query.School);
      delete query.School;
    }
    if (query.Department) {
      console.warn("[filterSisCourses] Dropping Department (CourseNumber already scopes by dept):", query.Department);
      delete query.Department;
    }
  }

  const raw = await fetchSisClasses(query);
  const courses = raw.slice(0, limit).map(mapRawToSisCourse);

  return { courses };
}
