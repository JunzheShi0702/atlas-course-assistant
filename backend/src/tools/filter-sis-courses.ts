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
    sectionName: String(raw.SectionName ?? ""),
    title: raw.Title ?? "",
    description: "", // Filled by SIS detail endpoint when needed
    schoolName: raw.SchoolName ?? "",
    department: raw.Department ?? "",
    level: raw.Level ?? "",
    timeOfDay: raw.TimeOfDay ?? "",
    daysOfWeek: parseDaysOfWeek(raw.DOW ?? ""),
    location: raw.Location ?? "",
    instructors: raw.InstructorsFullName
      ? raw.InstructorsFullName.split(",").map((s: string) => s.trim())
      : [],
    status: raw.Status ?? "",
  };
}

/**
 * SIS API expects CourseNumber without dots (e.g. AS110302).
 * Converts "AS.110.302" → "AS110302".
 */
function toSisCourseNumber(code: string): string {
  return code.replace(/\./g, "");
}

/**
 * Main tool function: pass SIS query params straight through to the API,
 * then return trimmed results.
 *
 * Params use PascalCase keys matching the SIS API directly.
 * CourseNumber is normalized to SIS format (no dots) before sending.
 */
export async function filterSisCourses(
  params: Partial<CourseSearchParameters>,
  limit: number = 10,
): Promise<FilterSisCoursesOutput> {
  // Convert to Record<string, string> for the SIS client
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      const str = String(value);
      if (key === "CourseNumber") {
        query[key] = toSisCourseNumber(str);
      } else {
        query[key] = str;
      }
    }
  }

  const raw = await fetchSisClasses(query);
  const courses = raw.slice(0, limit).map(mapRawToSisCourse);

  return { courses };
}
