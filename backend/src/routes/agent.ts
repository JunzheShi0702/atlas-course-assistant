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
import { generateText, streamText, stepCountIs } from "ai";
import {
  buildQueryCourseMetricsNoDataMessage,
  clampCourseMetricsTermToAllowedWindow,
  queryCourseMetrics,
  type QueryCourseMetricsResult,
} from "../tools/query-course-metrics";
import {
  isQueryInProductScope,
  OUT_OF_SCOPE_REDIRECT_MESSAGE,
} from "../services/query-scope";
import { catalogCourseCodeFromOfferingName } from "../types/sis";
import type { SearchCourseDescriptionsOutput, SearchResult } from "../types/search";
import {
  loadScheduleContextForAgent,
  buildScheduleContextBlock,
  loadUserMemoryContextForAgent,
  buildUserMemoriesOnlyBlock,
  type CanonicalMemoryRow,
  type ScheduleCourseRow,
} from "../services/schedule-context";
import {
  getOrCreateChatState,
  getPendingClarificationState,
  persistMessage,
  resolvePendingClarificationState,
  upsertPendingClarificationState,
  enforceRetentionPolicy,
  loadRecentMessages,
  formatChatHistoryBlock,
  type ChatStateRow,
  type ChatMessageRow,
} from "../services/chat-persistence";
import { runChatMemoryExtraction } from "../services/chat-memory-extraction";
import { runResponseEvaluation } from "../services/response-evaluation";
import { pool } from "../pool";
import { detectScheduleModificationIntent } from "../services/schedule-modification-intent";
import type { ModifyScheduleCoursesOutput } from "../tools/modify-schedule-courses";
import { handleScheduleEditMessage } from "../services/schedule-edit-orchestrator";
import { offeringNameToCourseId } from "../services/course-id";
import { parseDaysFromText, parseTimeBucketFromText, type TimeBucket } from "../services/course-preference-parsing";
import {
  buildClarificationPayload,
  extractPendingClarificationFromPayload,
  isAmbiguousClarificationPayload,
  normalizeClarificationOptions,
  normalizePendingChoices,
} from "../services/clarification-utils";
import type { RmpProfessorResult } from "../tools/search-rate-my-professor";
import type { RedditThread } from "../tools/search-reddit-for-course";
import { handleCustomScheduleEventMessage } from "../services/custom-schedule-event-orchestrator";
import { containsInappropriateSourceText } from "../services/source-safety-blocklist";
import {
  enforceAiRateLimit,
  enforceDailySpendCap,
  enforcePromptInjectionPolicy,
} from "../services/ai-safeguards";
import { writeAiCallLog } from "../services/ai-observability";
import { toDatabaseUserId } from "../middleware/auth";
import { userExplicitlyProvidedCourseNumber } from "../lib/search-text";
import { BASE_SYSTEM_PROMPT } from "./agent-prompts";
import { parseAgentOutputText } from "./agent-parse-output";
import {
  userExplicitlyRequestedGraduateScope,
  isNumericCourseMetricsIntent,
} from "./agent-user-intent";
import {
  createAgentTools,
  type SisSearchToolCourseRow,
  type QueryCourseMetricsToolOutput,
} from "./agent-tools";

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
function buildQueryCourseMetricsResponseText(metricsResult: QueryCourseMetricsResult): string {
  if (!metricsResult.metrics) {
    return buildQueryCourseMetricsNoDataMessage(
      metricsResult.courseCode,
      metricsResult.scope === "term-specific" ? metricsResult.term : undefined,
    );
  }

  const scopeText = metricsResult.scope === "cross-term" ? "across all terms" : `for ${metricsResult.term}`;
  const workload =
    typeof metricsResult.metrics.workload === "number"
      ? metricsResult.metrics.workload.toFixed(2)
      : "N/A";
  const difficulty =
    typeof metricsResult.metrics.difficulty === "number"
      ? metricsResult.metrics.difficulty.toFixed(2)
      : "N/A";
  const overallQuality =
    typeof metricsResult.metrics.overallQuality === "number"
      ? metricsResult.metrics.overallQuality.toFixed(2)
      : "N/A";
  const rangeText =
    typeof metricsResult.evaluationsTermRange === "string"
    && metricsResult.evaluationsTermRange.trim() !== ""
      ? ` Evaluation terms: ${metricsResult.evaluationsTermRange}.`
      : "";

  return `${metricsResult.courseCode} (${scopeText}) has workload ${workload}, difficulty ${difficulty}, and overall quality ${overallQuality}. Respondents: ${metricsResult.metrics.respondentCount}.${rangeText}`;
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

const NO_RESULTS_FALLBACK_MESSAGE =
  "I didn’t find any courses matching those criteria. Try relaxing filters or searching for different keywords.";
const GRAD_SCOPE_REFUSAL_MESSAGE =
  "I can only help with undergraduate course planning at JHU. Graduate-level courses are outside my scope.";

type AgentStep = { toolResults: Array<{ toolName: string; output: unknown }> };
type AgentResponsePayload = Record<string, unknown>;

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

function getLastSisConstraintSearchCourseRows(steps: AgentStep[]): SisSearchToolCourseRow[] {
  let last: SisSearchToolCourseRow[] = [];
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
            ? course.instructors.filter((i): i is string => typeof i === "string")
            : undefined,
          status: typeof course.status === "string" ? course.status : undefined,
          term: typeof course.term === "string" ? course.term : undefined,
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

function getLastQueryCourseMetricsResult(steps: AgentStep[]): QueryCourseMetricsToolOutput | null {
  let last: QueryCourseMetricsToolOutput | null = null;
  for (const step of steps) {
    for (const tr of step.toolResults) {
      if (tr.toolName !== "queryCourseMetrics") continue;
      if (!tr.output || typeof tr.output !== "object") continue;
      const out = tr.output as QueryCourseMetricsToolOutput;
      if (
        typeof out.courseCode === "string" &&
        typeof out.term === "string" &&
        (out.scope === "cross-term" || out.scope === "term-specific")
      ) {
        last = out;
      }
    }
  }
  return last;
}

function getQueryCourseMetricsResults(steps: AgentStep[]): QueryCourseMetricsToolOutput[] {
  const results: QueryCourseMetricsToolOutput[] = [];
  for (const step of steps) {
    for (const tr of step.toolResults) {
      if (tr.toolName !== "queryCourseMetrics") continue;
      if (!tr.output || typeof tr.output !== "object") continue;
      const out = tr.output as QueryCourseMetricsToolOutput;
      if (
        typeof out.courseCode === "string" &&
        typeof out.term === "string" &&
        (out.scope === "cross-term" || out.scope === "term-specific")
      ) {
        results.push(out);
      }
    }
  }
  return results;
}

function normalizeDetailsTerm(term: string | undefined): string {
  const raw = typeof term === "string" ? term.trim() : "";
  if (!raw || /^all terms$/i.test(raw)) return "Spring 2026";
  return raw;
}

function isDetailsCompatibleCourseId(courseId: string): boolean {
  return /^[a-z]{2}-\d{3}-\d{3}(?:-\d+)?-[a-z]+(?:-[a-z]+)*-\d{4}$/i.test(courseId.trim());
}

function normalizeDetailsCourseId(
  sisOfferingName: string,
  term: string,
  fallbackCourseId?: string,
): string {
  if (typeof fallbackCourseId === "string" && isDetailsCompatibleCourseId(fallbackCourseId)) {
    return fallbackCourseId;
  }
  return offeringNameToCourseId(sisOfferingName, term);
}

function sisCourseRowToSearchResult(row: SisSearchToolCourseRow, term: string): Record<string, unknown> {
  const sisOfferingName = row.offeringName;
  const code = catalogCourseCodeFromOfferingName(sisOfferingName);
  const safeTerm = normalizeDetailsTerm(term);
  return {
    courseId: normalizeDetailsCourseId(sisOfferingName, safeTerm),
    sisOfferingName,
    offeringName: sisOfferingName,
    code,
    title: row.title ?? sisOfferingName,
    description: row.description ?? "",
    term: safeTerm,
    schoolName: row.schoolName,
    department: row.department,
    level: row.level,
    timeOfDay: row.timeOfDay,
    daysOfWeek: row.daysOfWeek,
    location: row.location,
    instructors: row.instructors,
    instructor: Array.isArray(row.instructors) && row.instructors.length > 0
      ? row.instructors.join(", ")
      : undefined,
    status: row.status,
    sectionName: row.sectionName,
  };
}

function normalizeSearchText(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2)
    .filter((token) => !new Set([
      "the",
      "for",
      "course",
      "courses",
      "class",
      "classes",
      "meeting",
      "time",
      "times",
      "when",
      "where",
      "offered",
      "schedule",
      "details",
    ]).has(token));
}

function scoreCourseDetailsMatch(userMessage: string, result: SisDetailsToolOutput): number {
  if (!result.course || typeof result.course !== "object") return -1;
  const course = result.course as Record<string, unknown>;
  const title = typeof course.title === "string" ? course.title : "";
  const offeringName = typeof course.offeringName === "string" ? course.offeringName : "";
  const haystackTokens = new Set(normalizeSearchText(`${title} ${offeringName}`));
  return normalizeSearchText(userMessage).reduce(
    (score, token) => score + (haystackTokens.has(token) ? 1 : 0),
    0,
  );
}

function getBestSisCourseDetailsResult(steps: AgentStep[], userMessage: string): SisDetailsToolOutput | null {
  const results: SisDetailsToolOutput[] = [];
  for (const step of steps) {
    for (const tr of step.toolResults) {
      if (tr.toolName !== "getSisCourseDetails") continue;
      if (!tr.output || typeof tr.output !== "object") continue;
      const out = tr.output as SisDetailsToolOutput;
      if ("course" in out) results.push(out);
    }
  }
  if (results.length === 0) return null;
  return results.reduce((best, current) =>
    scoreCourseDetailsMatch(userMessage, current) >= scoreCourseDetailsMatch(userMessage, best)
      ? current
      : best,
  );
}

function isCourseDetailsIntent(message: string): boolean {
  const m = message.toLowerCase();
  if (/\b(?:when|what\s+time|meeting\s+time|meets?|where|location|room)\b/.test(m)) {
    return true;
  }
  return /\bdetails?\b/.test(m) && /\b(?:course|class|offering|section)\b/.test(m);
}

function sisCourseRowToDetailsCourse(row: SisSearchToolCourseRow): Record<string, unknown> {
  return {
    offeringName: row.offeringName,
    sectionName: row.sectionName,
    title: row.title ?? row.offeringName,
    description: row.description ?? "",
    schoolName: row.schoolName,
    department: row.department,
    level: row.level,
    timeOfDay: row.timeOfDay,
    daysOfWeek: row.daysOfWeek,
    location: row.location,
    instructors: row.instructors ?? [],
    status: row.status,
  };
}

function sanitizeSourceUrl(raw: string, allowedHost: string): string | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return null;
    if (parsed.hostname !== allowedHost && !parsed.hostname.endsWith(`.${allowedHost}`)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function getRmpResult(steps: AgentStep[]): RmpProfessorResult | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    for (const tr of steps[i].toolResults) {
      if (tr.toolName !== "searchRateMyProfessor") continue;
      const out = tr.output as { found?: boolean };
      if (out?.found === true) return out as RmpProfessorResult;
    }
  }
  return null;
}

function getRedditThreads(steps: AgentStep[]): RedditThread[] {
  for (let i = steps.length - 1; i >= 0; i--) {
    for (const tr of steps[i].toolResults) {
      if (tr.toolName !== "searchRedditForCourse") continue;
      const out = tr.output as { found?: boolean; threads?: RedditThread[] };
      if (out?.found === true && Array.isArray(out.threads)) return out.threads.slice(0, 3);
    }
  }
  return [];
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
const MAX_AMBIGUOUS_COURSE_OPTIONS = 3;
function hasUnderspecifiedCourseReference(message: string): boolean {
  if (/\b(?:[a-z]{2}\.)?\d{3}\.\d{3}\b/i.test(message)) return false;
  if (/\b(?:this|that|the)\s+schedule\b/i.test(message)) return false;
  if (
    /\b(balance|manage|plan|optimi[sz]e)\b/i.test(message) &&
    /\b(workload|course load|semester|courses)\b/i.test(message)
  ) {
    return false;
  }
  const asksForSpecificCourseInfo =
    /\b(hard|difficulty|workload|evaluation|evals?|times?|when|where|instructor|professor|details?|tell me more|more about)\b/i.test(
      message,
    );
  const ambiguousReference = /\b(?:it|that|this|those|them|one)\b/i.test(message);
  return asksForSpecificCourseInfo && ambiguousReference;
}

function getAmbiguousCourseCandidatesFromSchedule(courses: ScheduleCourseRow[] | undefined): string[] {
  if (!Array.isArray(courses) || courses.length === 0) return [];
  const seen = new Set<string>();
  const options: string[] = [];
  for (const course of courses) {
    const code = course.courseCode?.trim();
    if (!code) continue;
    const label = course.courseTitle?.trim() ? `${code} (${course.courseTitle.trim()})` : code;
    if (seen.has(label)) continue;
    seen.add(label);
    options.push(label);
    if (options.length >= MAX_AMBIGUOUS_COURSE_OPTIONS) break;
  }
  return options;
}

function buildSoftAmbiguousCourseMessage(options: string[]): string {
  if (options.length >= 2) {
    return `Do you mean ${options.join(" or ")}?`;
  }
  return AMBIGUOUS_COURSE_REFERENCE_MESSAGE;
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

const SOURCE_SAFETY_FALLBACK_MESSAGE =
  "Some source phrasing was removed for safety. I can still summarize teaching clarity, workload, and course fit from academic feedback.";

function stripLinksFromText(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi, "$1")
    .replace(/https?:\/\/[^\s)]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function buildRedactionNote(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "Note: 1 source line was redacted due to inappropriate content."
    : `Note: ${count} source lines were redacted due to inappropriate content.`;
}

async function sanitizeSourceText(
  value: string,
): Promise<{ text: string; changed: boolean; redactionCount: number }> {
  if (!containsInappropriateSourceText(value)) {
    return { text: value, changed: false, redactionCount: 0 };
  }
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trimEnd());
  let redactionCount = 0;
  const keptLines = lines.filter((line) => {
    const isUnsafe = containsInappropriateSourceText(line);
    if (isUnsafe) redactionCount += 1;
    return !isUnsafe;
  });

  const text = keptLines.join("\n").trim();
  if (!text) {
    return {
      text: SOURCE_SAFETY_FALLBACK_MESSAGE,
      changed: true,
      redactionCount: Math.max(redactionCount, 1),
    };
  }
  return {
    text,
    changed: redactionCount > 0,
    redactionCount,
  };
}

async function sanitizeFinalPayloadForSourceSafety(
  payload: AgentResponsePayload,
): Promise<{ payload: AgentResponsePayload; changed: boolean }> {
  let changed = false;
  let totalRedactions = 0;
  const nextPayload: AgentResponsePayload = { ...payload };

  if (typeof nextPayload.message === "string") {
    const sanitized = await sanitizeSourceText(nextPayload.message);
    const linkStripped = stripLinksFromText(sanitized.text);
    const linkChanged = linkStripped !== sanitized.text;
    nextPayload.message = linkStripped;
    changed = changed || sanitized.changed;
    changed = changed || linkChanged;
    totalRedactions += sanitized.redactionCount;
  }

  if (typeof nextPayload.summaryText === "string") {
    const sanitized = await sanitizeSourceText(nextPayload.summaryText);
    const linkStripped = stripLinksFromText(sanitized.text);
    const linkChanged = linkStripped !== sanitized.text;
    nextPayload.summaryText = linkStripped;
    changed = changed || sanitized.changed;
    changed = changed || linkChanged;
    totalRedactions += sanitized.redactionCount;
  }

  if (Array.isArray(nextPayload.results)) {
    const sanitizedResults = await Promise.all(nextPayload.results.map(async (result) => {
      if (!result || typeof result !== "object") return result;
      const row = result as Record<string, unknown>;
      let rowChanged = false;
      const nextRow: Record<string, unknown> = { ...row };

      if (typeof row.matchExplanation === "string") {
        const sanitized = await sanitizeSourceText(row.matchExplanation);
        const linkStripped = stripLinksFromText(sanitized.text);
        nextRow.matchExplanation = linkStripped;
        rowChanged = rowChanged || sanitized.changed;
        rowChanged = rowChanged || linkStripped !== row.matchExplanation;
        totalRedactions += sanitized.redactionCount;
      }
      if (typeof row.message === "string") {
        const sanitized = await sanitizeSourceText(row.message);
        const linkStripped = stripLinksFromText(sanitized.text);
        nextRow.message = linkStripped;
        rowChanged = rowChanged || sanitized.changed;
        rowChanged = rowChanged || linkStripped !== row.message;
        totalRedactions += sanitized.redactionCount;
      }

      changed = changed || rowChanged;
      return rowChanged ? nextRow : result;
    }));
    nextPayload.results = sanitizedResults;
  }

  if (totalRedactions > 0) {
    nextPayload.redactionNote = buildRedactionNote(totalRedactions);
  }

  return { payload: changed ? nextPayload : payload, changed };
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

type ClarificationCourseRef = { courseCode: string; sisOfferingName: string; term: string };

function clarificationChoiceToCourseRef(value: unknown): ClarificationCourseRef | null {
  if (!value || typeof value !== "object") return null;
  const choice = value as Record<string, unknown>;
  const sisOfferingName =
    (typeof choice.sisOfferingName === "string" && choice.sisOfferingName.trim()) ||
    (typeof choice.offeringName === "string" && choice.offeringName.trim()) ||
    "";
  const courseCode =
    (typeof choice.courseCode === "string" && choice.courseCode.trim()) ||
    (typeof choice.code === "string" && choice.code.trim()) ||
    (sisOfferingName ? catalogCourseCodeFromOfferingName(sisOfferingName) : "");
  const term = typeof choice.term === "string" ? choice.term.trim() : "";
  if (!courseCode || !sisOfferingName || !term) return null;
  return { courseCode, sisOfferingName, term };
}

function clarificationChoiceListToCourseRefs(value: unknown): ClarificationCourseRef[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => clarificationChoiceToCourseRef(entry))
      .filter((entry): entry is ClarificationCourseRef => !!entry);
  }
  const single = clarificationChoiceToCourseRef(value);
  return single ? [single] : [];
}

function joinHumanList(values: string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function getPromptForClarificationSlot(slotKey: string): string {
  if (slotKey === "addTarget") return "Which course should I add?";
  if (slotKey === "dropTarget") return "Which course should I drop?";
  if (slotKey === "metricsCourseTarget") return "Which specific course should I use for metrics?";
  return "Please answer the pending clarification before starting a new request.";
}

function buildResumeScheduleEditMessage(input: {
  intentOperation: unknown;
  originalRequest: string;
  confirmedSlots: Record<string, unknown>;
}): { operation: "add" | "drop" | "replace" | null; resumeMessage: string; canResume: boolean } {
  const addTargets = clarificationChoiceListToCourseRefs(input.confirmedSlots.addTarget);
  const dropTargets = clarificationChoiceListToCourseRefs(input.confirmedSlots.dropTarget);
  const addChoice = (
    Array.isArray(input.confirmedSlots.addTarget)
      ? input.confirmedSlots.addTarget[0]
      : input.confirmedSlots.addTarget
  ) as Record<string, unknown> | undefined;
  const dropChoice = input.confirmedSlots.dropTarget as Record<string, unknown> | undefined;
  const addChoiceEntries = Array.isArray(input.confirmedSlots.addTarget)
    ? input.confirmedSlots.addTarget.filter(
      (value): value is Record<string, unknown> => !!value && typeof value === "object",
    )
    : addChoice
      ? [addChoice]
      : [];
  const addTexts = addChoiceEntries
    .map((choice) =>
      (typeof choice.responseText === "string" && choice.responseText.trim()) ||
      (typeof choice.value === "string" && choice.value.trim()) ||
      (typeof choice.label === "string" && choice.label.trim()) ||
      "",
    )
    .filter((text): text is string => Boolean(text));
  const dropText =
    (typeof dropChoice?.responseText === "string" && dropChoice.responseText.trim()) ||
    (typeof dropChoice?.value === "string" && dropChoice.value.trim()) ||
    (typeof dropChoice?.label === "string" && dropChoice.label.trim()) ||
    "";
  const addRefText = addTargets.length > 0
    ? joinHumanList(addTargets.map((target) => `${target.sisOfferingName} in ${target.term}`))
    : joinHumanList(addTexts);
  const dropRefText = dropTargets.length > 0
    ? joinHumanList(dropTargets.map((target) => `${target.sisOfferingName} in ${target.term}`))
    : dropText;
  const operation: "add" | "drop" | "replace" | null =
    input.intentOperation === "add" || input.intentOperation === "drop" || input.intentOperation === "replace"
      ? input.intentOperation
      : addTargets.length > 0 && dropTargets.length > 0
        ? "replace"
        : addTargets.length > 0
          ? "add"
          : dropTargets.length > 0
            ? "drop"
            : null;
  const resumeMessage =
    operation === "add" && addRefText
      ? `add ${addRefText}`
      : operation === "drop" && dropRefText
        ? `drop ${dropRefText}`
        : operation === "replace" && addRefText && dropRefText
          ? `replace ${dropRefText} with ${addRefText}`
          : input.originalRequest;
  const canResume = resumeMessage.trim().toLowerCase() !== input.originalRequest.trim().toLowerCase();
  return { operation, resumeMessage, canResume };
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

  const queryMetricsResults = getQueryCourseMetricsResults(steps);
  const sisConstraintRows = getLastSisConstraintSearchCourseRows(steps);
  const semanticSearchRows = getLastSearchCourseDescriptionsResults(steps);
  const metricsDisambiguationCandidates = queryMetricsResults
    .filter((result) => result.disambiguationRequired && Array.isArray(result.disambiguationCandidates))
    .flatMap((result) => result.disambiguationCandidates ?? [])
    .filter((row): row is SisSearchToolCourseRow => !!row && typeof row === "object")
    .filter((row) => typeof row.offeringName === "string" && row.offeringName.trim() !== "");
  const sisDisambiguationRows =
    metricsDisambiguationCandidates.length > 0 ? metricsDisambiguationCandidates : sisConstraintRows;
  const semanticDisambiguationRows = semanticSearchRows.filter(
    (row) => typeof row.code === "string" && row.code.trim() !== "",
  );
  const useSisRowsForDisambiguation = sisDisambiguationRows.length > 1;
  const disambiguationRowCount = useSisRowsForDisambiguation
    ? sisDisambiguationRows.length
    : semanticDisambiguationRows.length;
  const shouldDisambiguateMetrics =
    disambiguationRowCount > 1 &&
    isNumericCourseMetricsIntent(userMessage) &&
    !userExplicitlyProvidedCourseNumber(userMessage);
  if (shouldDisambiguateMetrics) {
    const rawChoices = useSisRowsForDisambiguation
      ? sisDisambiguationRows
        .slice(0, 5)
        .map((row) => sisCourseRowToSearchResult(row, normalizeDetailsTerm(row.term)))
      : semanticDisambiguationRows
        .slice(0, 5)
        .map((row) => {
          const safeTerm = normalizeDetailsTerm(row.term);
          const safeCourseId = normalizeDetailsCourseId(
            row.sisOfferingName,
            safeTerm,
            row.courseId,
          );
          return {
          courseId: safeCourseId,
          sisOfferingName: row.sisOfferingName,
          offeringName: row.sisOfferingName,
          code: row.code,
          title: row.title,
          description: row.description,
          term: safeTerm,
          };
        });
    const choices = (await enrichMissingDescriptions(rawChoices)) as Array<Record<string, unknown>>;
    parsed = {
      type: "clarification",
      question: "I found multiple matching courses. Please choose one to see workload and difficulty metrics.",
      message: "I found multiple matching courses. Please choose one to see workload and difficulty metrics.",
      slotKey: "metricsCourseTarget",
      options: normalizeClarificationOptions(choices),
    };
  }

  const queryMetricsResult = getLastQueryCourseMetricsResult(steps);
  const evalSummaryResult = getLastCourseEvalSummaryResult(steps);
  if (evalSummaryResult && !queryMetricsResult) {
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

  const detailsIntent = isCourseDetailsIntent(userMessage);
  const sisDetailsResult = getBestSisCourseDetailsResult(steps, userMessage);
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
  } else if (
    detailsIntent &&
    sisConstraintRows.length === 1 &&
    (typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { type?: string }).type !== "details")
  ) {
    parsed = {
      type: "details",
      course: sisCourseRowToDetailsCourse(sisConstraintRows[0]),
    };
  }

  const parsedType =
    typeof parsed === "object" && parsed !== null
      ? (parsed as { type?: unknown }).type
      : undefined;
  const shouldForceSearchPayload =
    parsedType !== "search" &&
    parsedType !== "summary" &&
    parsedType !== "details" &&
    parsedType !== "clarification" &&
    !detailsIntent &&
    !deterministicIntent?.isScheduleModification &&
    (sisConstraintRows.length > 0 || semanticSearchRows.length > 0);
  if (shouldForceSearchPayload) {
    parsed = {
      type: "search",
      results: sisConstraintRows.length > 0
        ? sisConstraintRows.map((row) => sisCourseRowToSearchResult(row, normalizeDetailsTerm(row.term)))
        : semanticSearchRows,
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
    const sisConstraintRowsFull = getLastSisConstraintSearchCourseRows(steps);
    const parsedResults = (parsed as { results: unknown[] }).results;
    if (parsedResults.length === 0 && sisConstraintRowsFull.length > 0) {
      (parsed as { results: unknown[] }).results = sisConstraintRowsFull.map((row) => ({
        offeringName: row.offeringName,
        sectionName: row.sectionName,
        title: row.title,
        description: row.description ?? "",
        schoolName: row.schoolName,
        department: row.department,
        level: row.level,
        timeOfDay: row.timeOfDay,
        daysOfWeek: row.daysOfWeek,
        location: row.location,
        instructors: row.instructors,
        instructor: Array.isArray(row.instructors) && row.instructors.length > 0
          ? row.instructors.join(", ")
          : undefined,
        status: row.status,
        term: row.term ?? "Spring 2026",
      }));
    }
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

  // Deterministically inject sources from tool results so the frontend always
  // renders source buttons regardless of what the LLM put in its JSON output.
  const rmpResult = getRmpResult(steps);
  const redditThreads = getRedditThreads(steps);
  if (rmpResult || redditThreads.length > 0) {
    const sources: Array<{ label: string; url: string; year?: number }> = [];
    if (rmpResult) {
      const safeUrl = sanitizeSourceUrl(rmpResult.profileUrl, "www.ratemyprofessors.com");
      if (safeUrl) {
        const latestComment = rmpResult.recentComments[0];
        const year = latestComment?.date ? new Date(latestComment.date).getFullYear() : undefined;
        sources.push({ label: "Rate My Professor", url: safeUrl, year });
      }
    }
    for (const thread of redditThreads) {
      const safeUrl = sanitizeSourceUrl(thread.url, "www.reddit.com");
      if (!safeUrl) continue;
      const title = thread.title.length > 40 ? thread.title.slice(0, 40) + "…" : thread.title;
      const year = thread.publishedDate ? new Date(thread.publishedDate).getFullYear() : undefined;
      sources.push({ label: title, url: safeUrl, year });
    }
    (parsed as Record<string, unknown>).sources = sources;
  }

  return parsed as AgentResponsePayload;
}

// ─── Agent route ──────────────────────────────────────────────────────────────

router.post("/", async (req: Request, res: Response) => {
  const {
    message,
    scheduleId: scheduleIdRaw,
    stream: streamRaw,
    clarificationSelection: clarificationSelectionRaw,
  } = req.body as {
    message?: string;
    scheduleId?: unknown;
    stream?: boolean;
    clarificationSelection?: unknown;
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
  const clarificationSelection =
    clarificationSelectionRaw && typeof clarificationSelectionRaw === "object"
      ? (() => {
          const raw = clarificationSelectionRaw as {
            slotKey?: unknown;
            choice?: unknown;
            choices?: unknown;
          };
          const hasChoiceObject = !!raw.choice && typeof raw.choice === "object";
          const choicesArray = Array.isArray(raw.choices) ? raw.choices : null;
          const hasChoicesArray = choicesArray !== null;
          if (!hasChoiceObject && !hasChoicesArray) return null;
          return {
            slotKey: typeof raw.slotKey === "string" ? raw.slotKey.trim() : undefined,
            choice: hasChoiceObject ? (raw.choice as Record<string, unknown>) : undefined,
            choices: choicesArray
              ? choicesArray.filter(
                  (entry): entry is Record<string, unknown> =>
                    !!entry && typeof entry === "object",
                )
              : undefined,
          };
        })()
      : null;

  const abortController = new AbortController();
  let assistantMessagePersisted = false;
  const routeName = "/api/agent";
  const requestId = req.header("x-request-id") ?? null;
  const dbUserId = req.user?.id ? toDatabaseUserId(req.user.id) : null;

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
    const rateLimitResult = await enforceAiRateLimit(routeName, req.user?.id);
    if (!rateLimitResult.allowed) {
      res.status(rateLimitResult.status).json({ error: rateLimitResult.error });
      return;
    }
    const spendCapResult = await enforceDailySpendCap(routeName, req.user?.id);
    if (!spendCapResult.allowed) {
      res.status(spendCapResult.status).json({ error: spendCapResult.error });
      return;
    }
    const injectionResult = await enforcePromptInjectionPolicy({
      route: routeName,
      appUserId: req.user?.id,
      message,
    });
    if (!injectionResult.allowed) {
      res.status(injectionResult.status).json({ error: injectionResult.error });
      return;
    }

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

    let canonicalMemories: CanonicalMemoryRow[] = [];
    let scheduleContextAppend = "";
    let scheduleCoursesForDisambiguation: ScheduleCourseRow[] = [];
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
      canonicalMemories = loaded.context.canonicalMemories;
      scheduleCoursesForDisambiguation = Array.isArray(loaded.context.courses)
        ? loaded.context.courses
        : [];
    }

    /** Home / non-schedule chat: inject same canonical memories as schedule-aware mode (no duplicate when scheduleId is set). */
    let userMemoriesAppend = "";
    if (req.user && !scheduleId) {
      try {
        const memCtx = await loadUserMemoryContextForAgent(req.user.id);
        userMemoriesAppend = buildUserMemoriesOnlyBlock(memCtx);
        canonicalMemories = memCtx.canonicalMemories;
      } catch (err) {
        console.error("[Agent] failed to load user memories for prompt:", err);
      }
    }

    let chatState: ChatStateRow | null = null;
    let chatHistoryAppend = "";
    let recentChatMessages: ChatMessageRow[] = [];
    let userChatRow: ChatMessageRow | null = null;
    const isStructuredClarificationSelection =
      !!clarificationSelection?.choice ||
      !!(clarificationSelection?.choices && clarificationSelection.choices.length > 0);
    const persistUserMessage = async () => {
      if (!scheduleId || !req.user || chatState) return;
      chatState = await getOrCreateChatState(pool, scheduleId, req.user.id);

      // Load prior history before persisting the current user message so the
      // current turn is not included in the context block sent to the LLM.
      // Gracefully falls back to stateless if retrieval fails.
      try {
        recentChatMessages = await loadRecentMessages(pool, chatState.id);
        chatHistoryAppend = formatChatHistoryBlock(chatState.rolling_summary, recentChatMessages);
      } catch (err) {
        console.error("[Agent] failed to load chat history, continuing stateless:", err);
      }

      if (isStructuredClarificationSelection) {
        return;
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
      if (typeof payload.type === "string" && payload.type === "clarification") {
        return;
      }
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

    const finalizeAndRespond = async (
      payload: AgentResponsePayload,
      metadata: Record<string, unknown> = payload,
    ) => {
      const {
        payload: safePayload,
        changed: wasSanitized,
      } = await sanitizeFinalPayloadForSourceSafety(payload);
      if (wasSanitized) {
        console.warn("[agent-safety] sanitized_output");
      }
      // Persist sanitized payload fields in metadata so history replay cannot
      // reintroduce unsafe text from pre-sanitized payload snapshots.
      await persistAssistantMessage(safePayload, {
        ...metadata,
        ...safePayload,
      });
      triggerChatMemoryExtraction();
      if (shouldStream) {
        emitStatus("done");
        writeSseEvent(res, "final", { stage: "done", response: safePayload });
        res.end();
      } else {
        res.json(safePayload);
      }
    };

    const persistClarificationFromAmbiguousPayload = async (input: {
      payload: AgentResponsePayload;
      originalRequest: string;
      intentOperation: string;
      confirmedSlots?: Record<string, unknown>;
    }): Promise<AgentResponsePayload> => {
      if (!chatState || !scheduleId || !req.user) {
        return input.payload;
      }
      const extracted = extractPendingClarificationFromPayload(input.payload as {
        scheduleChanges?: {
          operation?: string;
          failed?: Array<{ action?: "add" | "drop"; reasonCode?: string; candidates?: unknown }>;
        };
        results?: unknown[];
      });
      if (!extracted || extracted.sortedMissingSlots.length === 0) {
        return input.payload;
      }
      const firstSlot = extracted.sortedMissingSlots[0] ?? "courseTarget";
      const prompt = getDisplayTextFromFinalPayload(input.payload);
      await upsertPendingClarificationState(pool, {
        chatStateId: chatState.id,
        scheduleId,
        userId: req.user.id,
        intent: { operation: extracted.operation ?? input.intentOperation },
        missingSlots: extracted.sortedMissingSlots,
        confirmedSlots: input.confirmedSlots,
        candidateOptions: extracted.candidateOptions,
        nextQuestion: { slotKey: firstSlot, prompt },
        originalRequest: input.originalRequest,
      });
      return buildClarificationPayload({
        prompt,
        slotKey: firstSlot,
        candidateOptions: extracted.candidateOptions,
      }) as AgentResponsePayload;
    };

    const triggerResponseEvaluation = (payload: AgentResponsePayload, steps: AgentStep[]) => {
      if (!req.user) return;
      const toolNames = steps.flatMap((s) => s.toolResults.map((r) => r.toolName));
      void runResponseEvaluation({
        pool,
        appUserId: req.user.id,
        userMessage: message,
        assistantMessageId: userChatRow?.id ?? null,
        finalPayload: payload,
        toolSteps: toolNames,
        canonicalMemories,
      }).catch((err) => console.error("[Agent] response evaluation failed:", err));
    };
    const deterministicIntent = scheduleId ? detectScheduleModificationIntent(message) : null;
    await persistUserMessage();

    const isMetricsClarificationSelection =
      clarificationSelection?.slotKey === "metricsCourseTarget" &&
      (!!clarificationSelection.choice ||
        (Array.isArray(clarificationSelection?.choices) && clarificationSelection.choices.length > 0));
    if (isMetricsClarificationSelection) {
      const rawChoices =
        Array.isArray(clarificationSelection?.choices) && clarificationSelection.choices.length > 0
          ? clarificationSelection.choices
          : clarificationSelection?.choice
            ? [clarificationSelection.choice]
            : [];
      const metricTargets = rawChoices
        .map((rawChoice) => {
          const sisOfferingName =
            (typeof rawChoice?.sisOfferingName === "string" && rawChoice.sisOfferingName.trim()) ||
            (typeof rawChoice?.offeringName === "string" && rawChoice.offeringName.trim()) ||
            "";
          const courseCode =
            (typeof rawChoice?.courseCode === "string" && rawChoice.courseCode.trim()) ||
            (typeof rawChoice?.code === "string" && rawChoice.code.trim()) ||
            (sisOfferingName ? catalogCourseCodeFromOfferingName(sisOfferingName) : "");
          if (!courseCode) return null;
          const requestedTerm =
            typeof rawChoice?.term === "string" && rawChoice.term.trim() !== "" && rawChoice.term !== "All terms"
              ? rawChoice.term.trim()
              : undefined;
          return {
            courseCode,
            term: clampCourseMetricsTermToAllowedWindow(requestedTerm),
          };
        })
        .filter((target): target is { courseCode: string; term: string | undefined } => target !== null);
      if (metricTargets.length === 0) {
        // Ignore malformed clarification payloads and continue as a normal user message.
      } else {
        const metricsResults = await Promise.all(
          metricTargets.map((target) => queryCourseMetrics(target.courseCode, target.term)),
        );
        const messageText = metricsResults
          .map((metricsResult) => buildQueryCourseMetricsResponseText(metricsResult))
          .join("\n");
        const payload = {
          type: "text",
          message: messageText,
        } satisfies AgentResponsePayload;
        await finalizeAndRespond(payload, {
          ...payload,
          metricsResult: metricsResults[0],
          metricsResults,
        });
        return;
      }
    }

    const activeChatState = chatState;
    if (scheduleId && activeChatState) {
      const pending = await getPendingClarificationState(pool, activeChatState.id);
      if (pending) {
        const hasStructuredClarificationSelection =
          !!clarificationSelection?.choice ||
          !!(clarificationSelection?.choices && clarificationSelection.choices.length > 0);
        if (!hasStructuredClarificationSelection) {
          await resolvePendingClarificationState(pool, activeChatState.id);
          console.log(
            "[Agent] pending clarification",
            JSON.stringify({
              scheduleId,
              action: "discarded_on_new_request",
            }),
          );
        } else {
          const pendingRecord = pending as Record<string, unknown>;
          const intent = (pendingRecord.intent as Record<string, unknown> | undefined) ?? {};
          const originalRequest = typeof pendingRecord.original_request === "string"
            ? pendingRecord.original_request
            : "";
          const missingSlots = Array.isArray(pendingRecord.missing_slots)
            ? pendingRecord.missing_slots.filter((s): s is string => typeof s === "string")
            : [];
          const confirmedSlots =
            pendingRecord.confirmed_slots && typeof pendingRecord.confirmed_slots === "object"
              ? (pendingRecord.confirmed_slots as Record<string, unknown>)
              : {};
          const candidateOptions =
            pendingRecord.candidate_options && typeof pendingRecord.candidate_options === "object"
              ? (pendingRecord.candidate_options as Record<string, unknown>)
              : {};
          const hasAnyCandidateOptions = Object.values(candidateOptions).some(
            (raw) => Array.isArray(raw) && raw.length > 0,
          );
          const nextQuestion =
            pendingRecord.next_question && typeof pendingRecord.next_question === "object"
              ? (pendingRecord.next_question as Record<string, unknown>)
              : null;
          if (!hasAnyCandidateOptions) {
            await resolvePendingClarificationState(pool, activeChatState.id);
            console.log(
              "[Agent] pending clarification",
              JSON.stringify({
                scheduleId,
                action: "resolved_empty_options",
              }),
            );
          } else {
            const slotKey =
              (nextQuestion && typeof nextQuestion.slotKey === "string" && nextQuestion.slotKey.trim() !== ""
                ? nextQuestion.slotKey
                : missingSlots[0]) || "courseTarget";
            const activeChoices = normalizePendingChoices(candidateOptions[slotKey]);
            const requestedSlotKey = clarificationSelection?.slotKey ?? null;
            const selectionSlotKey =
              clarificationSelection?.slotKey &&
                missingSlots.includes(clarificationSelection.slotKey)
                ? clarificationSelection.slotKey
                : slotKey;
            const selectedFromStructured =
              clarificationSelection?.choices && clarificationSelection.choices.length > 0
                ? clarificationSelection.choices
                : clarificationSelection?.choice
                  ? [clarificationSelection.choice]
                  : [];
            const selectedChoices = selectedFromStructured.length > 0 ? selectedFromStructured : [];
            const selected = selectedChoices.length > 0
              ? { slotKey: selectionSlotKey, choices: selectedChoices }
              : null;
            console.log(
              "[Agent] pending clarification",
              JSON.stringify({
                scheduleId,
                requestedSlotKey,
                resolvedSlotKey: selectionSlotKey,
                matchedFrom: selectedFromStructured.length > 0 ? "structured" : "none",
                activeChoiceCount: activeChoices.length,
                selectedChoiceCount: selectedChoices.length,
              }),
            );
            if (!selected) {
              const unresolvedPrompt =
                nextQuestion && typeof nextQuestion.prompt === "string" && nextQuestion.prompt.trim() !== ""
                  ? nextQuestion.prompt
                  : "Please answer the pending clarification before starting a new request.";
              await finalizeAndRespond(
                buildClarificationPayload({
                  prompt: unresolvedPrompt,
                  slotKey,
                  candidateOptions,
                }) as AgentResponsePayload,
              );
              return;
            }

            const nextConfirmed = {
              ...confirmedSlots,
              [selected.slotKey]:
                selected.slotKey === "addTarget" ? selected.choices : selected.choices[0],
            };
            const nextMissing = missingSlots.filter((slot) => slot !== selected.slotKey);
            if (requestedSlotKey && requestedSlotKey !== selectionSlotKey && !missingSlots.includes(requestedSlotKey)) {
              const cannotCorrectPayload = {
                type: "text",
                message:
                  "I can only accept clarification for the current pending slot right now. If you want to correct an earlier choice, please restate the schedule edit request and I will re-run it.",
              } satisfies AgentResponsePayload;
              await finalizeAndRespond(cannotCorrectPayload);
              return;
            }
            if (nextMissing.length === 0) {
              await resolvePendingClarificationState(pool, activeChatState.id);
              const { operation, resumeMessage, canResume } = buildResumeScheduleEditMessage({
                intentOperation: intent.operation,
                originalRequest,
                confirmedSlots: nextConfirmed,
              });
              if (!canResume) {
                const payload = {
                  type: "text",
                  message:
                    "Thanks. I captured your clarification, but I couldn't construct a precise follow-up action. Please restate the schedule edit in one sentence and I will apply it.",
                } satisfies AgentResponsePayload;
                await finalizeAndRespond(payload);
                return;
              }
              const resumed = await handleScheduleEditMessage({
                userId: req.user.id,
                scheduleId,
                message: resumeMessage,
              });
              if (resumed.handled) {
                let payload = resumed.payload as AgentResponsePayload;
                if (isAmbiguousClarificationPayload(payload)) {
                  payload = await persistClarificationFromAmbiguousPayload({
                    payload,
                    originalRequest,
                    intentOperation: operation ?? "unknown",
                    confirmedSlots: nextConfirmed,
                  });
                }
                await finalizeAndRespond(payload);
                return;
              }
              const payload = {
                type: "text",
                message: "Thanks, that clarification is updated.",
              } satisfies AgentResponsePayload;
              await finalizeAndRespond(payload);
              return;
            }
            const nextSlot = nextMissing[0] ?? "courseTarget";
            const nextPrompt = getPromptForClarificationSlot(nextSlot);
            await upsertPendingClarificationState(pool, {
              chatStateId: activeChatState.id,
              scheduleId,
              userId: req.user.id,
              intent,
              missingSlots: nextMissing,
              confirmedSlots: nextConfirmed,
              candidateOptions,
              nextQuestion: { slotKey: nextSlot, prompt: nextPrompt },
              originalRequest,
            });
            await finalizeAndRespond(
              buildClarificationPayload({
                prompt: `Updated. ${nextPrompt}`,
                slotKey: nextSlot,
                candidateOptions,
              }) as AgentResponsePayload,
            );
            return;
          }
        }
      }
    }

    const conflictingConstraintMessage = getConflictingConstraintMessage(message);
    if (conflictingConstraintMessage) {
      const payload = {
        type: "text",
        message: conflictingConstraintMessage,
      } satisfies AgentResponsePayload;
      await finalizeAndRespond(payload);
      return;
    }

    if (scheduleId && req.user) {
      const customEventResult = await handleCustomScheduleEventMessage({
        userId: req.user.id,
        scheduleId,
        message,
        recentMessages: recentChatMessages.map((chatMessage) => ({
          role: chatMessage.role,
          content: chatMessage.content,
        })),
      });
      if (customEventResult.handled) {
        const payload = customEventResult.payload as AgentResponsePayload;
        await finalizeAndRespond(payload, payload);
        return;
      }
    }

    const inScope = await isQueryInProductScope(message, {
      conversationContext: chatHistoryAppend || undefined,
    });
    if (!inScope) {
      const payload = {
        type: "text",
        message: OUT_OF_SCOPE_REDIRECT_MESSAGE,
      } satisfies AgentResponsePayload;
      await finalizeAndRespond(payload);
      return;
    }

    if (userExplicitlyRequestedGraduateScope(message)) {
      const payload = {
        type: "text",
        message: GRAD_SCOPE_REFUSAL_MESSAGE,
      } satisfies AgentResponsePayload;
      await finalizeAndRespond(payload);
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
        let payload = editResult.payload as AgentResponsePayload;
        if (chatState && isAmbiguousClarificationPayload(payload)) {
          payload = await persistClarificationFromAmbiguousPayload({
            payload,
            originalRequest: message,
            intentOperation: "unknown",
          });
        }
        await finalizeAndRespond(payload);
        return;
      }
    }

    const ambiguousCourseOptions = getAmbiguousCourseCandidatesFromSchedule(
      scheduleCoursesForDisambiguation,
    );
    const hasRealCourseAmbiguity = ambiguousCourseOptions.length > 1;

    if (
      deterministicIntent?.isScheduleModification &&
      hasUnderspecifiedCourseReference(message) &&
      hasRealCourseAmbiguity
    ) {
      const operationLabel = deterministicIntent.operation;
      const payload = {
        type: "text",
        message: `I interpreted that as a ${operationLabel} request. ${buildSoftAmbiguousCourseMessage(ambiguousCourseOptions)}`,
      } satisfies AgentResponsePayload;
      await finalizeAndRespond(payload);
      return;
    }

    if (hasUnderspecifiedCourseReference(message) && hasRealCourseAmbiguity) {
      const payload = {
        type: "text",
        message: buildSoftAmbiguousCourseMessage(ambiguousCourseOptions),
      } satisfies AgentResponsePayload;
      await finalizeAndRespond(payload);
      return;
    }

    const systemPrompt = BASE_SYSTEM_PROMPT + scheduleContextAppend + userMemoriesAppend + chatHistoryAppend;
    const sisSearchRowsSeenForMetrics: SisSearchToolCourseRow[] = [];
    const semanticSearchRowsSeenForMetrics: SearchResult[] = [];

    const tools = createAgentTools({
      message,
      scheduleId,
      sisSearchRowsSeenForMetrics,
      semanticSearchRowsSeenForMetrics,
    });


    if (!shouldStream) {
      const startedAt = Date.now();
      const out = await generateText({
        abortSignal: abortController.signal,
        onStepFinish: logStepFinish,
        model: openai("gpt-4o-mini"),
        system: systemPrompt,
        prompt: message,
        stopWhen: stepCountIs(5),
        tools,
      });
      const { text, steps } = out;

      const payload = await normalizeAgentResponse(
        text,
        steps as AgentStep[],
        message,
        deterministicIntent,
      );
      const {
        payload: safePayload,
        changed: wasSanitized,
      } = await sanitizeFinalPayloadForSourceSafety(payload);
      if (wasSanitized) {
        console.warn("[agent-safety] sanitized_output");
      }
      await persistAssistantMessage(safePayload, safePayload);
      triggerChatMemoryExtraction();
      triggerResponseEvaluation(safePayload, steps as AgentStep[]);
      void writeAiCallLog({
        route: routeName,
        userId: dbUserId,
        requestId,
        model: "gpt-4o-mini",
        operation: "generateText",
        prompt: message,
        response: JSON.stringify(safePayload),
        usage: (out as { usage?: unknown }).usage,
        latencyMs: Date.now() - startedAt,
        success: true,
        metadata: { stream: false },
      }).catch((err) => console.error("[Agent] ai observability write failed:", err));
      res.json(safePayload);
      return;
    }

    let rawStreamedText = "";
    let emittedDisplayLength = 0;
    let sawToolResultChunk = false;

    const startedAt = Date.now();
    const streamResult = streamText({
      abortSignal: abortController.signal,
      onChunk: ({ chunk }) => {
        if (chunk.type === "tool-result") {
          sawToolResultChunk = true;
        }
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
        if (sawToolResultChunk) return;

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
      stopWhen: stepCountIs(5),
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
    const {
      payload: safePayload,
      changed: wasSanitized,
    } = await sanitizeFinalPayloadForSourceSafety(payload);
    if (wasSanitized) {
      console.warn("[agent-safety] sanitized_output");
    }
    const finalDisplayText = getDisplayTextFromFinalPayload(safePayload);

    if (!sawToolResultChunk && finalDisplayText.length > emittedDisplayLength) {
      writeSseEvent(res, "text_chunk", {
        text: finalDisplayText.slice(emittedDisplayLength),
      });
    }

    await persistAssistantMessage(safePayload, safePayload);
    triggerChatMemoryExtraction();
    triggerResponseEvaluation(safePayload, steps as AgentStep[]);
    void writeAiCallLog({
      route: routeName,
      userId: dbUserId,
      requestId,
      model: "gpt-4o-mini",
      operation: "streamText",
      prompt: message,
      response: JSON.stringify(safePayload),
      usage: (streamResult as { totalUsage?: Promise<unknown> }).totalUsage
        ? await (streamResult as { totalUsage: Promise<unknown> }).totalUsage
        : undefined,
      latencyMs: Date.now() - startedAt,
      success: true,
      metadata: { stream: true },
    }).catch((err) => console.error("[Agent] ai observability write failed:", err));
    writeSseEvent(res, "status", { stage: "done" });
    writeSseEvent(res, "final", { stage: "done", response: safePayload });
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
