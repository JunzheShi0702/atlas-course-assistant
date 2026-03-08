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

export const schoolNameSchema = z.enum([
  "Bloomberg School of Public Health",
  "Carey Business School",
  "Krieger School of Arts and Sciences",
  "Krieger School of Arts and Sciences Advanced Academic Programs",
  "Nitze School of Advanced International Studies",
  "School of Education",
  "School of Nursing",
  "The Peabody Institute",
  "Whiting School of Engineering",
  "Whiting School of Engineering Programs for Professionals",
  "The Peabody Preparatory",
  "Bloomberg School of Public Health Non-Credit",
  "School of Medicine",
]);

export type SchoolName = z.infer<typeof schoolNameSchema>;

/**
 * Schema describing what the SIS /classes endpoint returns per course.
 * Used in the system prompt so the LLM knows what fields are available.
 */
export const courseSchema = z.object({
  AllDepartments: z
    .string()
    .describe("All departments assigned to the course, separated by ^"),
  Areas: z
    .string()
    .describe("All areas assigned to the course, separated by ^"),
  Building: z
    .string()
    .describe("All buildings where the course is held, separated by ^"),
  CoursePrefix: z.string().describe("Course Prefix"),
  Credits: z.string().describe("Credits"),
  DOW: z
    .string()
    .describe("Numeric representation of Days of Week when the course is held"),
  DOWSort: z.string().describe("DOW + time in military format"),
  Department: z.string().describe("Department that offers the course"),
  HasBio: z
    .boolean()
    .nullable()
    .describe("Indicates if instructors have Bio information"),
  InstructionMethod: z.string().describe("Instruction Method (e.g., Lecture)"),
  Instructors: z.string().describe("Name of instructors, separated by comma"),
  InstructorsFullName: z
    .string()
    .describe("Full name of instructors, separated by comma"),
  IsWritingIntensive: z
    .enum(["Yes", "No"])
    .describe("Indicates if the course is a Writing Intensive course"),
  Level: z.string().describe("Course Level (e.g., Upper Level Undergraduate)"),
  Location: z
    .string()
    .describe("List of locations where the course is held, separated by ^"),
  MaxSeats: z.string().describe("Maximum available seats"),
  Meetings: z
    .string()
    .describe(
      "Comma separated list of days and times where the course is held (e.g., M 3:30PM - 5:20PM)",
    ),
  OfferingName: z.string().describe("Offering name (e.g., NR.110.305)"),
  OpenSeats: z.string().describe("Number of open seats"),
  Repeatable: z
    .boolean()
    .describe("Indicates if a course is able to be repeated"),
  SchoolName: schoolNameSchema.describe(
    "Name of the school that offers the course",
  ),
  SectionName: z.string().describe("Section Name (e.g., 0101)"),
  SeatsAvailable: z
    .string()
    .describe("Number of available seats out of maximum (e.g., 7/65)"),
  Status: z.string().describe("Section status (e.g., Open)"),
  SubDepartment: z.string().describe("Sub-department"),
  Term: z.string().describe("Academic Term Name (e.g., Fall 2013)"),
  TimeOfDay: z
    .string()
    .describe("Time of day the course is held (e.g., afternoon)"),
  Title: z.string().describe("Course Title"),
});

export type Course = z.infer<typeof courseSchema>;

/**
 * Query parameters for the SIS /classes endpoint.
 * Keys match the SIS API directly (PascalCase).
 * All fields are flat strings/enums — no nested objects.
 */
export const courseSearchParamsSchema = z.object({
  Area: z.string().describe("Area of study").optional(),
  Building: z.string().describe("Building where the course is held").optional(),
  CourseNumber: z
    .string()
    .describe(
      "Course number or portion of it (at least first 3 characters are required)",
    )
    .optional(),
  CourseTitle: z
    .string()
    .describe("Title of the course or any portion of it")
    .optional(),
  Credits: z
    .string()
    .describe("Number of credits including two decimal places (e.g., 3.00)")
    .optional(),
  DaysOfWeek: z
    .string()
    .describe(
      "Encoded days-of-week string in format 'matchType|sum', e.g. 'all|21'. Day values: Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64. Use the generateDaysOfWeek tool to produce this value.",
    )
    .optional(),
  Department: z
    .string()
    .describe(
      "Department name (forward slashes must be replaced with underscores)",
    )
    .optional(),
  Instructor: z.string().describe("Name of the instructor").optional(),
  Level: z
    .string()
    .describe("Course level (e.g., Upper Level Undergraduate)")
    .optional(),
  Location: z.string().describe("Campus location").optional(),
  School: schoolNameSchema
    .describe(
      "Name of the school that offers the course. Leave empty to search all schools unless the user specifies one.",
    )
    .optional(),
  StartTimeEndTime: z
    .string()
    .describe(
      'Start time and end time of the class separated by "|" (pipe). Format: "HH:mm|HH:mm" e.g., "09:00|10:15"',
    )
    .optional(),
  Status: z
    .string()
    .describe(
      "Section status (e.g., Open, Closed). Leave empty unless the user explicitly asks for a specific status.",
    )
    .optional(),
  Term: z.string().describe("Academic Term Name (e.g., Fall 2013)").optional(),
  TimeOfDay: z
    .string()
    .describe("Time of day the course is held (e.g., afternoon)")
    .optional(),
  WritingIntensive: z
    .enum(["Yes", "No"])
    .describe(
      "Indicates if searching for writing intensive courses. Only set to 'Yes' if the user explicitly asks for writing intensive courses. Leave empty otherwise.",
    )
    .optional(),
});

export type CourseSearchParameters = z.infer<typeof courseSearchParamsSchema>;

/** Schema for the generateDaysOfWeek helper tool */
export const generateDaysOfWeekParamsSchema = z.object({
  days: z
    .array(
      z.enum([
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ]),
    )
    .describe("Array of days"),
  matchType: z
    .enum(["all", "any"])
    .describe("Whether to match all days or any of the days"),
});

export type GenerateDaysOfWeekParams = z.infer<
  typeof generateDaysOfWeekParamsSchema
>;

/** Encode days + matchType into the SIS DaysOfWeek query string (e.g. "all|21") */
export function generateDaysOfWeek(params: GenerateDaysOfWeekParams): string {
  const { days, matchType } = params;
  const numericValue = days.reduce(
    (sum, day) => sum + (DAYS_OF_WEEK_CODE[day] ?? 0),
    0,
  );
  return `${matchType}|${numericValue}`;
}

/** Decode a SIS DOW numeric string back to human-readable form (e.g. "21" → "Mon/Wed/Fri") */
export function parseDaysOfWeek(dow: string): string {
  const num = parseInt(dow, 10);
  if (isNaN(num)) return dow;

  const days: string[] = [];
  for (const [code, name] of Object.entries(CODE_TO_DAY)) {
    if (num & parseInt(code, 10)) {
      days.push(name);
    }
  }
  return days.join("/") || "N/A";
}

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

/** Raw PascalCase shape returned by the SIS /classes endpoint */
export interface RawSisCourse {
  OfferingName: string;
  SectionName: string;
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
