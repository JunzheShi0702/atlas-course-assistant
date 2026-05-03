/**
 * Vercel AI SDK tool definitions for POST /api/agent (behavior matches inline route prior to extraction).
 */

import { tool } from "ai";
import { z } from "zod";
import { searchCourseDescriptions } from "../tools/search-course-descriptions";
import { searchCoursesBySisConstraints } from "../tools/search-courses-by-sis-constraints";
import { getSisCourseDetails } from "../services/get-sis-course-details";
import {
  clampCourseMetricsTermToAllowedWindow,
  queryCourseMetrics,
} from "../tools/query-course-metrics";
import { getCourseEvalSummary } from "../tools/get-course-eval-summary";
import { generateDaysOfWeek } from "../types/sis";
import type { SearchResult } from "../types/search";
import {
  modifyScheduleCourses,
  type ModifyScheduleCoursesInput,
} from "../tools/modify-schedule-courses";
import { searchRateMyProfessor } from "../tools/search-rate-my-professor";
import { searchRedditForCourse } from "../tools/search-reddit-for-course";
import {
  userExplicitlyProvidedCourseNumber,
  userExplicitlySpecifiedSchool,
  userExplicitlySpecifiedUndergradLevel,
} from "../lib/search-text";
import { isNumericCourseMetricsIntent, userExplicitlyRequestedDepartmentCourseSearch } from "./agent-user-intent";

export type SisSearchToolCourseRow = {
  offeringName: string;
  sectionName?: string;
  title?: string;
  description?: string;
  schoolName?: string;
  department?: string;
  level?: string;
  timeOfDay?: string;
  daysOfWeek?: string;
  location?: string;
  instructors?: string[];
  status?: string;
  term?: string;
};

export type QueryCourseMetricsToolOutput = {
  courseCode: string;
  term: string;
  scope: "cross-term" | "term-specific";
  evaluationsTermRange?: string | null;
  metricsSource?: "exact_term" | "historical_offerings" | "all_available" | null;
  disambiguationRequired?: boolean;
  disambiguationCandidates?: SisSearchToolCourseRow[];
  metrics: {
    workload: number | null;
    difficulty: number | null;
    overallQuality: number | null;
    respondentCount: number;
  } | null;
};

const DEFAULT_SCHOOLS = [
  "Krieger School of Arts and Sciences",
  "Whiting School of Engineering",
] as const;
const DEFAULT_UNDERGRAD_LEVELS = [
  "Lower Level Undergraduate",
  "Upper Level Undergraduate",
] as const;

export type CreateAgentToolsContext = {
  message: string;
  scheduleId: string | undefined;
  sisSearchRowsSeenForMetrics: SisSearchToolCourseRow[];
  semanticSearchRowsSeenForMetrics: SearchResult[];
};

export function createAgentTools(ctx: CreateAgentToolsContext) {
  const { message, scheduleId, sisSearchRowsSeenForMetrics, semanticSearchRowsSeenForMetrics } = ctx;

  return {
    searchCourseDescriptions: tool({
      description:
        "Semantic search over Spring 2026 course titles and descriptions. Use for open-ended/exploratory topic queries or as fallback if exact filters (including CourseTitle) return no results.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("Natural-language search query, e.g. 'easy stats class with light workload'"),
        limit: z
          .number()
          .int()
          .positive()
          .default(5)
          .describe("Max results to return (default 5)"),
      }),
      execute: async (params) => {
        const result = await searchCourseDescriptions(params);
        semanticSearchRowsSeenForMetrics.splice(
          0,
          semanticSearchRowsSeenForMetrics.length,
          ...(Array.isArray(result.results) ? result.results : []),
        );
        return result;
      },
    }),

    generateDaysOfWeek: tool({
      description:
        "Call first when user asks for courses by day (e.g. has class on Wednesday). Returns encoded string for searchCoursesBySisConstraints DaysOfWeek. Use matchType 'any' for 'has class on X'; use 'all' for 'only on these days'. Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64.",
      inputSchema: z.object({
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
          .describe("Day(s) user asked for (e.g. [Wednesday])"),
        matchType: z
          .enum(["all", "any"])
          .describe("any = has class on this day; all = only on these days"),
      }),
      execute: async (params) => {
        return generateDaysOfWeek(params);
      },
    }),

    searchCoursesBySisConstraints: tool({
      description:
        "Filter courses by structured SIS attributes to find matches for user's query. By default, search both Krieger and Whiting and only undergraduate levels. Use CourseTitle when the user appears to mean a specific class by name/title phrase (e.g., 'data structs'). CS = CourseNumber 601, ECE = 520. DaysOfWeek must be the exact string from generateDaysOfWeek.",
      inputSchema: z.object({
        Term: z.string().default("Spring 2026").describe("Academic term (default Spring 2026)"),
        School: z
          .enum([
            "Krieger School of Arts and Sciences",
            "Whiting School of Engineering",
          ])
          .optional()
          .describe("Optional override: if set, search only this school"),
        Level: z
          .enum(["Lower Level Undergraduate", "Upper Level Undergraduate"])
          .optional()
          .describe("Optional override: if set, search only this undergraduate level"),
        CourseTitle: z
          .string()
          .optional()
          .describe(
            "Title text (supports partial title match). Use when the user appears to refer to a specific class by title, even if abbreviated (e.g., 'data structs').",
          ),
        CourseNumber: z
          .string()
          .optional()
          .describe(
            "Pass the EXACT number the user said (e.g. user says '601' → pass '601', user says '501' → pass '501'). Do NOT substitute or guess a different number.",
          ),
        Instructor: z.string().optional().describe("Only if user named an instructor"),
        DaysOfWeek: z
          .string()
          .optional()
          .describe("Encoded string from generateDaysOfWeek (e.g. any|4). Only if user asked for specific days."),
        limit: z
          .number()
          .int()
          .positive()
          .default(5)
          .describe("Max results to return"),
      }),
      execute: async (params: unknown) => {
        const typedParams = params as {
          Term: string;
          School?: "Krieger School of Arts and Sciences" | "Whiting School of Engineering";
          Level?: "Lower Level Undergraduate" | "Upper Level Undergraduate";
          CourseTitle?: string;
          CourseNumber?: string;
          Instructor?: string;
          DaysOfWeek?: string;
          limit: number;
        };

        const { limit, School, Level, ...rest } = typedParams;
        const userSpecifiedSchool = userExplicitlySpecifiedSchool(message);
        const userSpecifiedLevel = userExplicitlySpecifiedUndergradLevel(message);
        const userSpecifiedCourseNumber = userExplicitlyProvidedCourseNumber(message);
        const userSpecifiedDepartmentCourseSearch = userExplicitlyRequestedDepartmentCourseSearch(message);
        const baseSisParams: Record<string, unknown> = Object.fromEntries(
          Object.entries(rest).filter(([, v]) => v !== "" && v != null),
        );
        if (baseSisParams.CourseNumber && !userSpecifiedCourseNumber && !userSpecifiedDepartmentCourseSearch) {
          console.log(
            "[Agent] Dropping model-inferred CourseNumber because user did not provide one",
            JSON.stringify({
              inferredCourseNumber: baseSisParams.CourseNumber,
              message,
            }),
          );
          delete baseSisParams.CourseNumber;
        }
        try {
          const singleCallParams = {
            ...(baseSisParams as Parameters<typeof searchCoursesBySisConstraints>[0]),
            School: userSpecifiedSchool && School ? [School] : [...DEFAULT_SCHOOLS],
            Level: userSpecifiedLevel && Level ? [Level] : [...DEFAULT_UNDERGRAD_LEVELS],
          };
          const result = await searchCoursesBySisConstraints(singleCallParams, limit);
          const termForRows =
            typeof typedParams.Term === "string" && typedParams.Term.trim() !== ""
              ? typedParams.Term.trim()
              : "Spring 2026";
          sisSearchRowsSeenForMetrics.splice(
            0,
            sisSearchRowsSeenForMetrics.length,
            ...result.courses
              .filter((course): course is Record<string, unknown> => !!course && typeof course === "object")
              .map((course) => ({
                offeringName: typeof course.offeringName === "string" ? course.offeringName : "",
                sectionName: typeof course.sectionName === "string" ? course.sectionName : undefined,
                title: typeof course.title === "string" ? course.title : undefined,
                description: typeof course.description === "string" ? course.description : undefined,
                schoolName: typeof course.schoolName === "string" ? course.schoolName : undefined,
                department: typeof course.department === "string" ? course.department : undefined,
                level: typeof course.level === "string" ? course.level : undefined,
                timeOfDay: typeof course.timeOfDay === "string" ? course.timeOfDay : undefined,
                daysOfWeek: typeof course.daysOfWeek === "string" ? course.daysOfWeek : undefined,
                location: typeof course.location === "string" ? course.location : undefined,
                instructors: Array.isArray(course.instructors)
                  ? course.instructors.filter((name): name is string => typeof name === "string")
                  : undefined,
                status: typeof course.status === "string" ? course.status : undefined,
                term: termForRows,
              }))
              .filter((course) => course.offeringName.trim() !== ""),
          );
          return { courses: result.courses };
        } catch (err) {
          const toolError = err instanceof Error ? err.message : String(err);
          console.error("[Agent] searchCoursesBySisConstraints failed:", toolError);
          return { courses: [], error: toolError };
        }
      },
    }),

    getCourseEvalSummary: tool({
      description:
        "Generate a summary of course evaluations for a specific course. Use when user asks to summarize or learn about evaluations.",
      inputSchema: z.object({
        courseId: z
          .string()
          .describe("Course ID from search results, e.g. 'en-601-226-spring-2026'"),
      }),
      execute: async (params: unknown) => {
        return getCourseEvalSummary((params as { courseId: string }).courseId);
      },
    }),

    getSisCourseDetails: tool({
      description:
        "Fetch full SIS details for a specific course offering: instructor, schedule, location, status. Use when user wants details about a specific course.",
      inputSchema: z.object({
        courseId: z
          .string()
          .describe("Course ID from search results, e.g. 'en-601-226-spring-2026'"),
      }),
      execute: async (params: unknown) => {
        return getSisCourseDetails((params as { courseId: string }).courseId);
      },
    }),

    queryCourseMetrics: tool({
      description:
        "Fetch aggregated course-level workload, difficulty, and overall quality metrics for a course code. Defaults to cross-term aggregation when term is omitted. If a current/future term is provided, it falls back to cross-term aggregation. Returns metrics null when no evaluation data exists.",
      inputSchema: z.object({
        courseCode: z
          .string()
          .min(3)
          .max(32)
          .describe("Dotted course code, e.g. 'EN.601.226'"),
        term: z
          .string()
          .trim()
          .min(1)
          .max(40)
          .optional()
          .describe(
            "Optional historical academic term, e.g. 'Fall 2025'. If omitted, metrics are aggregated across all terms.",
          ),
      }),
      execute: async (params: unknown) => {
        const typedParams = params as { courseCode: string; term?: string };
        const semanticDisambiguationRows: SisSearchToolCourseRow[] = semanticSearchRowsSeenForMetrics
          .map((row) => ({
            offeringName: row.sisOfferingName,
            title: row.title,
            description: row.description,
            term: row.term,
          }))
          .filter((row) => typeof row.offeringName === "string" && row.offeringName.trim() !== "");
        const disambiguationRows =
          sisSearchRowsSeenForMetrics.length > 1 ? sisSearchRowsSeenForMetrics : semanticDisambiguationRows;
        const shouldForceMetricsDisambiguation =
          isNumericCourseMetricsIntent(message) &&
          !userExplicitlyProvidedCourseNumber(message) &&
          disambiguationRows.length > 1;
        if (shouldForceMetricsDisambiguation) {
          return {
            courseCode: typedParams.courseCode,
            term: "All terms",
            scope: "cross-term",
            evaluationsTermRange: null,
            metricsSource: null,
            disambiguationRequired: true,
            disambiguationCandidates: disambiguationRows.slice(0, 5),
            metrics: null,
          } satisfies QueryCourseMetricsToolOutput;
        }
        const safeTerm = clampCourseMetricsTermToAllowedWindow(typedParams.term);
        return queryCourseMetrics(typedParams.courseCode, safeTerm);
      },
    }),

    modifyScheduleCourses: tool({
      description:
        "Classify and validate schedule edits for the active schedule. Returns clarification requirements and structured failures. In this phase it never mutates schedule data.",
      inputSchema: z.object({
        scheduleId: z.string().describe("Active schedule id"),
        operation: z.enum(["add", "drop", "replace"]),
        addCourses: z
          .array(
            z.object({
              courseCode: z.string(),
              sisOfferingName: z.string(),
              term: z.string(),
              courseTitle: z.string().optional(),
              credits: z.number().optional(),
            }),
          )
          .optional()
          .default([]),
        dropCourses: z
          .array(
            z.object({
              courseCode: z.string(),
              sisOfferingName: z.string(),
              term: z.string(),
              courseTitle: z.string().optional(),
              credits: z.number().optional(),
            }),
          )
          .optional()
          .default([]),
      }),
      execute: async (params: unknown) => {
        const typedParams = params as ModifyScheduleCoursesInput;
        if (!scheduleId) {
          return {
            ok: false,
            needsClarification: false,
            added: [],
            removed: [],
            failed: [
              {
                action: "add",
                reasonCode: "forbidden",
                message: "Schedule edits require an active schedule context.",
              },
            ],
          };
        }
        if (typedParams.scheduleId !== scheduleId) {
          return {
            ok: false,
            needsClarification: false,
            added: [],
            removed: [],
            failed: [
              {
                action: "add",
                reasonCode: "forbidden",
                message: "scheduleId mismatch for active schedule context.",
              },
            ],
          };
        }
        return modifyScheduleCourses(typedParams);
      },
    }),
    searchRateMyProfessor: tool({
      description:
        "Look up a professor's RateMyProfessor data: overall rating, difficulty, would-take-again %, top student tags, and 3 recent comments. ONLY call when the user explicitly names a professor or asks about a specific instructor's reputation, reviews, or teaching style. Do NOT call for generic topic queries. Scoped to JHU professors only.",
      inputSchema: z.object({
        professorLastName: z
          .string()
          .describe("Professor's last name only, e.g. 'Madooei'"),
      }),
      execute: async ({ professorLastName }) => {
        try {
          return await searchRateMyProfessor(professorLastName);
        } catch {
          return {
            found: false,
            message: "Rate My Professor lookup unavailable.",
          };
        }
      },
    }),
    searchRedditForCourse: tool({
      description:
        "Search Reddit for JHU student discussions about a specific course or professor. Returns 3–5 thread titles, URLs, and short snippets. ONLY call when a specific course code (e.g. EN.601.226) or professor name is present. Do NOT call for exploratory topic queries without a specific course or professor identifier.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("Course code (e.g. 'EN.601.226') or professor last name, e.g. 'Madooei JHU'"),
      }),
      execute: async ({ query }) => {
        try {
          return await searchRedditForCourse(query);
        } catch {
          return { found: false, message: "Reddit search unavailable." };
        }
      },
    }),
  };
}
