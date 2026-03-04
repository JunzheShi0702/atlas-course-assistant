import { z } from "zod";

/**
 * SIS day-of-week encoding. Each day maps to a power of 2.
 * SIS uses the sum of these values to represent day combinations.
 */
export const DAYS_OF_WEEK_CODE: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 4,
  Thu: 8,
  Fri: 16,
  Sat: 32,
  Sun: 64,
};

/** Reverse lookup: SIS numeric code → short day name */
export const CODE_TO_DAY: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  4: "Wed",
  8: "Thu",
  16: "Fri",
  32: "Sat",
  64: "Sun",
};

export const filterSisCoursesInputSchema = z.object({
  term: z.string().describe('Academic term, e.g. "Spring 2026"'),
  school: z
    .enum([
      "Krieger School of Arts and Sciences",
      "Whiting School of Engineering",
    ])
    .optional(),
  department: z.string().optional(),
  instructor: z.string().optional(),
  credits: z.number().optional(),
  timeOfDay: z.enum(["morning", "afternoon", "evening"]).optional(),
  daysOfWeek: z
    .object({
      match: z.enum(["all", "any"]),
      days: z.array(z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])),
    })
    .optional(),
  startTimeEndTime: z
    .object({
      start: z.string().describe('24h format, e.g. "09:00"'),
      end: z.string().describe('24h format, e.g. "10:15"'),
    })
    .optional(),
  level: z
    .enum(["Upper Level Undergraduate", "Lower Level Undergraduate"])
    .optional(),
  writingIntensive: z.enum(["Yes", "No"]).optional(),
  limit: z.number().int().positive().default(20),
});

export type FilterSisCoursesInput = z.infer<typeof filterSisCoursesInputSchema>;

/** Trimmed, camelCase output shape returned to callers */
export interface SisCourse {
  offeringName: string;
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

/** Raw PascalCase shape returned by the SIS /classes endpoint */
export interface RawSisCourse {
  OfferingName: string;
  Title: string;
  SchoolName: string;
  Department: string;
  Level: string;
  TimeOfDay: string;
  DOW: string;
  Location: string;
  InstructorsFullName: string;
  Status: string;
  [key: string]: unknown;
}
