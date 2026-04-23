/**
 * LLM Agent endpoint 
 *
 * Single entry point for all query-based interactions. Out-of-scope messages
 * are answered with a fixed redirect without invoking the main agent. In-scope
 * messages go to the agent, which decides which tools to call and
 * returns a structured JSON response the frontend can render directly.
 *
 * POST /api/agent
 * Body: { "message": string, "scheduleId"?: string }
 *
 * Response: { "type": "search" | "summary" | "details" | "text" | "error", ...payload }
 */

import { Router, Request, Response } from "express";
import { openai } from "@ai-sdk/openai";
import { generateText, streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { searchCourses, type SearchCoursesInput } from "../tools/search-courses";
import { getSisCourseDetails } from "../services/get-sis-course-details";
import { queryCourseMetrics } from "../tools/query-course-metrics";
import {
  isQueryInProductScope,
  OUT_OF_SCOPE_REDIRECT_MESSAGE,
} from "../services/query-scope";
import { getCourseEvalSummary } from "../tools/get-course-eval-summary";
import {
  catalogCourseCodeFromOfferingName,
  generateDaysOfWeek,
} from "../types/sis";
import type { SearchResult } from "../types/search";
import {
  loadScheduleContextForAgent,
  buildScheduleContextBlock,
  loadUserMemoryContextForAgent,
  buildUserMemoriesOnlyBlock,
} from "../services/schedule-context";
import {
  getOrCreateChatState,
  persistMessage,
  enforceRetentionPolicy,
  loadRecentMessages,
  formatChatHistoryBlock,
  type ChatStateRow,
  type ChatMessageRow,
} from "../services/chat-persistence";
import { runChatMemoryExtraction } from "../services/chat-memory-extraction";
import { pool } from "../pool";
import { detectScheduleModificationIntent } from "../services/schedule-modification-intent";
import {
  modifyScheduleCourses,
  type ModifyScheduleCoursesOutput,
} from "../tools/modify-schedule-courses";
import { handleScheduleEditMessage } from "../services/schedule-edit-orchestrator";
import { applyDeterministicConstraintAlignment } from "../services/search-constraint-alignment";
import {
  appendMismatchNotes,
  applyDeterministicSearchRanking,
} from "../services/search-result-post-processing";

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
 * into the courseId slug used by getSisCourseDetails ("en-601-226-spring-2026").
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
      patch.code = catalogCourseCodeFromOfferingName(offering);
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

function userExplicitlyProvidedCourseNumber(message: string): boolean {
  return (
    /\b(?:[A-Z]{2}\.)?\d{3}\.\d{3}\b/i.test(message) ||
    /\b[A-Z]{2}\d{6}\b/i.test(message) ||
    /\b[A-Z]{2}\d{3}\b/i.test(message)
  );
}

type AgentStep = {
  toolCalls?: Array<{ toolName?: string; input?: unknown }>;
  toolResults: Array<{ toolName: string; output: unknown }>;
};
type AgentResponsePayload = Record<string, unknown>;

type TimeBucket = "morning" | "afternoon" | "evening";

type PreferenceConstraints = {
  preferredDays: Set<string>;
  preferredTimeBucket: TimeBucket | null;
};

type StreamStatusStage =
  | "loading_context"
  | "calling_tools"
  | "generating_response"
  | "done";
type EvalSummaryToolOutput =
  | { hasData: true; summaryText: string }
  | { hasData: false; message: string };
type SisDetailsToolOutput = { courseId?: string; course: unknown | null; message?: string };

function getLastSearchCoursesResults(steps: AgentStep[]): SearchResult[] {
  let last: SearchResult[] = [];
  for (const step of steps) {
    for (const tr of step.toolResults) {
      if (tr.toolName !== "searchCourses") continue;
      const out = tr.output as { results?: SearchResult[] } | undefined;
      if (out?.results?.length) last = out.results;
    }
  }
  return last;
}

type SisSearchToolCourse = {
  offeringName: string;
  daysOfWeek: string;
  timeOfDay: string;
};

function getLastSisConstraintSearchCourses(steps: AgentStep[]): SisSearchToolCourse[] {
  let last: SisSearchToolCourse[] = [];
  for (const step of steps) {
    for (const tr of step.toolResults) {
      if (tr.toolName !== "searchCourses") continue;
      if (!tr.output || typeof tr.output !== "object") continue;
      const out = tr.output as { results?: unknown[] };
      if (!Array.isArray(out.results)) continue;
      last = out.results
        .filter((course): course is Record<string, unknown> => !!course && typeof course === "object")
        .map((course) => ({
          offeringName:
            typeof course.sisOfferingName === "string"
              ? course.sisOfferingName
              : typeof course.offeringName === "string"
                ? course.offeringName
                : "",
          daysOfWeek: typeof course.daysOfWeek === "string" ? course.daysOfWeek : "",
          timeOfDay: typeof course.timeOfDay === "string" ? course.timeOfDay : "",
        }))
        .filter((course) => course.offeringName.trim() !== "");
    }
  }
  return last;
}

function getLastCourseEvalSummaryResult(steps: AgentStep[]): EvalSummaryToolOutput | null {
  let last: EvalSummaryToolOutput | null = null;
  for (const step of steps) {
    for (const tr of step.toolResults) {
      if (tr.toolName !== "getCourseEvalSummary") continue;
      if (!tr.output || typeof tr.output !== "object") continue;
      const out = tr.output as EvalSummaryToolOutput;
      if (
        (out.hasData === true && typeof out.summaryText === "string") ||
        (out.hasData === false && typeof out.message === "string")
      ) {
        last = out;
      }
    }
  }
  return last;
}

function getLastSisCourseDetailsResult(steps: AgentStep[]): SisDetailsToolOutput | null {
  let last: SisDetailsToolOutput | null = null;
  for (const step of steps) {
    for (const tr of step.toolResults) {
      if (tr.toolName !== "getSisCourseDetails") continue;
      if (!tr.output || typeof tr.output !== "object") continue;
      const out = tr.output as SisDetailsToolOutput;
      if ("course" in out) last = out;
    }
  }
  return last;
}

function getLastModifyScheduleCoursesResult(
  steps: AgentStep[],
): ModifyScheduleCoursesOutput | null {
  let last: ModifyScheduleCoursesOutput | null = null;
  for (const step of steps) {
    for (const tr of step.toolResults) {
      if (tr.toolName !== "modifyScheduleCourses") continue;
      if (!tr.output || typeof tr.output !== "object") continue;
      last = tr.output as ModifyScheduleCoursesOutput;
    }
  }
  return last;
}

const MISSING_DETAILS_MESSAGE =
  "I couldn't find current SIS details for that course. Try another result or search by the exact course code.";
const AMBIGUOUS_COURSE_REFERENCE_MESSAGE =
  "Please tell me which course you mean (course code or exact title).";
function hasUnderspecifiedCourseReference(message: string): boolean {
  if (/\b(?:[a-z]{2}\.)?\d{3}\.\d{3}\b/i.test(message)) return false;
  if (/\b(?:this|that|the)\s+schedule\b/i.test(message)) return false;
  const asksForSpecificCourseInfo =
    /\b(hard|difficulty|workload|evaluation|evals?|times?|schedule|when|where|instructor|professor|details?|tell me more|more about)\b/i.test(
      message,
    );
  const ambiguousReference = /\b(it|that|this|those|them|one)\b/i.test(message);
  return asksForSpecificCourseInfo && ambiguousReference;
}
function getConflictingConstraintMessage(message: string): string | null {
  const text = message.toLowerCase();
  const wantsMorning = /\bmorning\b|before noon|before 12/.test(text);
  const wantsEvening = /\bevening\b|\bnight\b|after 5\b|after 5pm|after 5 pm/.test(text);
  const wantsAfternoon = /\bafternoon\b|after noon/.test(text);
  const wantsEarly = /\bearly\b|before 10\b/.test(text);
  const wantsLate = /\blate\b|after 6\b|after 6pm|after 6 pm/.test(text);

  if (wantsMorning && wantsEvening) {
    return "Those time constraints conflict: a class cannot be both a morning class and after 5 PM. Pick one time window and try again.";
  }
  if ((wantsAfternoon && wantsEarly) || (wantsMorning && wantsLate)) {
    return "Those time constraints conflict. Please choose a single time window and try again.";
  }
  return null;
}

function normalizeDayToken(input: string): string | null {
  const value = input.toLowerCase();
  if (/(^|\b)(mon|monday)(\b|$)/.test(value)) return "monday";
  if (/(^|\b)(tue|tues|tuesday)(\b|$)/.test(value)) return "tuesday";
  if (/(^|\b)(wed|wednesday)(\b|$)/.test(value)) return "wednesday";
  if (/(^|\b)(thu|thur|thurs|thursday)(\b|$)/.test(value)) return "thursday";
  if (/(^|\b)(fri|friday)(\b|$)/.test(value)) return "friday";
  if (/(^|\b)(sat|saturday)(\b|$)/.test(value)) return "saturday";
  if (/(^|\b)(sun|sunday)(\b|$)/.test(value)) return "sunday";
  return null;
}

function parseDaysFromText(text: string): Set<string> {
  const dayRegex = /\b(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi;
  const out = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = dayRegex.exec(text)) !== null) {
    const normalized = normalizeDayToken(match[1]);
    if (normalized) out.add(normalized);
  }
  return out;
}

function parseTimeBucketFromText(text: string): TimeBucket | null {
  const lower = text.toLowerCase();
  if (/\bmorning\b|before\s+noon|before\s+12|before\s+11/.test(lower)) return "morning";
  if (/\bafternoon\b|after\s+noon|after\s+12/.test(lower)) return "afternoon";
  if (/\bevening\b|\bnight\b|after\s+5|after\s+6|after\s+7/.test(lower)) return "evening";
  return null;
}

function extractPreferenceConstraints(userMessage: string): PreferenceConstraints {
  return {
    preferredDays: parseDaysFromText(userMessage),
    preferredTimeBucket: parseTimeBucketFromText(userMessage),
  };
}

function extractCourseDays(row: Record<string, unknown>): Set<string> {
  const source =
    (typeof row.daysOfWeek === "string" && row.daysOfWeek) ||
    (typeof row.meetingDays === "string" && row.meetingDays) ||
    "";
  return parseDaysFromText(source);
}

function extractCourseTimeBucket(row: Record<string, unknown>): TimeBucket | null {
  const source =
    (typeof row.timeOfDay === "string" && row.timeOfDay) ||
    (typeof row.meetingTime === "string" && row.meetingTime) ||
    "";
  if (!source) return null;
  return parseTimeBucketFromText(source);
}

function hasIntersection(a: Set<string>, b: Set<string>): boolean {
  for (const value of a) {
    if (b.has(value)) return true;
  }
  return false;
}

function normalizedCourseCodeKey(code: string): string {
  return code.trim().toLowerCase().replace(/^[a-z]{2}\./, "");
}

function mergeSisMeetingFieldsWithToolRows(
  modelResults: unknown[],
  sisToolRows: SisSearchToolCourse[],
): unknown[] {
  if (!modelResults.length || !sisToolRows.length) return modelResults;
  const byOffering = new Map<string, SisSearchToolCourse>();
  const byCode = new Map<string, SisSearchToolCourse>();
  const byNormalizedCode = new Map<string, SisSearchToolCourse[]>();
  for (const row of sisToolRows) {
    byOffering.set(row.offeringName.toLowerCase(), row);
    const fullCode = catalogCourseCodeFromOfferingName(row.offeringName).toLowerCase();
    const normalizedCode = normalizedCourseCodeKey(fullCode);
    if (fullCode) byCode.set(fullCode, row);
    if (normalizedCode) {
      const existing = byNormalizedCode.get(normalizedCode) ?? [];
      byNormalizedCode.set(normalizedCode, [...existing, row]);
    }
  }

  return modelResults.map((result) => {
    if (!result || typeof result !== "object") return result;
    const row = result as Record<string, unknown>;
    const sisOfferingName =
      typeof row.sisOfferingName === "string"
        ? row.sisOfferingName
        : typeof row.offeringName === "string"
          ? row.offeringName
          : "";
    const code = typeof row.code === "string" ? row.code.toLowerCase() : "";
    const normalizedCode = code ? normalizedCourseCodeKey(code) : "";
    const normalizedCandidates = normalizedCode
      ? (byNormalizedCode.get(normalizedCode) ?? [])
      : [];
    const uniqueNormalizedMatch = normalizedCandidates.length === 1
      ? normalizedCandidates[0]
      : undefined;
    const toolRow =
      (sisOfferingName ? byOffering.get(sisOfferingName.toLowerCase()) : undefined) ??
      (code ? byCode.get(code) : undefined) ??
      uniqueNormalizedMatch;
    if (!toolRow) return result;

    const patch: Record<string, unknown> = {};
    if ((!row.daysOfWeek || row.daysOfWeek === "") && toolRow.daysOfWeek) {
      patch.daysOfWeek = toolRow.daysOfWeek;
    }
    if ((!row.timeOfDay || row.timeOfDay === "") && toolRow.timeOfDay) {
      patch.timeOfDay = toolRow.timeOfDay;
    }
    return Object.keys(patch).length > 0 ? { ...row, ...patch } : result;
  });
}

function applyDeterministicPreferenceCompliance(
  modelResults: unknown[],
  userMessage: string,
): unknown[] {
  const constraints = extractPreferenceConstraints(userMessage);
  const hasDayPreference = constraints.preferredDays.size > 0;
  const hasTimePreference = constraints.preferredTimeBucket !== null;
  if (!hasDayPreference && !hasTimePreference) return modelResults;

  return modelResults.map((result) => {
    if (!result || typeof result !== "object") return result;
    const row = result as Record<string, unknown>;
    const courseDays = extractCourseDays(row);
    const courseTimeBucket = extractCourseTimeBucket(row);

    const cannotEvaluateDays = hasDayPreference && courseDays.size === 0;
    const cannotEvaluateTime = hasTimePreference && courseTimeBucket === null;
    if (cannotEvaluateDays || cannotEvaluateTime) {
      return row;
    }

    const dayMismatch =
      hasDayPreference && courseDays.size > 0 && !hasIntersection(constraints.preferredDays, courseDays);
    const timeMismatch =
      hasTimePreference && courseTimeBucket !== null && courseTimeBucket !== constraints.preferredTimeBucket;

    if (!dayMismatch && !timeMismatch) {
      return {
        ...row,
        preferenceAlignment: "aligned",
      };
    }

    return {
      ...row,
      preferenceAlignment: "mismatch",
      preferenceMismatchReasons: [
        ...(dayMismatch ? ["days"] : []),
        ...(timeMismatch ? ["time_window"] : []),
      ],
    };
  });
}

function buildNoResultsMessage(message: string): string {
  const labels = [
    /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(message)
      ? "day filters"
      : null,
    /\b(?:morning|afternoon|evening|before noon|after 5|after 6|early|late)\b/i.test(message)
      ? "time window"
      : null,
    /\b(?:krieger|ksas|whiting|wse)\b/i.test(message) ? "school" : null,
    /\b(?:taught by|professor|instructor)\b/i.test(message) ? "instructor" : null,
    /\b(?:only|exactly|must|strictly)\b/i.test(message) ? "strict filters" : null,
  ].filter(Boolean) as string[];

  if (labels.length >= 2) {
    return `I couldn't find any courses matching all of those constraints. Try relaxing one filter, such as ${labels[0]} or ${labels[1]}.`;
  }

  return NO_RESULTS_FALLBACK_MESSAGE;
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
    credits: t.credits,
    rank: t.rank,
    relevanceScore: t.relevanceScore,
    matchType: t.matchType,
    schoolName: t.schoolName,
    department: t.department,
    level: t.level,
    timeOfDay: t.timeOfDay,
    daysOfWeek: t.daysOfWeek,
    instructors: t.instructors,
    writingIntensive: t.writingIntensive,
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
      credits: c.credits ?? r.credits,
      rank: c.rank ?? r.rank,
      relevanceScore: c.relevanceScore ?? r.relevanceScore,
      matchType: c.matchType ?? r.matchType,
      schoolName: c.schoolName ?? r.schoolName,
      department: c.department ?? r.department,
      level: c.level ?? r.level,
      timeOfDay: c.timeOfDay ?? r.timeOfDay,
      daysOfWeek: c.daysOfWeek ?? r.daysOfWeek,
      instructors: c.instructors ?? r.instructors,
      writingIntensive: c.writingIntensive ?? r.writingIntensive,
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

function writeSseEvent(
  res: Response,
  event: "status" | "text_chunk" | "final" | "error",
  data: Record<string, unknown>,
) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function initializeSse(res: Response) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

function extractPartialJsonStringField(text: string, key: string): string | null {
  const keyIndex = text.indexOf(`"${key}"`);
  if (keyIndex < 0) return null;

  const colonIndex = text.indexOf(":", keyIndex);
  if (colonIndex < 0) return null;

  let valueStart = colonIndex + 1;
  while (valueStart < text.length && /\s/.test(text[valueStart])) {
    valueStart += 1;
  }

  if (text[valueStart] !== '"') return null;

  let i = valueStart + 1;
  let output = "";

  while (i < text.length) {
    const char = text[i];

    if (char === '"') {
      return output;
    }

    if (char !== "\\") {
      output += char;
      i += 1;
      continue;
    }

    const escaped = text[i + 1];
    if (escaped == null) return output;

    switch (escaped) {
      case '"':
      case "\\":
      case "/":
        output += escaped;
        i += 2;
        break;
      case "b":
        output += "\b";
        i += 2;
        break;
      case "f":
        output += "\f";
        i += 2;
        break;
      case "n":
        output += "\n";
        i += 2;
        break;
      case "r":
        output += "\r";
        i += 2;
        break;
      case "t":
        output += "\t";
        i += 2;
        break;
      case "u": {
        const hex = text.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return output;
        output += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        break;
      }
      default:
        output += escaped;
        i += 2;
        break;
    }
  }

  return output;
}

function extractDisplayTextFromPartialAgentOutput(text: string): string {
  return (
    extractPartialJsonStringField(text, "message") ??
    extractPartialJsonStringField(text, "summaryText") ??
    ""
  );
}

function getDisplayTextFromFinalPayload(payload: AgentResponsePayload): string {
  if (typeof payload.message === "string" && payload.message.trim() !== "") {
    return payload.message;
  }
  if (typeof payload.summaryText === "string" && payload.summaryText.trim() !== "") {
    return payload.summaryText;
  }
  if (payload.type === "search" && Array.isArray(payload.results)) {
    return payload.results.length > 0
      ? "Here are some courses I found:"
      : NO_RESULTS_FALLBACK_MESSAGE;
  }
  if (payload.type === "details" && payload.course && typeof payload.course === "object") {
    const course = payload.course as Record<string, unknown>;
    const title =
      typeof course.title === "string" && course.title.trim() !== ""
        ? course.title
        : typeof course.offeringName === "string"
          ? course.offeringName
          : "";
    return title || "No details found.";
  }
  if (typeof payload.error === "string" && payload.error.trim() !== "") {
    return payload.error;
  }
  return "";
}

function hasStringMessage(
  value: unknown,
): value is Record<string, unknown> & { message: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

async function normalizeAgentResponse(
  text: string,
  steps: AgentStep[],
  userMessage: string,
  deterministicIntent: ReturnType<typeof detectScheduleModificationIntent> | null,
): Promise<AgentResponsePayload> {
  let parsed: unknown;
  try {
    parsed = parseAgentOutputText(text);
  } catch {
    parsed = { type: "text", message: text };
  }

  const evalSummaryResult = getLastCourseEvalSummaryResult(steps);
  if (evalSummaryResult) {
    if (evalSummaryResult.hasData === false) {
      parsed = {
        type: "summary",
        hasData: false,
        summaryText: evalSummaryResult.message,
      };
    } else if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { type?: string }).type !== "summary" ||
      typeof (parsed as { summaryText?: string }).summaryText !== "string" ||
      (parsed as { summaryText: string }).summaryText.trim() === ""
    ) {
      parsed = {
        type: "summary",
        hasData: true,
        summaryText: evalSummaryResult.summaryText,
      };
    }
  }

  const sisDetailsResult = getLastSisCourseDetailsResult(steps);
  if (sisDetailsResult?.course === null) {
    parsed = {
      type: "text",
      message: sisDetailsResult.message ?? MISSING_DETAILS_MESSAGE,
    };
  } else if (
    sisDetailsResult?.course &&
    (typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { type?: string }).type !== "details" ||
      !("course" in (parsed as Record<string, unknown>)))
  ) {
    parsed = {
      type: "details",
      course: sisDetailsResult.course,
    };
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as { type?: string }).type === "search" &&
    Array.isArray((parsed as { results?: unknown }).results)
  ) {
    const toolSearchRows = getLastSearchCoursesResults(steps);
    const sisConstraintRows = getLastSisConstraintSearchCourses(steps);
    if (toolSearchRows.length > 0) {
      (parsed as { results: unknown[] }).results = dropSemanticRowsWithoutMatchExplanation(
        mergeSearchResultsWithToolRows(
          (parsed as { results: unknown[] }).results,
          toolSearchRows,
        ),
      );
    }
    if (sisConstraintRows.length > 0) {
      (parsed as { results: unknown[] }).results = mergeSisMeetingFieldsWithToolRows(
        (parsed as { results: unknown[] }).results,
        sisConstraintRows,
      );
    }
    const resultsForTerm = (parsed as { results: unknown[] }).results;
    const termFromRow = resultsForTerm.find(
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
    (parsed as { results: unknown[] }).results = await enrichMissingDescriptions(
      (parsed as { results: unknown[] }).results,
    );
    (parsed as { results: unknown[] }).results = applyDeterministicConstraintAlignment(
      (parsed as { results: unknown[] }).results,
      userMessage,
      steps,
    );
    (parsed as { results: unknown[] }).results = applyDeterministicPreferenceCompliance(
      (parsed as { results: unknown[] }).results,
      userMessage,
    );
    (parsed as { results: unknown[] }).results = appendMismatchNotes(
      (parsed as { results: unknown[] }).results,
    );
    (parsed as { results: unknown[] }).results = applyDeterministicSearchRanking(
      (parsed as { results: unknown[] }).results,
    );
  }

  if (deterministicIntent?.isScheduleModification) {
    const modifyResult = getLastModifyScheduleCoursesResult(steps);
    if (modifyResult) {
      const primaryFailure = modifyResult.failed[0];
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        (parsed as { type?: string }).type !== "text"
      ) {
        parsed = { type: "text", message: "" };
      }

      (parsed as { type: string; message: string }).type = "text";
      if (modifyResult.needsClarification) {
        (parsed as { type: string; message: string }).message =
          primaryFailure?.message ??
          "Please clarify which courses you want to add or drop.";
      } else if (!hasStringMessage(parsed) || parsed.message.trim() === "") {
        (parsed as { message: string }).message = `I interpreted that as a ${deterministicIntent.operation} request.`;
      }

      (parsed as Record<string, unknown>).scheduleChanges = {
        operation: deterministicIntent.operation,
        added: modifyResult.added,
        removed: modifyResult.removed,
        failed: modifyResult.failed,
      };
    }
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "type" in parsed &&
    (parsed as { type?: string }).type === "search"
  ) {
    const results = (parsed as { results?: unknown }).results;
    if (!Array.isArray(results) || results.length === 0) {
      const specificMessage =
        hasStringMessage(parsed) && parsed.message.trim() !== ""
          ? parsed.message
          : undefined;
      parsed = {
        type: "search",
        results: [],
        message: specificMessage ?? buildNoResultsMessage(userMessage),
      };
    }
  }

  if (
    hasStringMessage(parsed) &&
    parsed.message.trim() === ""
  ) {
    parsed.message = NO_RESULTS_FALLBACK_MESSAGE;
  }

  return parsed as AgentResponsePayload;
}

const BASE_SYSTEM_PROMPT = `You are Atlas, a JHU course advisor assistant. You help JHU undergraduates find and explore undergraduate courses.

SCOPE RESTRICTION: Atlas only covers undergraduate courses (Lower Level and Upper Level Undergraduate). If the user asks for graduate-level courses, 600-level courses, PhD courses, or anything explicitly described as "graduate", respond with { "type": "text", "message": "I can only help with undergraduate course planning at JHU. Graduate-level courses are outside my scope." } and do not call tools.

You have five tools. Call each tool at most twice per request. After receiving tool results, return your final answer.

TOOLS:
1. searchCourses
   Unified retrieval tool for both semantic and structured search.
   Inputs may include:
   - query (semantic topic text)
   - structured SIS filters: Term, School, Level, Department, Credits, TimeOfDay, WritingIntensive, CourseTitle, CourseNumber, Instructor
   - optional day filters: days + dayMatchType (encoded internally by backend)
   - limit
   Rules:
   - For full course code queries (e.g. EN.601.226), ALWAYS set CourseNumber to the full code.
   - For instructor filtering, use last name when possible.
   - For exploratory topic requests, include query.
   - For strict constraints, include only user-requested constraints.
   - Do not invent constraints the user did not ask for.
   - Prefer one high-quality call to searchCourses over multiple weak calls.

2. getCourseEvalSummary
   Get evaluation summary for a specific courseId from search results.

3. queryCourseMetrics
   Get numeric workload/difficulty/quality metrics by { courseCode, term }.
   Prefer this tool over getCourseEvalSummary when user explicitly asks for numeric workload/difficulty/quality.

4. getSisCourseDetails
   Get full SIS details (schedule, instructor, location) for a specific courseId.

5. modifyScheduleCourses
   Schedule-edit classification/validation tool when schedule context is active.

GLOBAL DISAMBIGUATION RULE:
- If multiple plausible courses match and a specific course is required for the next step, return { "type": "search", "results": [...] } with top matches so the UI can render course cards and the user can select one.

TOOL SELECTION EXAMPLES:
- Query: "What is EN.601.226?"
  Tool call: searchCourses with CourseNumber="EN.601.226".
  Output: type "search" with returned rows.

- Query: "courses taught by madooei"
  Tool call: searchCourses with Instructor="Madooei".
  Output: type "search" with returned rows.

- Query: "data structs" / "linear algebra"
  Tool call: searchCourses with CourseTitle set to phrase. 
  Output: type "search" with returned rows.

- Query: "WSE classes on Wednesday"
  Tool call: searchCourses with School="Whiting School of Engineering", days=["Wednesday"], dayMatchType="any".
  Output: type "search" with returned rows.

- Query: "data science classes on Mondays and Wednesdays"
  Tool call: searchCourses with query="data science", days=["Monday", "Wednesday"], dayMatchType="any".
  Output: type "search" with returned rows.

- Query: "what times is data structures offered"
  Tool call: searchCourses first to identify exact course, then getSisCourseDetails for selected courseId.
  Output: type "search" when ambiguous, otherwise type "details".

- Query: "how hard is intro to fiction and poetry"
  Tool call: searchCourses with CourseTitle="intro to fiction and poetry" (or query if title confidence is low).
  If one clear match: call getCourseEvalSummary with that courseId and return type "summary".
  If multiple plausible matches: return type "search" first (global disambiguation rule).

- Query: "show me details for data structures"
  Tool call: searchCourses with CourseTitle="data structures".
  If multiple results across schools/terms/sections: return type "search" and ask user to pick one.
  Only call getSisCourseDetails after user-selected specific course.

- Query: "courses like machine learning but only in KSAS"
  Tool call: searchCourses with query="machine learning", School="Krieger School of Arts and Sciences".
  Output: type "search".

OUTPUT FORMAT (STRICT, MUST FOLLOW):
- If you are showing any specific courses (recommendations, examples, candidates, search results, or anything user could add), you MUST return:
  { "type": "search", "results": [...] }
- NEVER return course listings in { "type": "text", "message": "..." }.
- After calling searchCourses, if any course rows are being presented, final output MUST be type "search".
- Use type "text" only when not presenting course rows (clarification, non-course guidance, out-of-scope, errors).
- Return ONLY valid JSON; no markdown and no prose outside JSON.

Search rows:
- Preserve tool-provided fields (courseId, sisOfferingName, code, title, description, term, credits, rank, relevanceScore, matchType, clearlyMatches, matchExplanation, plus any additive fields).
- If clearlyMatches is false and you keep the row, include a non-empty matchExplanation.
- Do not add matchExplanation when clearlyMatches is true.

Summary: { "type": "summary", "courseId": "...", "summaryText": "...", "hasData": true|false }
Details: { "type": "details", "course": <course object or null> }
Plain text: { "type": "text", "message": "..." }`;

// ─── Agent route ──────────────────────────────────────────────────────────────

router.post("/", async (req: Request, res: Response) => {
  const {
    message,
    scheduleId: scheduleIdRaw,
    stream: streamRaw,
  } = req.body as {
    message?: string;
    scheduleId?: unknown;
    stream?: boolean;
  };

  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const shouldStream = streamRaw !== false;
  const scheduleId =
    typeof scheduleIdRaw === "string" && scheduleIdRaw.trim() !== ""
      ? scheduleIdRaw.trim()
      : undefined;

  const abortController = new AbortController();
  let assistantMessagePersisted = false;

  res.on("close", () => {
    if (!res.writableEnded) {
      console.log("[Agent] client disconnected — aborting agent request");
      abortController.abort();
    }
  });

  const emitError = (messageText: string) => {
    if (shouldStream) {
      writeSseEvent(res, "error", { error: messageText });
      res.end();
      return;
    }
    res.status(500).json({
      type: "error",
      error: messageText,
    });
  };

  const logStepFinish = (step: {
    finishReason?: unknown;
    toolCalls?: Array<{ toolName: string; input: unknown }>;
    toolResults?: Array<{ toolName?: string; output?: unknown; result?: unknown }>;
  }) => {
    const names = step.toolCalls?.map((t) => t.toolName).join(",") ?? "none";
    console.log(`[Agent] step finishReason=${String(step.finishReason ?? "unknown")} toolCalls=${names}`);
    step.toolCalls?.forEach((t) => {
      console.log(`[Agent]   → ${t.toolName} input:`, JSON.stringify(t.input));
    });
    step.toolResults?.forEach((r) => {
      const toolName = r.toolName ?? "unknown";
      const output = r.output ?? r.result ?? null;
      const isSearchTool =
        toolName.toLowerCase().includes("search") ||
        toolName === "searchCourses";
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
  };
 
  try {
    if (scheduleId && !req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    let lastStage: StreamStatusStage | null = null;
    const emitStatus = (stage: StreamStatusStage) => {
      if (!shouldStream || res.writableEnded || lastStage === stage) return;
      lastStage = stage;
      writeSseEvent(res, "status", { stage });
    };

    if (shouldStream) {
      initializeSse(res);
      emitStatus("loading_context");
    }

    let scheduleContextAppend = "";
    if (scheduleId && req.user) {
      const loaded = await loadScheduleContextForAgent(req.user.id, scheduleId);
      if (!loaded.ok) {
        if (shouldStream) {
          writeSseEvent(res, "error", {
            error: loaded.error === "forbidden" ? "Forbidden" : "Schedule not found",
          });
          res.end();
          return;
        }
        res
          .status(loaded.error === "forbidden" ? 403 : 404)
          .json({ error: loaded.error === "forbidden" ? "Forbidden" : "Schedule not found" });
        return;
      }
      scheduleContextAppend = buildScheduleContextBlock(loaded.context);
    }

    /** Home / non-schedule chat: inject same canonical memories as schedule-aware mode (no duplicate when scheduleId is set). */
    let userMemoriesAppend = "";
    if (req.user && !scheduleId) {
      try {
        const memCtx = await loadUserMemoryContextForAgent(req.user.id);
        userMemoriesAppend = buildUserMemoriesOnlyBlock(memCtx);
      } catch (err) {
        console.error("[Agent] failed to load user memories for prompt:", err);
      }
    }

    let chatState: ChatStateRow | null = null;
    let chatHistoryAppend = "";
    let userChatRow: ChatMessageRow | null = null;
    const persistUserMessage = async () => {
      if (!scheduleId || !req.user || chatState) return;
      chatState = await getOrCreateChatState(pool, scheduleId, req.user.id);

      // Load prior history before persisting the current user message so the
      // current turn is not included in the context block sent to the LLM.
      // Gracefully falls back to stateless if retrieval fails.
      try {
        const recentMessages = await loadRecentMessages(pool, chatState.id);
        chatHistoryAppend = formatChatHistoryBlock(chatState.rolling_summary, recentMessages);
      } catch (err) {
        console.error("[Agent] failed to load chat history, continuing stateless:", err);
      }

      userChatRow = await persistMessage(pool, {
        chatStateId: chatState.id,
        scheduleId,
        role: "user",
        content: message,
        metadata: {},
      });
    };
    const persistAssistantMessage = async (
      payload: AgentResponsePayload,
      metadata: Record<string, unknown> = {},
    ) => {
      if (!scheduleId || !req.user || !chatState || assistantMessagePersisted) return;
      assistantMessagePersisted = true;
      await persistMessage(pool, {
        chatStateId: chatState.id,
        scheduleId,
        role: "assistant",
        content: getDisplayTextFromFinalPayload(payload),
        responseType: typeof payload.type === "string" ? payload.type : undefined,
        metadata,
      });
      enforceRetentionPolicy(pool, chatState.id).catch((err) =>
        console.error("[Agent] enforceRetentionPolicy failed:", err),
      );
    };

    const triggerChatMemoryExtraction = () => {
      if (!userChatRow || !req.user) return;
      void runChatMemoryExtraction({
        pool,
        appUserId: req.user.id,
        userMessage: message,
        userMessageId: userChatRow.id,
      }).catch((err) => console.error("[Agent] chat memory extraction failed:", err));
    };

    const inScope = await isQueryInProductScope(message);
    const deterministicIntent = scheduleId ? detectScheduleModificationIntent(message) : null;
    await persistUserMessage();

    const conflictingConstraintMessage = getConflictingConstraintMessage(message);
    if (conflictingConstraintMessage) {
      const payload = {
        type: "text",
        message: conflictingConstraintMessage,
      } satisfies AgentResponsePayload;

      await persistAssistantMessage(payload, payload);
      triggerChatMemoryExtraction();

      if (shouldStream) {
        emitStatus("done");
        writeSseEvent(res, "final", { stage: "done", response: payload });
        res.end();
        return;
      }

      res.json(payload);
      return;
    }

    if (!inScope) {
      const payload = {
        type: "text",
        message: OUT_OF_SCOPE_REDIRECT_MESSAGE,
      } satisfies AgentResponsePayload;

      await persistAssistantMessage(payload, payload);
      triggerChatMemoryExtraction();

      if (shouldStream) {
        emitStatus("done");
        writeSseEvent(res, "final", { stage: "done", response: payload });
        res.end();
        return;
      }

      res.json(payload);
      return;
    }

    if (scheduleId && req.user) {
      const editResult = await handleScheduleEditMessage({
        userId: req.user.id,
        scheduleId,
        message,
      });
      console.log(
        "[Agent] schedule-edit intercept",
        JSON.stringify({
          scheduleId,
          handled: editResult.handled,
          payloadType: editResult.handled ? editResult.payload.type : null,
        }),
      );
      if (editResult.handled) {
        const payload = editResult.payload as AgentResponsePayload;
        await persistAssistantMessage(payload, payload);
        triggerChatMemoryExtraction();

        if (shouldStream) {
          emitStatus("done");
          writeSseEvent(res, "final", { stage: "done", response: payload });
          res.end();
          return;
        }

        res.json(payload);
        return;
      }
    }

    if (hasUnderspecifiedCourseReference(message)) {
      const payload = {
        type: "text",
        message: AMBIGUOUS_COURSE_REFERENCE_MESSAGE,
      } satisfies AgentResponsePayload;

      await persistAssistantMessage(payload, payload);
      triggerChatMemoryExtraction();

      if (shouldStream) {
        emitStatus("done");
        writeSseEvent(res, "final", { stage: "done", response: payload });
        res.end();
        return;
      }

      res.json(payload);
      return;
    }

    const systemPrompt = BASE_SYSTEM_PROMPT + scheduleContextAppend + userMemoriesAppend + chatHistoryAppend;

    const tools = {
      searchCourses: tool({
        description:
          "Unified course retrieval tool. Supports semantic query search (query) plus structured SIS filters (CourseTitle, CourseNumber, Instructor, School, Level, Department, Credits, TimeOfDay, WritingIntensive). Use this as the single retrieval tool for course discovery.",
        inputSchema: z.object({
          query: z
            .string()
            .optional()
            .describe("Natural-language search query for semantic matching."),
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
          Department: z.string().optional(),
          Credits: z.string().optional(),
          TimeOfDay: z.enum(["morning", "afternoon", "evening"]).optional(),
          WritingIntensive: z.enum(["Yes", "No"]).optional(),
          CourseTitle: z
            .string()
            .optional()
            .describe("Title text (supports partial title match). Use when the user appears to refer to a specific class by title, even if abbreviated (e.g., 'data structs')."),
          CourseNumber: z
            .string()
            .optional()
            .describe("Pass the EXACT number the user said (e.g. user says '601' → pass '601', user says '501' → pass '501'). Do NOT substitute or guess a different number."),
          Instructor: z.string().optional().describe("Only if user named an instructor"),
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
            .optional()
            .describe("Optional human-readable days. Encoded internally for SIS."),
          dayMatchType: z
            .enum(["all", "any"])
            .optional()
            .describe("Optional day matching behavior (default any)."),
          limit: z
            .number()
            .int()
            .positive()
            .default(5)
            .describe("Max results to return"),
        }),
        execute: async (params) => {
          const {
            limit,
            School,
            Level,
            days,
            dayMatchType,
            ...rest
          } = params;
          const userSpecifiedSchool = userExplicitlySpecifiedSchool(message);
          const userSpecifiedLevel = userExplicitlySpecifiedUndergradLevel(message);
          const userSpecifiedCourseNumber = userExplicitlyProvidedCourseNumber(message);
          const baseParams: Record<string, unknown> = Object.fromEntries(
            Object.entries(rest).filter(([, v]) => v !== "" && v != null),
          );
          if (baseParams.CourseNumber && !userSpecifiedCourseNumber) {
            console.log(
              "[Agent] Dropping model-inferred CourseNumber because user did not provide one",
              JSON.stringify({
                inferredCourseNumber: baseParams.CourseNumber,
                message,
              }),
            );
            delete baseParams.CourseNumber;
          }

          if (Array.isArray(days) && days.length > 0) {
            baseParams.DaysOfWeek = generateDaysOfWeek({
              days,
              matchType: dayMatchType ?? "any",
            });
          }
          try {
            const unifiedParams = {
              ...baseParams,
              School:
                userSpecifiedSchool && School
                  ? [School]
                  : [...DEFAULT_SCHOOLS],
              Level:
                userSpecifiedLevel && Level
                  ? [Level]
                  : [...DEFAULT_UNDERGRAD_LEVELS],
            };
            return searchCourses({
              ...(unifiedParams as SearchCoursesInput),
              limit,
            });
          } catch (err) {
            const toolError = err instanceof Error ? err.message : String(err);
            console.error("[Agent] searchCourses failed:", toolError);
            return { results: [], error: toolError };
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

      getSisCourseDetails: tool({
        description:
          "Fetch full SIS details for a specific course offering: instructor, schedule, location, status. Use when user wants details about a specific course.",
        inputSchema: z.object({
          courseId: z
            .string()
            .describe("Course ID from search results, e.g. 'en-601-226-spring-2026'"),
        }),
        execute: async (params) => {
          return getSisCourseDetails(params.courseId);
        },
      }),

      queryCourseMetrics: tool({
        description:
          "Fetch aggregated workload, difficulty, and overall quality from course_evaluations. Tries the requested term first; if that term has no data (common for the current semester), aggregates prior offerings. Response includes evaluationsTermRange for citations and metricsSource (exact_term vs historical_offerings).",
        inputSchema: z.object({
          courseCode: z
            .string()
            .describe("Dotted course code, e.g. 'EN.601.226'"),
          term: z
            .string()
            .describe(
              "Schedule or SIS term (e.g. active schedule term). Used to prefer exact-term rows when they exist; otherwise prior-semester data is returned automatically.",
            ),
        }),
        execute: async (params) => {
          return queryCourseMetrics(params.courseCode, params.term);
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
        execute: async (params) => {
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
          if (params.scheduleId !== scheduleId) {
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
          return modifyScheduleCourses(params);
        },
      }),
    };

    if (!shouldStream) {
      const { text, steps } = await generateText({
        abortSignal: abortController.signal,
        onStepFinish: logStepFinish,
        model: openai("gpt-4o-mini"),
        system: systemPrompt,
        prompt: message,
        stopWhen: stepCountIs(3),
        tools,
      });

      const payload = await normalizeAgentResponse(
        text,
        steps as AgentStep[],
        message,
        deterministicIntent,
      );
      await persistAssistantMessage(payload, payload);
      triggerChatMemoryExtraction();
      res.json(payload);
      return;
    }

    let rawStreamedText = "";
    let emittedDisplayLength = 0;

    const streamResult = streamText({
      abortSignal: abortController.signal,
      onChunk: ({ chunk }) => {
        if (
          chunk.type === "tool-call" ||
          chunk.type === "tool-input-start" ||
          chunk.type === "tool-input-delta" ||
          chunk.type === "tool-result"
        ) {
          emitStatus("calling_tools");
          return;
        }

        if (chunk.type !== "text-delta") return;

        rawStreamedText += chunk.text;
        emitStatus("generating_response");

        const displayText = extractDisplayTextFromPartialAgentOutput(rawStreamedText);
        if (displayText.length <= emittedDisplayLength) return;

        const delta = displayText.slice(emittedDisplayLength);
        emittedDisplayLength = displayText.length;
        writeSseEvent(res, "text_chunk", { text: delta });
      },
      onStepFinish: logStepFinish,
      onAbort: async () => {
        if (!scheduleId || !req.user || !chatState || assistantMessagePersisted) return;

        const partialText = extractDisplayTextFromPartialAgentOutput(rawStreamedText).trim();
        if (partialText === "") return;

        assistantMessagePersisted = true;
        await persistMessage(pool, {
          chatStateId: chatState.id,
          scheduleId,
          role: "assistant",
          content: partialText,
          responseType: "text",
          metadata: { aborted: true },
        });
        enforceRetentionPolicy(pool, chatState.id).catch((err) =>
          console.error("[Agent] enforceRetentionPolicy failed:", err),
        );
      },
      model: openai("gpt-4o-mini"),
      system: systemPrompt,
      prompt: message,
      stopWhen: stepCountIs(3),
      tools,
    });

    const [text, steps] = await Promise.all([
      streamResult.text,
      streamResult.steps,
    ]);

    const payload = await normalizeAgentResponse(
      text,
      steps as AgentStep[],
      message,
      deterministicIntent,
    );
    const finalDisplayText = getDisplayTextFromFinalPayload(payload);

    if (finalDisplayText.length > emittedDisplayLength) {
      writeSseEvent(res, "text_chunk", {
        text: finalDisplayText.slice(emittedDisplayLength),
      });
    }

    await persistAssistantMessage(payload, payload);
    triggerChatMemoryExtraction();
    writeSseEvent(res, "status", { stage: "done" });
    writeSseEvent(res, "final", { stage: "done", response: payload });
    res.end();
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      if (shouldStream && !res.writableEnded) {
        res.end();
      }
      return;
    }

    console.error("Agent error:", err);
    emitError("Agent failed to process your request. Please try again.");
  }
});

export default router;
