import { fetchSisClasses } from "../services/sis-client";
import {
  DAYS_OF_WEEK_CODE,
  CODE_TO_DAY,
  FilterSisCoursesInput,
  FilterSisCoursesOutput,
  RawSisCourse,
  SisCourse,
} from "../types/sis";

/**
 * Encode a daysOfWeek input into the SIS DaysOfWeek query parameter.
 * SIS expects a string like "all|21" where 21 = Mon(1) + Wed(4) + Fri(16).
 */
export function encodeDaysOfWeek(match: "all" | "any", days: string[]): string {
  const sum = days.reduce((acc, day) => acc + (DAYS_OF_WEEK_CODE[day] ?? 0), 0);
  return `${match}|${sum}`;
}

/**
 * Encode start/end times into SIS StartTimeEndTime query parameter.
 * SIS expects "HH:MM|HH:MM".
 */
export function encodeStartTimeEndTime(start: string, end: string): string {
  return `${start}|${end}`;
}

/**
 * Decode a SIS DOW numeric string back to a human-readable form.
 * e.g. "21" → "Mon/Wed/Fri"
 */
export function decodeDaysOfWeek(dow: string): string {
  const num = parseInt(dow, 10);
  if (isNaN(num)) return dow;

  const days: string[] = [];
  for (const [code, name] of Object.entries(CODE_TO_DAY)) {
    if (num & parseInt(code, 10)) {
      days.push(name);
    }
  }
  return days.join("/") || dow;
}

/** Map a raw SIS course to our trimmed camelCase shape. */
export function mapRawToSisCourse(raw: RawSisCourse): SisCourse {
  return {
    offeringName: raw.OfferingName ?? "",
    title: raw.Title ?? "",
    description: "",
    schoolName: raw.SchoolName ?? "",
    department: raw.Department ?? "",
    level: raw.Level ?? "",
    timeOfDay: raw.TimeOfDay ?? "",
    daysOfWeek: decodeDaysOfWeek(raw.DOW ?? ""),
    location: raw.Location ?? "",
    instructors: raw.InstructorsFullName
      ? raw.InstructorsFullName.split(",").map((s) => s.trim())
      : [],
    status: raw.Status ?? "",
  };
}

/**
 * Main tool function: build SIS query params from the friendly input,
 * call the SIS API, and return trimmed results.
 */
export async function filterSisCourses(
  input: FilterSisCoursesInput,
): Promise<FilterSisCoursesOutput> {
  const params: Record<string, string> = {};

  // Required
  params["Term"] = input.term;

  // Optional filters
  if (input.school) {
    params["School"] = input.school;
  }
  if (input.department) {
    // SIS requires "/" replaced with "_" in department names
    params["Department"] = input.department.replace(/\//g, "_");
  }
  if (input.instructor) {
    params["Instructor"] = input.instructor;
  }
  if (input.credits !== undefined) {
    params["Credits"] = input.credits.toFixed(2);
  }
  if (input.timeOfDay) {
    params["TimeOfDay"] = input.timeOfDay;
  }
  if (input.daysOfWeek) {
    params["DaysOfWeek"] = encodeDaysOfWeek(
      input.daysOfWeek.match,
      input.daysOfWeek.days,
    );
  }
  if (input.startTimeEndTime) {
    params["StartTimeEndTime"] = encodeStartTimeEndTime(
      input.startTimeEndTime.start,
      input.startTimeEndTime.end,
    );
  }
  if (input.level) {
    params["Level"] = input.level;
  }
  if (input.writingIntensive) {
    params["WritingIntensive"] = input.writingIntensive;
  }

  const raw = await fetchSisClasses(params);
  const courses = raw.slice(0, input.limit).map(mapRawToSisCourse);

  return { courses };
}
