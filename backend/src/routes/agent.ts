/**
 * LLM Agent endpoint — Issue #52
 *
 * Single entry point for all query-based interactions. The agent receives
 * a user message, decides which tools to call (searchCourseDescriptions,
 * filterSisCourses, getCourseEvalSummary, fetchSisCourseDetails), and
 * returns a structured JSON response the frontend can render directly.
 *
 * POST /api/agent
 * Body: { "message": string }
 *
 * Response: { "type": "search" | "summary" | "details" | "text" | "error", ...payload }
 */

import { Router, Request, Response } from "express";
import { openai } from "@ai-sdk/openai";
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { searchCourseDescriptions } from "../tools/search-course-descriptions";
import { filterSisCourses, mapRawToSisCourse } from "../tools/filter-sis-courses";
import { fetchSisCourseDetails } from "../services/sis-client";
import { getCourseEvalSummary } from "../tools/get-course-eval-summary";
import { generateDaysOfWeek } from "../types/sis";

const router = Router();
const DEFAULT_SCHOOLS = [
  "Krieger School of Arts and Sciences",
  "Whiting School of Engineering",
] as const;
const DEFAULT_UNDERGRAD_LEVELS = [
  "Lower Level Undergraduate",
  "Upper Level Undergraduate",
] as const;

const SYSTEM_PROMPT = `You are Atlas, a JHU course advisor assistant. You help students find and explore courses.

You have five tools. Call each tool at most once per request. After receiving tool results, return your final answer immediately.

TOOLS:

1. searchCourseDescriptions
   Semantic search over course titles and descriptions.
   Use for open-ended queries like "classes about machine learning", "fun language course", "easy writing class".

2. generateDaysOfWeek
   Use when the user mentions days (e.g. "Wednesday", "Mon and Wed").
   - "has class on X" / "meets on X" → matchType "any", that day (e.g. ["Wednesday"] → "any|4")
   - "only on Mon and Wed" → matchType "all"
   Returns a string like "any|4". Pass it as DaysOfWeek to filterSisCourses.

3. filterSisCourses
   Filter courses by structured SIS attributes.
   DEFAULTS (unless user explicitly overrides):
   - Term: always "Spring 2026" unless user says otherwise
   - School: search BOTH Krieger School of Arts and Sciences and Whiting School of Engineering
   - Level: include only undergraduate courses (lower + upper)
   RULES:
   - CourseNumber: pass the EXACT number the user said — do not substitute or guess
   - DaysOfWeek: always use the exact string from generateDaysOfWeek; never guess this value
   - Instructor: only if user named an instructor
   - Omit unrelated fields the user did not ask for

4. getCourseEvalSummary
   Get evaluation summary for a specific courseId (from search results).

5. fetchSisCourseDetails
   Get full SIS details (schedule, instructor, location) for a specific courseId.

TOOL SELECTION EXAMPLES:
Global disambiguation rule:
- If multiple plausible courses match and a specific course is required for the next step, return type="search" with top matches so the UI can render course cards and the user can select one.

- Query: exact course codes in format EN.XXX.XXX or AS.XXX.XXX, like "EN.601.225"
  Intent: exact lookup by code.
  Tool sequence: filterSisCourses with CourseNumber set to EN.601.225.
  Output: return search results.

- Query: "courses taught by madooei" (professor name mixed with natural language)
  Intent: instructor filtering.
  Tool sequence: filterSisCourses with Instructor set to "madooei".
  Output: return search results.

- Query: specific class by title phrase, like "data structs", "intro to fiction and poetry", or "linear algebra"
  Intent: likely exact-title lookup.
  Tool sequence: filterSisCourses with CourseTitle set to the phrase; if no SIS matches, searchCourseDescriptions.
  Output: return search results.

- Query: "WSE classes on Wednesday"
  Intent: structured filters (school + day).
  Tool sequence: generateDaysOfWeek for Wednesday, then filterSisCourses with DaysOfWeek and School set to "Whiting School of Engineering".
  Output: return search results.

- Query "data science classes on Wednesdays" (mixes topics and exact filters)
  Intent: semantic topic + strict day filter.
  Tool sequence: searchCourseDescriptions first, then generateDaysOfWeek, then filterSisCourses with DaysOfWeek.
  Output: prioritize results that satisfy strict filters and are semantically relevant.

- Query: "what times is data structures offered at"
  Intent: schedule/details for a specific class.
  Tool sequence: identify candidates via filterSisCourses with CourseTitle="data structures" (or searchCourseDescriptions if needed), then fetchSisCourseDetails after selection.
  Output: apply global disambiguation rule when needed, otherwise return details.

- Query: "how hard is intro to fiction and poetry"
  Intent: evaluation summary for a likely specific class.
  Tool sequence: filterSisCourses with CourseTitle first; if no confident match, searchCourseDescriptions; then getCourseEvalSummary after selection.
  Output: apply global disambiguation rule when needed, otherwise return summary.

Return your answer ONLY as valid JSON:

Search: { "type": "search", "results": [...] }. If you called searchCourseDescriptions, use that tool's results array exactly as results (same objects and keys). If the answer is based only on filterSisCourses, map each element of courses into results using the same search-result field names (courseId, code, title, description, term, rank, relevanceScore, matchExplanation) — fill from each SIS row where available, omit or null missing fields.
Summary: { "type": "summary", "courseId": "<the course you summarized>", "summaryText": "<from getCourseEvalSummary.summaryText, or the tool's message when hasData is false>", "hasData": true|false } — align hasData and summaryText with the tool output.
Details: { "type": "details", "course": <the course object from fetchSisCourseDetails when present, same camelCase fields as the tool (offeringName, sectionName, title, description, schoolName, department, level, timeOfDay, daysOfWeek, location, instructors, status); use null if the tool returned course null> }
Plain text: { "type": "text", "message": "..." }`;

// ─── Agent route ──────────────────────────────────────────────────────────────

router.post("/", async (req: Request, res: Response) => {
  const { message } = req.body as { message?: string };

  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  try {
    const { text } = await generateText({
      onStepFinish: (step) => {
        const names = step.toolCalls?.map((t) => t.toolName).join(",") ?? "none";
        console.log(`[Agent] step finishReason=${step.finishReason} toolCalls=${names}`);
        step.toolCalls?.forEach((t) => {
          console.log(`[Agent]   → ${t.toolName} input:`, JSON.stringify(t.input));
        });
      },
      model: openai("gpt-4o-mini"),
      system: SYSTEM_PROMPT,
      prompt: message,
      stopWhen: stepCountIs(3),
      tools: {
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
            return searchCourseDescriptions(params);
          },
        }),

        generateDaysOfWeek: tool({
          description:
            "Call first when user asks for courses by day (e.g. has class on Wednesday). Returns encoded string for filterSisCourses DaysOfWeek. Use matchType 'any' for 'has class on X'; use 'all' for 'only on these days'. Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64.",
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
            console.log("[Agent] generateDaysOfWeek input:", JSON.stringify(params));
            const out = generateDaysOfWeek(params);
            console.log("[Agent] generateDaysOfWeek output:", out);
            return out;
          },
        }),

        filterSisCourses: tool({
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
              .describe("Title text (supports partial title match). Use when the user appears to refer to a specific class by title, even if abbreviated (e.g., 'data structs')."),
            CourseNumber: z
              .string()
              .optional()
              .describe("Pass the EXACT number the user said (e.g. user says '601' → pass '601', user says '501' → pass '501'). Do NOT substitute or guess a different number."),
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
          execute: async (params) => {
            console.log("[Agent] filterSisCourses input:", JSON.stringify(params));
            const { limit, School, Level, ...rest } = params;
            // Strip empty strings so they don't get forwarded to SIS
            const baseSisParams: Record<string, unknown> = Object.fromEntries(
              Object.entries(rest).filter(([, v]) => v !== "" && v != null),
            );
            const schools = School ? [School] : [...DEFAULT_SCHOOLS];
            const levels = Level ? [Level] : [...DEFAULT_UNDERGRAD_LEVELS];
            try {
              const combined: ReturnType<typeof mapRawToSisCourse>[] = [];
              for (const school of schools) {
                for (const level of levels) {
                  const result = await filterSisCourses(
                    {
                      ...(baseSisParams as Parameters<typeof filterSisCourses>[0]),
                      School: school,
                      Level: level,
                    },
                    limit,
                  );
                  combined.push(...result.courses);
                }
              }

              const deduped = Array.from(
                new Map(combined.map((course) => [course.offeringName, course])).values(),
              ).slice(0, limit);

              console.log("[Agent] filterSisCourses result: count=" + deduped.length);
              return { courses: deduped };
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              console.error("[Agent] filterSisCourses failed:", message);
              return { courses: [], error: message };
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
          execute: async (params) => {
            return getCourseEvalSummary(params.courseId);
          },
        }),

        fetchSisCourseDetails: tool({
          description:
            "Fetch full SIS details for a specific course offering: instructor, schedule, location, status. Use when user wants details about a specific course.",
          inputSchema: z.object({
            courseId: z
              .string()
              .describe("Course ID from search results"),
          }),
          execute: async (params) => {
            const raw = await fetchSisCourseDetails(params.courseId);
            if (!raw) {
              return {
                courseId: params.courseId,
                course: null,
                message: "Course not found",
              };
            }
            return {
              courseId: params.courseId,
              course: mapRawToSisCourse(raw),
            };
          },
        }),
      } as Record<string, object>,
    });

    // Agent returns JSON as text — parse and forward
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { type: "text", message: text };
    }
    // Never send empty message: model sometimes returns "" when tool returns no results
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "message" in parsed &&
      typeof (parsed as { message?: string }).message === "string" &&
      (parsed as { message: string }).message.trim() === ""
    ) {
      (parsed as { message: string }).message =
        "I didn’t find any courses matching those criteria. Try relaxing filters (e.g. drop the day or use a different term).";
    }

    res.json(parsed);
  } catch (err) {
    console.error("Agent error:", err);
    res.status(500).json({
      type: "error",
      error: "Agent failed to process your request. Please try again.",
    });
  }
});

export default router;
