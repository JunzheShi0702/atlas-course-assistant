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

/**
 * True when the message looks like an exact/direct search (course code or short topic).
 * Use exactSearch tool for these queries.
 */
function looksLikeExactSearch(message: string): boolean {
  const q = message.trim();
  if (!q) return false;
  const summarizePattern = /\b(summarize|summary|evaluation|evals?)\b/i;
  const detailsPattern = /\b(detail|details|schedule|instructor|location|status)\b/i;
  if (summarizePattern.test(q) || detailsPattern.test(q)) return false;
  // Course code: EN.601.226, 601, AS.110.302, en-601-226
  const courseCodePattern = /^[a-z]{2}\.[\d.]+$/i.test(q.replace(/\s/g, "")) ||
    /^[a-z]{2}-[\d-]+$/i.test(q) ||
    /^\d{3}$/.test(q);
  if (courseCodePattern) return true;
  // Short topic phrase: 1–5 words, no framing ("find", "show me")
  const words = q.split(/\s+/).filter(Boolean);
  const hasFraming = /\b(find|search|show|list|recommend|looking for|courses?|classes?)\b/i.test(q);
  return words.length >= 1 && words.length <= 5 && !hasFraming;
}

/**
 * True when the message looks like a search (find, recommend, courses, etc.).
 * Used for fallback: if agent returns no search results, run searchCourseDescriptions.
 */
function looksLikeSearchIntent(message: string): boolean {
  const q = message.toLowerCase();
  const summarizePattern = /\b(summarize|summary|evaluation|evals?)\b/;
  const detailsPattern = /\b(detail|details|schedule|instructor|location|status)\b/;
  if (summarizePattern.test(q) || detailsPattern.test(q)) return false;
  const searchPattern =
    /\b(find|search|looking for|recommend|show|list|courses?|class(es)?|machine learning|statistics|data science|writing intensive)\b/;
  return searchPattern.test(q);
}

const SYSTEM_PROMPT = `You are Atlas, a JHU course advisor assistant. You help students find and explore courses.

You have six tools. Call each tool at most once per request. After receiving tool results, return your final answer immediately.

TOOLS:

1. exactSearch
   Direct lookup for short topic phrases (e.g. "data structures", "linear algebra") or course codes (e.g. "EN.601.226", "601").
   Use this FIRST when the user types a short query without framing words like "find" or "courses".

2. generateDaysOfWeek
   Use when the user mentions days (e.g. "Wednesday", "Mon and Wed").
   - "has class on X" / "meets on X" → matchType "any", that day (e.g. ["Wednesday"] → "any|4")
   - "only on Mon and Wed" → matchType "all"
   Returns a string like "any|4". Pass it as DaysOfWeek to filterSisCourses.

3. searchCourseDescriptions
   Semantic search over course titles and descriptions.
   Use for open-ended queries like "easy stats class", "intro to machine learning", "find a easy machine learning course".

4. filterSisCourses
   Filter courses by structured SIS attributes.
   RULES — only include a param if the user explicitly asked for it:
   - Term: always "Spring 2026" unless user says otherwise
   - School: only if user explicitly named a school
   - CourseNumber: pass the EXACT number the user said — do not substitute or guess
   - DaysOfWeek: always use the exact string from generateDaysOfWeek; never guess this value
   - Instructor: only if user named an instructor
   - Omit all other fields — do not add defaults

5. getCourseEvalSummary
   Get evaluation summary for a specific courseId (from search results).

6. fetchSisCourseDetails
   Get full SIS details (schedule, instructor, location) for a specific courseId.

Return your answer ONLY as valid JSON:

Search results: { "type": "search", "results": [{ "courseId", "code", "title", "shortDescription", "term", "rank", "relevanceScore" }] }
Summary: { "type": "summary", "courseId": "...", "summaryText": "...", "hasData": true|false }
Details: { "type": "details", "course": { "offeringName", "title", "description", "instructors", "daysOfWeek", "timeOfDay", "location", "status", "level" } }
Plain text: { "type": "text", "message": "..." }`;

// ─── Agent route ──────────────────────────────────────────────────────────────

router.post("/", async (req: Request, res: Response) => {
  const { message } = req.body as { message?: string };

  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  try {
    // Fast path: direct exact search for short topic phrases or course codes
    if (looksLikeExactSearch(message)) {
      const result = await searchCourseDescriptions({ query: message.trim(), limit: 5 });
      return res.json({ type: "search", results: result.results });
    }

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
        exactSearch: tool({
          description:
            "Direct search for short topic phrases (e.g. 'data structures', 'linear algebra') or course codes (e.g. 'EN.601.226', '601'). Use when the user types a brief query without framing words like 'find' or 'courses'.",
          inputSchema: z.object({
            query: z.string().describe("The user's exact search query as typed"),
            limit: z.number().int().positive().default(5).describe("Max results"),
          }),
          execute: async (params) => searchCourseDescriptions(params),
        }),

        searchCourseDescriptions: tool({
          description:
            "Semantic search over Spring 2026 course titles and descriptions. Use for natural-language queries.",
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
            "Filter courses by structured SIS attributes. Only pass params the user explicitly asked for. CS = CourseNumber 601, ECE = 520. DaysOfWeek must be the exact string from generateDaysOfWeek.",
          inputSchema: z.object({
            Term: z.string().default("Spring 2026").describe("Academic term (default Spring 2026)"),
            School: z
              .enum([
                "Krieger School of Arts and Sciences",
                "Whiting School of Engineering",
              ])
              .optional()
              .describe("Only if user explicitly named a school"),
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
            const { limit, ...rest } = params;
            // Strip empty strings so they don't get forwarded to SIS
            const sisParams: Record<string, unknown> = Object.fromEntries(
              Object.entries(rest).filter(([, v]) => v !== "" && v != null),
            );
            try {
              const result = await filterSisCourses(sisParams as Parameters<typeof filterSisCourses>[0], limit);
              console.log("[Agent] filterSisCourses result: count=" + result.courses.length + (result.error ? " error=" + result.error : ""));
              return result;
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

    // Fallback: for search-intent queries without results, run semantic search
    const parsedTyped = parsed as { type?: string; results?: unknown[] } | null;
    const hasSearchResults =
      parsedTyped &&
      typeof parsedTyped === "object" &&
      parsedTyped.type === "search" &&
      Array.isArray(parsedTyped.results) &&
      parsedTyped.results.length > 0;

    if (looksLikeSearchIntent(message) && !hasSearchResults) {
      const fallback = await searchCourseDescriptions({ query: message, limit: 5 });
      parsed = { type: "search", results: fallback.results };
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
