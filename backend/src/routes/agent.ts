/**
 * LLM Agent endpoint — Issue #52
 *
 * Single entry point for all query-based interactions. The agent receives
 * a user message, decides which tools to call (searchCourseDescriptions,
 * searchCoursesBySisConstraints, getCourseEvalSummary, fetchSisCourseDetails), and
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
import {
  searchCoursesBySisConstraints,
  mapRawToSisCourse,
} from "../tools/search-courses-by-sis-constraints";
import { fetchSisCourseDetails } from "../services/sis-client";
import { getCourseEvalSummary } from "../tools/get-course-eval-summary";
import { generateDaysOfWeek } from "../types/sis";
import type { SearchCourseDescriptionsOutput, SearchResult } from "../types/search";

const router = Router();
const DEFAULT_SCHOOLS = [
  "Krieger School of Arts and Sciences",
  "Whiting School of Engineering",
] as const;
const DEFAULT_UNDERGRAD_LEVELS = [
  "Lower Level Undergraduate",
  "Upper Level Undergraduate",
] as const;
const NO_RESULTS_FALLBACK_MESSAGE =
  "I didn’t find any courses matching those criteria. Try relaxing filters or searching for different keywords.";

/** Model output may include markdown fences or prose; extract the JSON object for parsing. */
function stripMarkdownJsonFence(text: string): string {
  let s = text.trim();
  if (!s.startsWith("```")) return s;
  const firstNl = s.indexOf("\n");
  if (firstNl > 0) s = s.slice(firstNl + 1);
  const endFence = s.lastIndexOf("```");
  if (endFence >= 0) s = s.slice(0, endFence);
  return s.trim();
}

function extractFirstJsonObjectString(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseAgentOutputText(text: string): unknown {
  const unfenced = stripMarkdownJsonFence(text);
  try {
    return JSON.parse(unfenced);
  } catch {
    const slice = extractFirstJsonObjectString(unfenced);
    if (slice) {
      return JSON.parse(slice);
    }
    throw new Error("invalid agent JSON");
  }
}

function userExplicitlySpecifiedSchool(message: string): boolean {
  return (
    /(?:\bkrieger\b|\bksas\b|\bwhiting\b|\bwse\b)/i.test(message) ||
    /krieger school of arts and sciences/i.test(message) ||
    /whiting school of engineering/i.test(message)
  );
}

function userExplicitlySpecifiedUndergradLevel(message: string): boolean {
  return /(?:lower level undergraduate|upper level undergraduate|\blower[- ]?level\b|\bupper[- ]?level\b)/i.test(
    message,
  );
}

type AgentStep = { toolResults: Array<{ toolName: string; output: unknown }> };

function getLastSearchCourseDescriptionsResults(steps: AgentStep[]): SearchResult[] {
  let last: SearchResult[] = [];
  for (const step of steps) {
    for (const tr of step.toolResults) {
      if (tr.toolName !== "searchCourseDescriptions") continue;
      const out = tr.output as SearchCourseDescriptionsOutput | undefined;
      if (out?.results?.length) last = out.results;
    }
  }
  return last;
}

/** Overlay authoritative tool fields so the model cannot drop e.g. matchExplanation when re-serializing JSON. */
function mergeSearchResultsWithToolRows(
  modelResults: unknown[],
  toolResults: SearchResult[],
): unknown[] {
  if (!toolResults.length) return modelResults;
  const byCourseId = new Map<string, SearchResult>();
  const byCode = new Map<string, SearchResult>();
  for (const t of toolResults) {
    byCourseId.set(t.courseId.toLowerCase(), t);
    byCode.set(t.code.toLowerCase(), t);
  }
  return modelResults.map((row) => {
    if (!row || typeof row !== "object") return row;
    const r = row as Record<string, unknown>;
    const courseId = typeof r.courseId === "string" ? r.courseId : "";
    const code = typeof r.code === "string" ? r.code : "";
    const c =
      (courseId && byCourseId.get(courseId.toLowerCase())) ??
      (code && byCode.get(code.toLowerCase()));
    if (!c) return row;
    return {
      ...r,
      courseId: c.courseId,
      sisOfferingName: c.sisOfferingName || r.sisOfferingName,
      code: c.code || r.code,
      title: c.title || r.title,
      description: c.description || r.description,
      term: c.term || r.term,
      rank: c.rank ?? r.rank,
      relevanceScore: c.relevanceScore ?? r.relevanceScore,
      matchExplanation: c.matchExplanation,
    };
  });
}

const SYSTEM_PROMPT = `You are Atlas, a JHU course advisor assistant. You help students find and explore courses.

You have five tools. Call each tool at most twice per request. After receiving tool results, return your final answer.

TOOLS:

1. searchCourseDescriptions
   Semantic search over course titles and descriptions.
   Use for open-ended queries like "classes about machine learning", "fun language course", "easy writing class". 
   If the query seems to be about a specific class instead of exploratory (e.g., "organic chem"), call searchCoursesBySisConstraints with CourseTitle set to the likely class title before calling this function.

2. generateDaysOfWeek
   Use when the user mentions days (e.g. "Wednesday", "Mon and Wed").
- "has class on X" / "meets on X" → matchType "any", that day (e.g. ["Wednesday"] → "any|4")
   - "only on Mon and Wed" → matchType "all"
   Returns a string like "any|4". Pass it as DaysOfWeek to searchCoursesBySisConstraints.

3. searchCoursesBySisConstraints
   Structured SIS advanced-search to filter courses by structured SIS attributes.
   DEFAULTS (unless user explicitly overrides):
   - Term: always "Spring 2026" unless user says otherwise
   - School: search BOTH Krieger School of Arts and Sciences and Whiting School of Engineering
   - Level: include only undergraduate courses (lower + upper)
   RULES:
   - CourseNumber: pass the EXACT number the user said — do not substitute or guess
   - DaysOfWeek: always use the exact string from generateDaysOfWeek; never guess this value
   - Instructor: only if user named an instructor
   - Omit unrelated fields the user did not ask for
   - Do not set School or Level unless user explicitly mentions school or course level. Leave them unset otherwise.

4. getCourseEvalSummary
   Get evaluation summary for a specific courseId (from search results).

5. fetchSisCourseDetails
   Get full SIS details (schedule, instructor, location) for a specific courseId.

TOOL SELECTION EXAMPLES:
Global disambiguation rule:
- If multiple plausible courses match and a specific course is required for the next step, return type="search" with top matches so the UI can render course cards and the user can select one.

- Query: exact course codes in format EN.XXX.XXX or AS.XXX.XXX, like "EN.601.225"
  Intent: exact lookup by code.
  Tool sequence: searchCoursesBySisConstraints with CourseNumber set to EN.601.225.
  Output: return search results.

- Query: "courses taught by madooei" (professor name mixed with natural language)
  Intent: instructor filtering.
  Tool sequence: searchCoursesBySisConstraints with Instructor set to "madooei".
  Output: return search results.

- Query: specific class by title phrase, like "data structs", "intro to fiction and poetry", or "linear algebra"
  Intent: likely exact-title lookup.
  Tool sequence: searchCoursesBySisConstraints with CourseTitle set to the phrase; if no SIS matches, searchCourseDescriptions.
  Output: return search results.

- Query: "WSE classes on Wednesday"
  Intent: structured filters (school + day).
  Tool sequence: generateDaysOfWeek for Wednesday, then searchCoursesBySisConstraints with DaysOfWeek and School set to "Whiting School of Engineering".
  Output: return search results.

- Query "data science classes on Wednesdays" (mixes topics and exact filters)
  Intent: semantic topic + strict day filter.
  Tool sequence: searchCourseDescriptions first, then generateDaysOfWeek, then searchCoursesBySisConstraints with DaysOfWeek.
  Output: prioritize results that satisfy strict filters and are semantically relevant.

- Query: "what times is data structures offered at"
  Intent: schedule/details for a specific class.
  Tool sequence: identify candidates via searchCoursesBySisConstraints with CourseTitle="data structures" (or searchCourseDescriptions if needed), then fetchSisCourseDetails after selection.
  Output: apply global disambiguation rule when needed, otherwise return details.

- Query: "how hard is intro to fiction and poetry"
  Intent: evaluation summary for a likely specific class.
  Tool sequence: searchCoursesBySisConstraints with CourseTitle first; if no confident match, searchCourseDescriptions; then getCourseEvalSummary after selection.
  Output: apply global disambiguation rule when needed, otherwise return summary.

OUTPUT FORMAT (CRITICAL — follow every time):
- If you are showing any specific courses (recommendations, examples, search results, or anything the user could add to a schedule), you MUST return { "type": "search", "results": [...] } with those rows. The app renders interactive course cards ONLY from this shape.
- NEVER put course listings in { "type": "text", "message": "..." }: no markdown headings (**Course Title:**), no pasted catalogs, no bullet lists of codes/titles/descriptions. That bypasses the UI and confuses users.
- After calling searchCourseDescriptions or searchCoursesBySisConstraints, your final JSON MUST be type "search" with results from the tools (mapped as specified below), not a prose summary in "text".
- Use { "type": "text", "message": "..." } only when you are not presenting a list of courses (e.g. a short clarification, general advising sentence with no tool results, or when no course tools were used).

Return your answer ONLY as valid JSON:

Search: { "type": "search", "results": [...] }. If you called searchCourseDescriptions, use that tool's results array exactly as results (same objects and keys). If the answer is based only on searchCoursesBySisConstraints, map each element of courses into results using the same search-result field names (courseId, code, title, description, term, rank, relevanceScore) — fill from each SIS row where available, omit or null missing fields. Omit matchExplanation unless it came from searchCourseDescriptions; never invent match text.
Summary: { "type": "summary", "courseId": "<the course you summarized>", "summaryText": "<from getCourseEvalSummary.summaryText, or the tool's message when hasData is false>", "hasData": true|false } — align hasData and summaryText with the tool output.
Details: { "type": "details", "course": <the course object from fetchSisCourseDetails when present, same camelCase fields as the tool (offeringName, sectionName, title, description, schoolName, department, level, timeOfDay, daysOfWeek, location, instructors, status); use null if the tool returned course null> }
Plain text: { "type": "text", "message": "..." } — only when not showing courses; never use this to duplicate or replace a search results payload.`;

// ─── Agent route ──────────────────────────────────────────────────────────────

router.post("/", async (req: Request, res: Response) => {
  const { message } = req.body as { message?: string };

  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  try {
    const { text, steps } = await generateText({
      onStepFinish: (step) => {
        const names = step.toolCalls?.map((t) => t.toolName).join(",") ?? "none";
        console.log(`[Agent] step finishReason=${step.finishReason} toolCalls=${names}`);
        step.toolCalls?.forEach((t) => {
          console.log(`[Agent]   → ${t.toolName} input:`, JSON.stringify(t.input));
        });
        const toolResults = step.toolResults as
          | Array<{ toolName?: string; output?: unknown; result?: unknown }>
          | undefined;
        toolResults?.forEach((r) => {
          const toolName = r.toolName ?? "unknown";
          const output = r.output ?? r.result ?? null;
          const isSearchTool =
            toolName.toLowerCase().includes("search") ||
            toolName === "searchCoursesBySisConstraints";
          if (isSearchTool && output && typeof output === "object") {
            const candidate = output as { results?: unknown; courses?: unknown };
            const resultsArray = Array.isArray(candidate.results)
              ? candidate.results
              : Array.isArray(candidate.courses)
                ? candidate.courses
                : null;
            if (resultsArray) {
              console.log(`[Agent]   ← ${toolName} output length: ${resultsArray.length}`);
              return;
            }
          }
          console.log(`[Agent]   ← ${toolName} output:`, JSON.stringify(output));
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
            const out = generateDaysOfWeek(params);
            return out;
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
            const { limit, School, Level, ...rest } = params;
            const userSpecifiedSchool = userExplicitlySpecifiedSchool(message);
            const userSpecifiedLevel = userExplicitlySpecifiedUndergradLevel(message);
            // Strip empty strings so they don't get forwarded to SIS
            const baseSisParams: Record<string, unknown> = Object.fromEntries(
              Object.entries(rest).filter(([, v]) => v !== "" && v != null),
            );
            try {
              // Single SIS API call with repeated query params for multi-select fields.
              const singleCallParams = {
                ...(baseSisParams as Parameters<
                  typeof searchCoursesBySisConstraints
                >[0]),
                // Enforce defaults unless user explicitly asked for one school/level.
                School:
                  userSpecifiedSchool && School
                    ? [School]
                    : [...DEFAULT_SCHOOLS],
                Level:
                  userSpecifiedLevel && Level
                    ? [Level]
                    : [...DEFAULT_UNDERGRAD_LEVELS],
              };
              const result = await searchCoursesBySisConstraints(
                singleCallParams,
                limit * 4,
              );

              const deduped = Array.from(
                new Map(result.courses.map((course) => [course.offeringName, course])).values(),
              ).slice(0, limit);

              return { courses: deduped };
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              console.error(
                "[Agent] searchCoursesBySisConstraints failed:",
                message,
              );
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

    // Agent returns JSON as text — parse and forward (model may wrap in ```json fences).
    let parsed: unknown;
    try {
      parsed = parseAgentOutputText(text);
    } catch {
      parsed = { type: "text", message: text };
    }

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { type?: string }).type === "search" &&
      Array.isArray((parsed as { results?: unknown }).results)
    ) {
      const toolSearchRows = getLastSearchCourseDescriptionsResults(steps as AgentStep[]);
      if (toolSearchRows.length > 0) {
        (parsed as { results: unknown[] }).results = mergeSearchResultsWithToolRows(
          (parsed as { results: unknown[] }).results,
          toolSearchRows,
        );
      }
    }

    // Normalize no-results and never send an empty message.
    // The model can return type="search" with no results or an empty text message.
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "type" in parsed &&
      (parsed as { type?: string }).type === "search"
    ) {
      const results = (parsed as { results?: unknown }).results;
      if (!Array.isArray(results) || results.length === 0) {
        parsed = {
          type: "search",
          results: [],
          message: NO_RESULTS_FALLBACK_MESSAGE,
        };
      }
    }

    // Never send empty message: model sometimes returns "" when tool returns no results
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "message" in parsed &&
      typeof (parsed as { message?: string }).message === "string" &&
      (parsed as { message: string }).message.trim() === ""
    ) {
      (parsed as { message: string }).message = NO_RESULTS_FALLBACK_MESSAGE;
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
