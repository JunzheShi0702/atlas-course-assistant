/**
 * LLM Agent endpoint — Issue #52
 *
 * Single entry point for all query-based interactions. Out-of-scope messages
 * are answered with a fixed redirect without invoking the main agent. In-scope
 * messages go to the agent, which decides which tools to call (searchCourseDescriptions,
 * searchCoursesBySisConstraints, getCourseEvalSummary, fetchSisCourseDetails), and
 * returns a structured JSON response the frontend can render directly.
 *
 * POST /api/agent
 * Body: { "message": string, "scheduleId"?: string }
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
import {
  isQueryInProductScope,
  OUT_OF_SCOPE_REDIRECT_MESSAGE,
} from "../services/query-scope";
import { getCourseEvalSummary } from "../tools/get-course-eval-summary";
import { generateDaysOfWeek } from "../types/sis";
import type { SearchCourseDescriptionsOutput, SearchResult } from "../types/search";
import {
  loadScheduleContextForAgent,
  buildScheduleContextBlock,
} from "../services/schedule-context";
import { pool } from "../pool";

const router = Router();

/**
 * Fills in empty `description` fields on search results by looking up the
 * course_embeddings table. Called after the agent returns SIS-only results
 * where the SIS /classes endpoint provides no descriptions.
 */
async function enrichMissingDescriptions(results: unknown[]): Promise<unknown[]> {
  const missing = results.filter((r) => {
    if (!r || typeof r !== "object") return false;
    const row = r as Record<string, unknown>;
    return !row.description;
  });
  if (missing.length === 0) return results;

  // Collect all candidate lookup keys (sisOfferingName or code — model may use either).
  const lookupKeys = new Set<string>();
  for (const r of missing) {
    const row = r as Record<string, unknown>;
    if (typeof row.sisOfferingName === "string" && row.sisOfferingName) lookupKeys.add(row.sisOfferingName);
    if (typeof row.code === "string" && row.code) lookupKeys.add(row.code);
  }
  if (lookupKeys.size === 0) return results;

  const { rows } = await pool.query<{ sis_offering_name: string; code: string; short_description: string }>(
    `SELECT sis_offering_name, code, short_description
       FROM course_embeddings
      WHERE sis_offering_name = ANY($1::text[]) OR code = ANY($1::text[])`,
    [[...lookupKeys]],
  );

  const descByKey = new Map<string, string>();
  for (const row of rows) {
    if (row.short_description) {
      descByKey.set(row.sis_offering_name, row.short_description);
      descByKey.set(row.code, row.short_description);
    }
  }

  return results.map((r) => {
    if (!r || typeof r !== "object") return r;
    const row = r as Record<string, unknown>;
    if (row.description) return r;
    const key =
      (typeof row.sisOfferingName === "string" && descByKey.get(row.sisOfferingName)) ||
      (typeof row.code === "string" && descByKey.get(row.code));
    if (key) return { ...row, description: key };
    return r;
  });
}
/**
 * Convert an OfferingName (e.g. "EN.601.226") + term (e.g. "Spring 2026")
 * into the courseId slug used by fetchSisCourseDetails ("en-601-226-spring-2026").
 */
function offeringNameToCourseId(offeringName: string, term: string): string {
  const slug = offeringName.replace(/\./g, "-").toLowerCase();
  const termSlug = term.toLowerCase().replace(/\s+/g, "-");
  return `${slug}-${termSlug}`;
}

/**
 * For SIS-only results the model may omit courseId / sisOfferingName / code.
 * Back-fill them from offeringName so card links and description enrichment work.
 */
function normalizeSisOnlyResults(results: unknown[], term: string): unknown[] {
  return results.map((r) => {
    if (!r || typeof r !== "object") return r;
    const row = r as Record<string, unknown>;
    const offering = typeof row.offeringName === "string" ? row.offeringName : "";
    if (!offering) return r;
    const patch: Record<string, unknown> = {};
    if (!row.courseId || row.courseId === "N/A" || row.courseId === "")
      patch.courseId = offeringNameToCourseId(offering, term);
    if (!row.sisOfferingName) patch.sisOfferingName = offering;
    if (!row.code) {
      // code in course_embeddings uses dots without school prefix, e.g. "601.226"
      const parts = offering.split(".");
      patch.code = parts.length >= 3 ? parts.slice(1).join(".") : offering;
    }
    return Object.keys(patch).length ? { ...row, ...patch } : r;
  });
}

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

/** Satisfies dropSemanticRowsWithoutMatchExplanation when the model omits matchExplanation for valid semantic hits. */
function semanticSearchExplanationFallback(): string {
  return `Related to your search by course description.`;
}

function searchToolRowToMergedApiRow(t: SearchResult): Record<string, unknown> {
  return {
    courseId: t.courseId,
    sisOfferingName: t.sisOfferingName,
    code: t.code,
    title: t.title,
    description: t.description,
    term: t.term,
    rank: t.rank,
    relevanceScore: t.relevanceScore,
    clearlyMatches: t.clearlyMatches,
    matchExplanation: t.clearlyMatches ? undefined : semanticSearchExplanationFallback(),
  };
}

/** Overlay authoritative tool fields so the model cannot drop ids, titles, descriptions, scores, or clearlyMatches. Strips matchExplanation when clearlyMatches is true (deterministic). */
function mergeSearchResultsWithToolRows(
  modelResults: unknown[],
  toolResults: SearchResult[],
): unknown[] {
  if (!toolResults.length) return modelResults;
  if (!modelResults.length) {
    return toolResults.map(searchToolRowToMergedApiRow);
  }
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
    const modelExplanation =
      !c.clearlyMatches &&
      typeof r.matchExplanation === "string" &&
      r.matchExplanation.trim() !== ""
        ? r.matchExplanation
        : undefined;
    const matchExplanation = c.clearlyMatches
      ? undefined
      : (modelExplanation ?? semanticSearchExplanationFallback());
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
      clearlyMatches: c.clearlyMatches,
      matchExplanation,
    };
  });
}

/**
 * Semantic search policy: every non–clearly-matches row must have matchExplanation.
 * Rows with clearlyMatches false and no explanation are dropped (model should remove them; this enforces).
 */
function dropSemanticRowsWithoutMatchExplanation(results: unknown[]): unknown[] {
  return results.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const r = row as Record<string, unknown>;
    if (r.clearlyMatches === true) return true;
    if (r.clearlyMatches === false) {
      const expl = r.matchExplanation;
      return typeof expl === "string" && expl.trim() !== "";
    }
    return true;
  });
}

const BASE_SYSTEM_PROMPT = `You are Atlas, a JHU course advisor assistant. You help JHU undergraduates find and explore undergraduate courses.

SCOPE RESTRICTION: Atlas only covers undergraduate courses (Lower Level and Upper Level Undergraduate). If the user asks for graduate-level courses, 600-level courses, PhD courses, or anything explicitly described as "graduate", respond with { "type": "text", "message": "I can only help with undergraduate course planning at JHU. Graduate-level courses are outside my scope." } and do not call any tools.

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
   - Instructor: last name only (e.g. "Madooei" not "Ali Madooei") — SIS matches by last name; the tool will strip first names automatically
   - Omit unrelated fields the user did not ask for
   - Do not set School or Level unless user explicitly mentions school or course level. Leave them unset otherwise.
   - NEVER set CourseTitle to a school name, department name, or broad subject like "computer science", "engineering", "arts" — CourseTitle matches literal words in the course title. Use School or CourseNumber prefix for department-level queries.
   - Department shorthands → CourseNumber prefix: "CS courses" → CourseNumber "601"; "math courses" → CourseNumber "553"; "bio courses" → CourseNumber "020". CourseNumber and DaysOfWeek CAN be combined — the SIS API handles this correctly.
   - School prefix mapping (letter prefix before the first dot in a course code): "EN" → Whiting School of Engineering; "AS" → Krieger School of Arts and Sciences; "PH" → Bloomberg School of Public Health; "NR" → School of Nursing. When a course code like "EN.601.226" is given, pass the FULL code (e.g., "EN.601.226") as CourseNumber; leave School unset (the tool strips School when CourseNumber is present anyway).
   - When the user query is or contains a full course code (e.g., "EN.601.226", "What is EN.601.226"), ALWAYS call searchCoursesBySisConstraints with CourseNumber = the full code. Do NOT rely solely on searchCourseDescriptions for exact-code lookups.
   - STOP RULE: If searchCoursesBySisConstraints returns 1 or more courses, you MUST return those results immediately as type="search". Do NOT call searchCourseDescriptions or fetchSisCourseDetails afterward. A missing description or no matchExplanation is normal for SIS-only results — still return the card.

4. getCourseEvalSummary
   Get evaluation summary for a specific courseId (from search results).

5. fetchSisCourseDetails
   Get full SIS details (schedule, instructor, location) for a specific courseId.

TOOL SELECTION EXAMPLES:
Global disambiguation rule:
- If multiple plausible courses match and a specific course is required for the next step, return type="search" with top matches so the UI can render course cards and the user can select one.

- Query: exact course codes in format EN.XXX.XXX or AS.XXX.XXX, like "EN.601.225", "What is EN.601.225?", "Tell me about EN.553.291"
  Intent: exact lookup by code.
  Tool sequence: SINGLE call to searchCoursesBySisConstraints with CourseNumber=the full code. Do NOT set School or Level. STOP after this one call — do NOT then call searchCourseDescriptions or fetchSisCourseDetails.
  Output: return the SIS courses as type="search". Missing description or details is fine — the card is enough.

- Query: "courses taught by madooei" or "what does Ali Madooei teach"
  Intent: instructor filtering. Always use last name only.
  Tool sequence: searchCoursesBySisConstraints with Instructor="Madooei" (last name only — full names return 0 results from SIS).
  Output: return search results.

- Query: specific class by title phrase, like "data structs", "intro to fiction and poetry", or "linear algebra"
  Intent: likely exact-title lookup.
  Tool sequence: searchCoursesBySisConstraints with CourseTitle set to the phrase; if no SIS matches, searchCourseDescriptions.
  Output: return search results.

- Query: "WSE classes on Wednesday" or "Whiting courses on Tuesday/Thursday"
  Intent: structured filters (school + day). Do NOT set CourseTitle.
  Tool sequence: generateDaysOfWeek for the day(s), then searchCoursesBySisConstraints with DaysOfWeek and School. Stop after SIS results.
  Output: return search results.

- Query: "CS courses on Wednesdays" or "CS courses on Mondays and Wednesdays"
  Intent: CS department + day filter.
  Tool sequence: generateDaysOfWeek for the day(s) → searchCoursesBySisConstraints with CourseNumber "601" and DaysOfWeek from generateDaysOfWeek. No CourseTitle, no School needed.
  Output: return search results (CS courses meeting on those days).

- Query "data science classes on Wednesdays" (topic keyword + day filter)
  Intent: semantic topic + strict day filter. "data science" is a topic, not a school.
  Tool sequence: generateDaysOfWeek first, then searchCoursesBySisConstraints with DaysOfWeek (no CourseTitle — "data science" is not a literal title). If 0 results, fall back to searchCourseDescriptions. Note: semantic search ignores day filters; prefer SIS results when day is specified.
  Output: return search results; prefer courses that satisfy the day filter.

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

Semantic search (searchCourseDescriptions): each tool row has "clearlyMatches" (computed by the tool). Do not edit clearlyMatches.
- If clearlyMatches is true: do not add matchExplanation (title/code overlap already explains why it appears).
- If clearlyMatches is false: treat each course as retrieved by search as potentially relevant. For each such row you keep in results, you MUST add "matchExplanation": a string of 1–2 short sentences. Help the student see how the course connects to what they asked: use the course's code, title, and description; tie to themes, skills, or subject area. Do not use negative disclaimers (e.g. "not really," "only loosely," "unrelated," "doesn't address"). If you can find **any** reasonable link between the user's query and the course, write that explanation and keep the row. If there is **no** honest or fair way to connect the query to this course, **exclude that course from results entirely**—do not list it without a matchExplanation.
- You must not return a course from searchCourseDescriptions with clearlyMatches false and no matchExplanation. Either include a matchExplanation or omit the course.
- If the final results use only searchCoursesBySisConstraints (no searchCourseDescriptions), do not add matchExplanation or clearlyMatches.
- MAKE SURE matchExplanation is included if clearlyMatches is false!!!!

Search: { "type": "search", "results": [...] }. If you called searchCourseDescriptions, use that tool's results as the base for each row (preserve clearlyMatches; include courseId, code, title, description, term, rank, relevanceScore) and follow the rules above. If the answer is based only on searchCoursesBySisConstraints, map each element of courses into results using the same search-result field names — fill from each SIS row where available, omit or null missing fields, and do not include matchExplanation or clearlyMatches.
Summary: { "type": "summary", "courseId": "<the course you summarized>", "summaryText": "<from getCourseEvalSummary.summaryText, or the tool's message when hasData is false>", "hasData": true|false } — align hasData and summaryText with the tool output.
Details: { "type": "details", "course": <the course object from fetchSisCourseDetails when present, same camelCase fields as the tool (offeringName, sectionName, title, description, schoolName, department, level, timeOfDay, daysOfWeek, location, instructors, status); use null if the tool returned course null> }
Plain text: { "type": "text", "message": "..." } — only when not showing courses; never use this to duplicate or replace a search results payload.`;

// ─── Agent route ──────────────────────────────────────────────────────────────

router.post("/", async (req: Request, res: Response) => {
  const { message, scheduleId: scheduleIdRaw } = req.body as {
    message?: string;
    scheduleId?: unknown;
  };

  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  // When the client aborts (Stop button), cancel the in-flight OpenAI call.
  // Use res.on('close') + res.writableEnded: fires only when the connection
  // drops before we've finished sending, not on normal request completion.
  const abortController = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) {
      console.log("[Agent] client disconnected — aborting generateText");
      abortController.abort();
    }
  });

  const scheduleId =
  typeof scheduleIdRaw === "string" && scheduleIdRaw.trim() !== ""
    ? scheduleIdRaw.trim()
    : undefined;
    
  try {
    let scheduleContextAppend = "";
    if (scheduleId) {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const loaded = await loadScheduleContextForAgent(req.user.id, scheduleId);
      if (!loaded.ok) {
        res
          .status(loaded.error === "forbidden" ? 403 : 404)
          .json({ error: loaded.error === "forbidden" ? "Forbidden" : "Schedule not found" });
        return;
      }
      scheduleContextAppend = buildScheduleContextBlock(loaded.context);
    }

    const inScope = await isQueryInProductScope(message);
    if (!inScope) {
      res.json({
        type: "text",
        message: OUT_OF_SCOPE_REDIRECT_MESSAGE,
      });
      return;
    }

    const systemPrompt = BASE_SYSTEM_PROMPT + scheduleContextAppend;

    const { text, steps } = await generateText({
      abortSignal: abortController.signal,
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
      system: systemPrompt,
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
              // Pass a large raw limit so searchCoursesBySisConstraints can
              // deduplicate across all sections before slicing to `limit` unique courses.
              // (A single popular course can have 20+ sections, so limit*4 is not enough.)
              const result = await searchCoursesBySisConstraints(
                singleCallParams,
                limit,
              );

              return { courses: result.courses };
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
        (parsed as { results: unknown[] }).results = dropSemanticRowsWithoutMatchExplanation(
          mergeSearchResultsWithToolRows(
            (parsed as { results: unknown[] }).results,
            toolSearchRows,
          ),
        );
      }
      // Normalize SIS-only results: derive courseId / sisOfferingName / code from offeringName.
      // Pick term from the first result row that has it, otherwise default to Spring 2026.
      const resultsForTerm = (parsed as { results: unknown[] }).results;
      const termFromRow =
        resultsForTerm.find(
          (r) => r && typeof r === "object" && typeof (r as Record<string, unknown>).term === "string",
        );
      const term =
        (termFromRow && typeof (termFromRow as Record<string, unknown>).term === "string"
          ? (termFromRow as Record<string, unknown>).term
          : "Spring 2026") as string;
      (parsed as { results: unknown[] }).results = normalizeSisOnlyResults(
        (parsed as { results: unknown[] }).results,
        term,
      );
      // Backfill descriptions for SIS-only results using course_embeddings.
      (parsed as { results: unknown[] }).results = await enrichMissingDescriptions(
        (parsed as { results: unknown[] }).results,
      );
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
    if ((err as Error).name === "AbortError") {
      // Client disconnected — connection is already gone, nothing to send.
      return;
    }
    console.error("Agent error:", err);
    res.status(500).json({
      type: "error",
      error: "Agent failed to process your request. Please try again.",
    });
  }
});

export default router;
