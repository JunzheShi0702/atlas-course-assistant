/**
 * LLM Agent endpoint — Issue #52
 *
 * Single entry point for all query-based interactions. Out-of-scope messages
 * are answered with a fixed redirect without invoking the main agent. In-scope
 * messages go to the agent, which decides which tools to call (searchCourseDescriptions,
 * searchCoursesBySisConstraints, getCourseEvalSummary, getSisCourseDetails), and
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
import { searchCourseDescriptions } from "../tools/search-course-descriptions";
import {
  searchCoursesBySisConstraints,
} from "../tools/search-courses-by-sis-constraints";
import { getSisCourseDetails } from "../services/get-sis-course-details";
import {
  isQueryInProductScope,
  OUT_OF_SCOPE_REDIRECT_MESSAGE,
} from "../services/query-scope";
import { getCourseEvalSummary } from "../tools/get-course-eval-summary";
import { catalogCourseCodeFromOfferingName, generateDaysOfWeek } from "../types/sis";
import type { SearchCourseDescriptionsOutput, SearchResult } from "../types/search";
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

type AgentStep = { toolResults: Array<{ toolName: string; output: unknown }> };
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

type SisSearchToolCourse = {
  offeringName: string;
  daysOfWeek: string;
  timeOfDay: string;
};

function getLastSisConstraintSearchCourses(steps: AgentStep[]): SisSearchToolCourse[] {
  let last: SisSearchToolCourse[] = [];
  for (const step of steps) {
    for (const tr of step.toolResults) {
      if (tr.toolName !== "searchCoursesBySisConstraints") continue;
      if (!tr.output || typeof tr.output !== "object") continue;
      const out = tr.output as { courses?: unknown[] };
      if (!Array.isArray(out.courses)) continue;
      last = out.courses
        .filter((course): course is Record<string, unknown> => !!course && typeof course === "object")
        .map((course) => ({
          offeringName: typeof course.offeringName === "string" ? course.offeringName : "",
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

    const mismatchLabel = dayMismatch && timeMismatch
      ? "conflicts with preferred days and preferred time window"
      : dayMismatch
        ? "conflicts with preferred days"
        : "conflicts with preferred time window";
    const mismatchText = `Preference mismatch: ${mismatchLabel}.`;
    const existingExplanation =
      typeof row.matchExplanation === "string" ? row.matchExplanation.trim() : "";
    const matchExplanation = existingExplanation
      ? `${existingExplanation} ${mismatchText}`
      : mismatchText;

    return {
      ...row,
      preferenceAlignment: "mismatch",
      preferenceMismatchReasons: [
        ...(dayMismatch ? ["days"] : []),
        ...(timeMismatch ? ["time_window"] : []),
      ],
      matchExplanation,
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
    const toolSearchRows = getLastSearchCourseDescriptionsResults(steps);
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
    (parsed as { results: unknown[] }).results = applyDeterministicPreferenceCompliance(
      (parsed as { results: unknown[] }).results,
      userMessage,
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

SCOPE RESTRICTION: Atlas only covers undergraduate courses (Lower Level and Upper Level Undergraduate). If the user asks for graduate-level courses, 600-level courses, PhD courses, or anything explicitly described as "graduate", respond with { "type": "text", "message": "I can only help with undergraduate course planning at JHU. Graduate-level courses are outside my scope." } and do not call any tools.

You have six tools. Call each tool at most twice per request. After receiving tool results, return your final answer.

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
   - STOP RULE: If searchCoursesBySisConstraints returns 1 or more courses, you MUST return those results immediately as type="search". Do NOT call searchCourseDescriptions or getSisCourseDetails afterward. A missing description or no matchExplanation is normal for SIS-only results — still return the card.

4. getCourseEvalSummary
   Get evaluation summary for a specific courseId (from search results).

5. getSisCourseDetails
   Get full SIS details (schedule, instructor, location) for a specific courseId.

6. modifyScheduleCourses
   Use only when schedule context is active and the user asks to add, drop, or replace courses on that schedule.
   In this phase, this tool performs classification/validation only and does not apply mutations.
   Input:
   - scheduleId
   - operation ("add" | "drop" | "replace")
   - addCourses[] / dropCourses[] entries with { courseCode, sisOfferingName, term, courseTitle?, credits? }
   If tool output has needsClarification=true, return type="text" with a direct clarification question.

TOOL SELECTION EXAMPLES:
Global disambiguation rule:
- If multiple plausible courses match and a specific course is required for the next step, return type="search" with top matches so the UI can render course cards and the user can select one.

- Query: exact course codes in format EN.XXX.XXX or AS.XXX.XXX, like "EN.601.225", "What is EN.601.225?", "Tell me about EN.553.291"
  Intent: exact lookup by code.
  Tool sequence: SINGLE call to searchCoursesBySisConstraints with CourseNumber=the full code. Do NOT set School or Level. STOP after this one call — do NOT then call searchCourseDescriptions or getSisCourseDetails.
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
  Tool sequence: identify candidates via searchCoursesBySisConstraints with CourseTitle="data structures" (or searchCourseDescriptions if needed), then getSisCourseDetails after selection.
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
Details: { "type": "details", "course": <the course object from getSisCourseDetails when present, same camelCase fields as the tool (offeringName, sectionName, title, description, schoolName, department, level, timeOfDay, daysOfWeek, location, instructors, status); use null if the tool returned course null> }
Plain text: { "type": "text", "message": "..." } — only when not showing courses; never use this to duplicate or replace a search results payload.`;

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

      await persistAssistantMessage(payload);
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

      await persistAssistantMessage(payload);
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

      await persistAssistantMessage(payload);
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

    const systemPrompt =
      BASE_SYSTEM_PROMPT + scheduleContextAppend + userMemoriesAppend + chatHistoryAppend;

    const tools = {
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
          const userSpecifiedCourseNumber = userExplicitlyProvidedCourseNumber(message);
          const baseSisParams: Record<string, unknown> = Object.fromEntries(
            Object.entries(rest).filter(([, v]) => v !== "" && v != null),
          );
          if (baseSisParams.CourseNumber && !userSpecifiedCourseNumber) {
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
              School:
                userSpecifiedSchool && School
                  ? [School]
                  : [...DEFAULT_SCHOOLS],
              Level:
                userSpecifiedLevel && Level
                  ? [Level]
                  : [...DEFAULT_UNDERGRAD_LEVELS],
            };
            const result = await searchCoursesBySisConstraints(singleCallParams, limit);
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
      await persistAssistantMessage(payload);
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

    await persistAssistantMessage(payload);
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
