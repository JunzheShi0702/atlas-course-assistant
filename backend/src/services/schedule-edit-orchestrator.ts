import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { pool } from "../pool";
import { searchCoursesBySisConstraints } from "../tools/search-courses-by-sis-constraints";
import { searchCourseDescriptions } from "../tools/search-course-descriptions";
import {
  loadScheduleContextForAgent,
  type ScheduleAgentContext,
  type ScheduleCourseRow,
} from "./schedule-context";
import {
  detectScheduleModificationIntent,
  type ScheduleOperation,
} from "./schedule-modification-intent";
import {
  modifyScheduleCourses,
  type ModifyScheduleCoursesOutput,
  type ModifyScheduleFailure,
  type ScheduleCourseRef,
} from "../tools/modify-schedule-courses";

type ParsedReference = {
  raw: string;
  courseCode?: string;
  courseTitle?: string;
  term?: string;
};

type ParsedEdit = {
  operation: ScheduleOperation;
  addRefs: ParsedReference[];
  dropRefs: ParsedReference[];
};
type SideTexts = { addText: string; dropText: string };

type SearchCandidate = {
  courseId: string;
  code: string;
  title: string;
  description: string;
  sisOfferingName: string;
  term: string;
  credits?: number;
};

type AgentEditPayload =
  | {
      type: "text";
      message: string;
      scheduleChanges: {
        operation: ScheduleOperation;
        added: Array<{ courseCode: string; sisOfferingName: string; term: string }>;
        removed: Array<{ courseCode: string; sisOfferingName: string; term: string }>;
        failed: ModifyScheduleFailure[];
      };
    }
  | {
      type: "search";
      message: string;
      results: Array<Record<string, unknown>>;
      scheduleChanges: {
        operation: ScheduleOperation;
        added: Array<{ courseCode: string; sisOfferingName: string; term: string }>;
        removed: Array<{ courseCode: string; sisOfferingName: string; term: string }>;
        failed: ModifyScheduleFailure[];
      };
    };

export type EditHandledResult =
  | { handled: false }
  | { handled: true; payload: AgentEditPayload };

type ResolveResult =
  | { status: "resolved"; course: ScheduleCourseRef }
  | { status: "failed"; failure: ModifyScheduleFailure; candidates?: SearchCandidate[] };

function isScheduleEditDebugEnabled(): boolean {
  const raw = process.env.SCHEDULE_EDIT_DEBUG?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return process.env.NODE_ENV !== "production";
}

function logScheduleEdit(event: string, metadata: Record<string, unknown> = {}): void {
  if (!isScheduleEditDebugEnabled()) return;
  console.log(`[ScheduleEdit] ${event}`, JSON.stringify(metadata));
}

// Reference parsing primitives for schedule edit messages.
const COURSE_CODE_PATTERN = /\b(?:[a-z]{2}\.)?\d{3}\.\d{3}\b/gi;
const TERM_PATTERN = /\b(Spring|Summer|Fall|Winter)\s+20\d{2}\b/i;

const parsedReferenceSchema = z.object({
  raw: z.string(),
  courseCode: z.string().optional(),
  courseTitle: z.string().optional(),
  term: z.string().optional(),
});

const llmParseSchema = z.object({
  operation: z.enum(["add", "drop", "replace"]),
  addRefs: z.array(parsedReferenceSchema),
  dropRefs: z.array(parsedReferenceSchema),
});

type ScheduleEditDeps = {
  loadContext?: (
    userId: string,
    scheduleId: string,
  ) => Promise<{ ok: true; context: ScheduleAgentContext } | { ok: false; error: "not_found" | "forbidden" }>;
  parseWithLlm?: (message: string, operation: ScheduleOperation) => Promise<ParsedEdit | null>;
  searchCandidates?: (ref: ParsedReference, scheduleTerm: string) => Promise<SearchCandidate[]>;
  runModify?: (input: {
    scheduleId: string;
    operation: ScheduleOperation;
    addCourses: ScheduleCourseRef[];
    dropCourses: ScheduleCourseRef[];
    preflightFailures: ModifyScheduleFailure[];
  }) => Promise<ModifyScheduleCoursesOutput>;
};

// --- Normalization helpers ---------------------------------------------------
function normalizeCourseCode(input: string): string {
  const trimmed = input.trim().toUpperCase();
  if (/^[A-Z]{2}\.\d{3}\.\d{3}$/.test(trimmed)) {
    return trimmed.split(".").slice(1).join(".");
  }
  return trimmed;
}

function normalizeOfferingName(input: string): string {
  return input.trim().toUpperCase();
}

function toCandidateFromScheduleRow(row: ScheduleCourseRow): SearchCandidate {
  return {
    courseId: `${row.sisOfferingName.toLowerCase().replace(/\./g, "-")}-${row.term.toLowerCase().replace(/\s+/g, "-")}`,
    code: row.courseCode,
    title: row.courseTitle,
    description: "",
    sisOfferingName: row.sisOfferingName,
    term: row.term,
    credits: row.credits ?? undefined,
  };
}

// --- Parse message into add/drop "sides" ------------------------------------
function splitReplaceMessage(message: string): [string, string] | null {
  const match = message.match(/\b(with|for|instead of|to|into|by)\b/i);
  if (!match?.index) return null;
  const left = message.slice(0, match.index).trim();
  const right = message.slice(match.index + match[0].length).trim();
  if (!left || !right) return null;
  return [left, right];
}

function parseCodes(text: string): string[] {
  const codes = [...text.matchAll(COURSE_CODE_PATTERN)].map((m) => m[0]);
  return Array.from(new Set(codes.map((code) => code.toUpperCase())));
}

function parseQuotedTitles(text: string): string[] {
  const matches = [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim());
  return matches.filter(Boolean);
}

function parseImplicitTitle(sideText: string): string | undefined {
  let remaining = sideText.replace(TERM_PATTERN, " ");
  remaining = remaining.replace(COURSE_CODE_PATTERN, " ");
  remaining = remaining.replace(/"([^"]+)"/g, " ");
  remaining = remaining
    .replace(
      /\b(add|insert|enroll|take|drop|remove|delete|unenroll|replace|swap|switch|exchange|trade|with|for|instead of|and|to|from|in|on|my|this|that|schedule|please|course|class|called|named|titled|want|would|like|can|could|me|the|a|an)\b/gi,
      " ",
    )
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!remaining) return undefined;
  if (/^(course|class|one|something)$/i.test(remaining)) return undefined;
  return remaining;
}

function parseTerm(text: string): string | undefined {
  const match = text.match(TERM_PATTERN);
  return match ? match[0] : undefined;
}

function getSideTexts(message: string, operation: ScheduleOperation): SideTexts {
  if (operation === "add") return { addText: message, dropText: "" };
  if (operation === "drop") return { addText: "", dropText: message };
  const split = splitReplaceMessage(message);
  if (!split) return { addText: "", dropText: "" };
  return { dropText: split[0], addText: split[1] };
}

// Deterministic pass: extract explicit codes/quoted titles before any LLM parsing.
function deterministicRefsFromSide(sideText: string): ParsedReference[] {
  const term = parseTerm(sideText);
  const codeRefs = parseCodes(sideText).map((code) => ({
    raw: code,
    courseCode: normalizeCourseCode(code),
    term,
  }));
  const quotedTitleRefs = parseQuotedTitles(sideText).map((title) => ({
    raw: title,
    courseTitle: title,
    term,
  }));
  const implicitTitle = parseImplicitTitle(sideText);
  const implicitTitleRefs =
    implicitTitle && !quotedTitleRefs.some((ref) => ref.courseTitle?.toLowerCase() === implicitTitle.toLowerCase())
      ? [{ raw: implicitTitle, courseTitle: implicitTitle, term }]
      : [];
  return [...codeRefs, ...quotedTitleRefs, ...implicitTitleRefs];
}

function deterministicParse(operation: ScheduleOperation, sides: SideTexts): ParsedEdit {
  return {
    operation,
    addRefs: deterministicRefsFromSide(sides.addText),
    dropRefs: deterministicRefsFromSide(sides.dropText),
  };
}

function sideNeedsTitleParsing(sideText: string, refs: ParsedReference[]): boolean {
  if (!sideText.trim()) return false;
  let remaining = sideText.replace(TERM_PATTERN, " ");
  for (const ref of refs) {
    remaining = remaining.replace(ref.raw, " ");
  }
  remaining = remaining
    .replace(
      /\b(add|insert|enroll|take|drop|remove|delete|unenroll|replace|swap|switch|exchange|trade|with|for|instead of|and|to|from|in|on|my|this|schedule|please)\b/gi,
      " ",
    )
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /[a-z]/i.test(remaining);
}

// Merge LLM-proposed title refs while preserving deterministic code refs.
function mergeTitleRefs(baseRefs: ParsedReference[], llmRefs: ParsedReference[]): ParsedReference[] {
  const dedupe = new Set(baseRefs.map((r) => `${r.courseCode ?? ""}|${(r.courseTitle ?? "").toLowerCase()}|${r.term ?? ""}`));
  const merged = [...baseRefs];
  for (const ref of llmRefs) {
    if (!ref.courseTitle || ref.courseCode) continue;
    const key = `|${ref.courseTitle.toLowerCase()}|${ref.term ?? ""}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    merged.push({ raw: ref.raw || ref.courseTitle, courseTitle: ref.courseTitle, term: ref.term });
  }
  return merged;
}

async function maybeMergeLlmTitles(
  message: string,
  operation: ScheduleOperation,
  sides: SideTexts,
  parsed: ParsedEdit,
  parseWithLlm: (message: string, operation: ScheduleOperation) => Promise<ParsedEdit | null>,
): Promise<{ parsed: ParsedEdit; llmParsed: ParsedEdit | null }> {
  const needAddTitles = sideNeedsTitleParsing(sides.addText, parsed.addRefs);
  const needDropTitles = sideNeedsTitleParsing(sides.dropText, parsed.dropRefs);
  if (!needAddTitles && !needDropTitles) return { parsed, llmParsed: null };

  const llmParsed = await parseWithLlm(message, operation);
  if (!llmParsed) return { parsed, llmParsed: null };

  const merged: ParsedEdit = {
    operation,
    addRefs: needAddTitles ? mergeTitleRefs(parsed.addRefs, llmParsed.addRefs) : parsed.addRefs,
    dropRefs: needDropTitles ? mergeTitleRefs(parsed.dropRefs, llmParsed.dropRefs) : parsed.dropRefs,
  };
  return { parsed: merged, llmParsed };
}

function hasSufficientRefs(parsed: ParsedEdit): boolean {
  if (parsed.operation === "add") return parsed.addRefs.length > 0;
  if (parsed.operation === "drop") return parsed.dropRefs.length > 0;
  return parsed.addRefs.length > 0 && parsed.dropRefs.length > 0;
}

// LLM parser fallback only for extracting references, never for mutating decisions.
async function defaultLlmParse(message: string, operation: ScheduleOperation): Promise<ParsedEdit | null> {
  try {
    const out = await generateText({
      model: openai("gpt-4o-mini"),
      system:
        "Extract schedule edit references. Only include references explicitly mentioned by the user. Do not guess missing courses. " +
        "Return ONLY valid JSON with shape: { operation: 'add'|'drop'|'replace', addRefs: ParsedReference[], dropRefs: ParsedReference[] }.",
      prompt: `Operation inferred: ${operation}. Message: ${message}`,
      temperature: 0,
    });
    const text = out.text.trim();
    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(text);
    } catch {
      const first = text.indexOf("{");
      const last = text.lastIndexOf("}");
      if (first < 0 || last <= first) return null;
      try {
        parsedRaw = JSON.parse(text.slice(first, last + 1));
      } catch {
        return null;
      }
    }

    const parsed = llmParseSchema.safeParse(parsedRaw);
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

// --- Candidate retrieval/ranking for add resolution --------------------------
function offeringNameToCode(offeringName: string): string {
  const parts = offeringName.split(".");
  if (parts.length >= 3) return `${parts[1]}.${parts[2]}`;
  return offeringName;
}

function toCourseId(offeringName: string, term: string): string {
  return `${offeringName.toLowerCase().replace(/\./g, "-")}-${term.toLowerCase().replace(/\s+/g, "-")}`;
}

function candidateKey(candidate: SearchCandidate): string {
  return `${normalizeCourseCode(candidate.code)}|${normalizeOfferingName(candidate.sisOfferingName)}|${candidate.term.toLowerCase()}`;
}

function tokenOverlap(a: string, b: string): number {
  const aTokens = new Set(a.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
  const bTokens = new Set(b.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap++;
  }
  return overlap;
}

// Normalize titles before lexical matching so punctuation/casing do not affect confidence.
function normalizeTitle(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(input: string): string[] {
  return normalizeTitle(input)
    .split(" ")
    .filter((token) => token.length > 2);
}

// Score title similarity conservatively; false positives should fall back to clarification.
function titleSimilarityScore(refTitle: string, candidateTitle: string): number {
  const normalizedRef = normalizeTitle(refTitle);
  const normalizedCandidate = normalizeTitle(candidateTitle);
  if (!normalizedRef || !normalizedCandidate) return 0;
  if (normalizedRef === normalizedCandidate) return 100;
  if (normalizedCandidate.includes(normalizedRef) || normalizedRef.includes(normalizedCandidate)) {
    return 80;
  }

  const refTokenSet = new Set(titleTokens(refTitle));
  const candidateTokenSet = new Set(titleTokens(candidateTitle));
  if (refTokenSet.size === 0 || candidateTokenSet.size === 0) return 0;

  let overlap = 0;
  for (const token of refTokenSet) {
    if (candidateTokenSet.has(token)) overlap++;
  }

  const precision = overlap / candidateTokenSet.size;
  const recall = overlap / refTokenSet.size;
  return Math.round((precision * 0.4 + recall * 0.6) * 100);
}

// Auto-select only when one candidate is clearly dominant; otherwise preserve ambiguity handling.
function pickConfidentAddCandidate(candidates: SearchCandidate[], ref: ParsedReference): SearchCandidate | null {
  if (candidates.length <= 1) return null;
  if (!ref.courseTitle) return null;

  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: titleSimilarityScore(ref.courseTitle!, candidate.title),
    }))
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  const second = scored[1];
  if (!top) return null;

  const margin = top.score - (second?.score ?? 0);
  const isHighConfidence = top.score >= 95 || (top.score >= 75 && margin >= 20);
  return isHighConfidence ? top.candidate : null;
}

function rankAddCandidates(
  candidates: SearchCandidate[],
  ref: ParsedReference,
  semanticScores: Map<string, number>,
): SearchCandidate[] {
  const refCode = ref.courseCode ? normalizeCourseCode(ref.courseCode) : null;
  const refOffering = ref.courseCode ? normalizeOfferingName(ref.courseCode) : null;
  const refTitle = ref.courseTitle?.toLowerCase().trim() ?? null;
  const scoreCandidate = (candidate: SearchCandidate): number => {
    let score = 0;
    if (refCode) {
      if (normalizeCourseCode(candidate.code) === refCode) score += 100;
      if (normalizeOfferingName(candidate.sisOfferingName) === refOffering) score += 100;
      if (normalizeCourseCode(candidate.code).includes(refCode)) score += 40;
    }
    if (refTitle) {
      const title = candidate.title.toLowerCase();
      if (title === refTitle) score += 70;
      if (title.includes(refTitle) || refTitle.includes(title)) score += 40;
      score += tokenOverlap(title, refTitle) * 3;
    }
    score += (semanticScores.get(candidateKey(candidate)) ?? 0) * 10;
    return score;
  };

  return [...candidates].sort((a, b) => {
    const aScore = scoreCandidate(a);
    const bScore = scoreCandidate(b);

    if (aScore !== bScore) return bScore - aScore;
    return a.title.localeCompare(b.title);
  });
}

async function defaultSearchCandidates(ref: ParsedReference, scheduleTerm: string): Promise<SearchCandidate[]> {
  if (!ref.courseCode && !ref.courseTitle) return [];

  // Structured SIS search is the primary source of truth for explicit code/title lookups.
  const sisParams: {
    Term: string;
    CourseNumber?: string;
    CourseTitle?: string;
  } = { Term: scheduleTerm };
  if (ref.courseCode) sisParams.CourseNumber = ref.courseCode;
  if (ref.courseTitle) sisParams.CourseTitle = ref.courseTitle;

  const sisResult = await searchCoursesBySisConstraints(sisParams, 8);
  const sisCandidates: SearchCandidate[] = (sisResult.courses ?? []).map((c) => ({
    courseId: toCourseId(c.offeringName, scheduleTerm),
    code: offeringNameToCode(c.offeringName),
    title: c.title,
    description: c.description ?? "",
    sisOfferingName: c.offeringName,
    term: scheduleTerm,
  }));

  // Semantic search broadens fuzzy title matches and code fallbacks when SIS returns nothing.
  const shouldRunSemantic = Boolean(ref.courseTitle) || (Boolean(ref.courseCode) && sisCandidates.length === 0);
  const semanticScores = new Map<string, number>();
  const semanticCandidates: SearchCandidate[] = [];
  if (shouldRunSemantic) {
    const semanticQuery = ref.courseTitle ?? ref.courseCode ?? "";
    const semanticResult = await searchCourseDescriptions({ query: semanticQuery, limit: 8 });
    for (const row of semanticResult.results) {
      const candidate: SearchCandidate = {
        courseId: row.courseId,
        code: row.code,
        title: row.title,
        description: row.description,
        sisOfferingName: row.sisOfferingName,
        term: row.term,
        credits: row.credits,
      };
      semanticCandidates.push(candidate);
      semanticScores.set(candidateKey(candidate), row.relevanceScore ?? 0);
    }
  }

  // Merge both sources and keep one canonical candidate per course offering in the schedule term.
  const deduped = new Map<string, SearchCandidate>();
  for (const candidate of [...sisCandidates, ...semanticCandidates]) {
    if (candidate.term.toLowerCase() !== scheduleTerm.toLowerCase()) continue;
    const key = candidateKey(candidate);
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, candidate);
      continue;
    }
    if (!existing.description && candidate.description) {
      deduped.set(key, candidate);
    }
  }

  return rankAddCandidates([...deduped.values()], ref, semanticScores).slice(0, 6);
}

// --- Shared result shape helpers ---------------------------------------------
function candidateToCourseRef(candidate: SearchCandidate): ScheduleCourseRef {
  return {
    courseCode: candidate.code,
    sisOfferingName: candidate.sisOfferingName,
    term: candidate.term,
    courseTitle: candidate.title,
    credits: candidate.credits,
  };
}

function candidateSummary(candidate: SearchCandidate) {
  return {
    courseCode: candidate.code,
    sisOfferingName: candidate.sisOfferingName,
    term: candidate.term,
  };
}

function candidateToSearchRow(candidate: SearchCandidate): Record<string, unknown> {
  return {
    courseId: candidate.courseId,
    code: candidate.code,
    title: candidate.title,
    description: candidate.description,
    sisOfferingName: candidate.sisOfferingName,
    term: candidate.term,
    credits: candidate.credits,
  };
}

// --- Drop-side matching and fuzzy suggestions --------------------------------
function scheduleCourseMatchesRef(course: ScheduleCourseRow, ref: ParsedReference): boolean {
  if (ref.courseCode) {
    const normalizedCode = normalizeCourseCode(ref.courseCode);
    if (normalizeCourseCode(course.courseCode) === normalizedCode) return true;
    if (normalizeOfferingName(course.sisOfferingName) === normalizeOfferingName(ref.courseCode)) return true;
  }
  if (ref.courseTitle) {
    return course.courseTitle.toLowerCase().includes(ref.courseTitle.toLowerCase());
  }
  return false;
}

// Fuzzy scoring is only used for suggestions when exact in-schedule matching fails.
function fuzzyScoreForDropRef(course: ScheduleCourseRow, ref: ParsedReference): number {
  let score = 0;
  if (ref.courseCode) {
    const target = normalizeCourseCode(ref.courseCode).replace(/\./g, "");
    const code = normalizeCourseCode(course.courseCode).replace(/\./g, "");
    const offering = normalizeOfferingName(course.sisOfferingName).replace(/\./g, "");
    if (code.includes(target) || target.includes(code)) score += 6;
    if (offering.includes(target) || target.includes(offering)) score += 6;
  }
  if (ref.courseTitle) {
    const target = ref.courseTitle.toLowerCase().trim();
    const title = course.courseTitle.toLowerCase().trim();
    if (title.includes(target) || target.includes(title)) score += 8;
    const targetTokens = target.split(/\s+/).filter((t) => t.length > 2);
    const titleTokens = new Set(title.split(/\s+/));
    const overlap = targetTokens.filter((t) => titleTokens.has(t)).length;
    score += overlap * 2;
  }
  return score;
}

function getFuzzyDropCandidates(
  courses: ScheduleCourseRow[],
  ref: ParsedReference,
): SearchCandidate[] {
  return courses
    .map((course) => ({
      course,
      score: fuzzyScoreForDropRef(course, ref),
    }))
    .filter((row) => row.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((row) => toCandidateFromScheduleRow(row.course));
}

function buildFailure(
  action: "add" | "drop",
  reasonCode: ModifyScheduleFailure["reasonCode"],
  message: string,
  candidates?: SearchCandidate[],
): ModifyScheduleFailure {
  return {
    action,
    reasonCode,
    message,
    candidates: candidates?.map(candidateSummary),
  };
}

// Resolve drop refs only against current schedule contents.
async function resolveDropRef(
  ref: ParsedReference,
  context: ScheduleAgentContext,
  scheduleTerm: string,
): Promise<ResolveResult> {
  if (ref.term && ref.term.toLowerCase() !== scheduleTerm.toLowerCase()) {
    return {
      status: "failed",
      failure: buildFailure(
        "drop",
        "term_mismatch",
        `This schedule only supports edits in ${scheduleTerm}.`,
      ),
    };
  }

  const candidates = context.courses.filter((c) => scheduleCourseMatchesRef(c, ref));
  if (candidates.length === 0) {
    const fuzzyCandidates = getFuzzyDropCandidates(context.courses, ref);
    if (fuzzyCandidates.length > 0) {
      return {
        status: "failed",
        failure: buildFailure(
          "drop",
          "ambiguous_reference",
          "I couldn't find an exact in-schedule match. Did you mean one of these?",
          fuzzyCandidates,
        ),
        candidates: fuzzyCandidates,
      };
    }
    return {
      status: "failed",
      failure: buildFailure(
        "drop",
        "not_in_schedule",
        "That course is not currently in this schedule.",
      ),
    };
  }
  if (candidates.length > 1) {
    const mapped = candidates.map(toCandidateFromScheduleRow);
    return {
      status: "failed",
      failure: buildFailure(
        "drop",
        "ambiguous_reference",
        "I found multiple schedule courses that match. Please pick one.",
        mapped,
      ),
      candidates: mapped,
    };
  }

  const match = candidates[0];
  return {
    status: "resolved",
    course: {
      courseCode: match.courseCode,
      sisOfferingName: match.sisOfferingName,
      term: match.term,
      courseTitle: match.courseTitle,
      credits: match.credits ?? undefined,
    },
  };
}

// Resolve add refs against course candidates, then enforce schedule-level constraints.
async function resolveAddRef(
  ref: ParsedReference,
  context: ScheduleAgentContext,
  scheduleTerm: string,
  deps: ScheduleEditDeps,
): Promise<ResolveResult> {
  if (ref.term && ref.term.toLowerCase() !== scheduleTerm.toLowerCase()) {
    return {
      status: "failed",
      failure: buildFailure(
        "add",
        "term_mismatch",
        `This schedule only supports edits in ${scheduleTerm}.`,
      ),
    };
  }

  if (!ref.courseCode && !ref.courseTitle) {
    return {
      status: "failed",
      failure: buildFailure(
        "add",
        "ambiguous_reference",
        "Please specify which course to add.",
      ),
    };
  }

  const searchFn = deps.searchCandidates ?? defaultSearchCandidates;
  const candidates = await searchFn(ref, scheduleTerm);
  if (candidates.length === 0) {
    return {
      status: "failed",
      failure: buildFailure("add", "not_found", "I couldn't find a matching course in this term."),
    };
  }

  const scheduleKeySet = new Set(
    context.courses.map(
      (c) => `${normalizeCourseCode(c.courseCode)}|${normalizeOfferingName(c.sisOfferingName)}|${c.term.toLowerCase()}`,
    ),
  );

  const exactCode = ref.courseCode ? normalizeCourseCode(ref.courseCode) : null;
  const exactMatches = exactCode
    ? candidates.filter((c) => normalizeCourseCode(c.code) === exactCode || normalizeOfferingName(c.sisOfferingName) === normalizeOfferingName(ref.courseCode!))
    : candidates;

  const poolCandidates = exactMatches.length > 0 ? exactMatches : candidates;

  if (poolCandidates.length > 1) {
    const confidentCandidate = pickConfidentAddCandidate(poolCandidates, ref);
    if (confidentCandidate) {
      const confidentKey = `${normalizeCourseCode(confidentCandidate.code)}|${normalizeOfferingName(confidentCandidate.sisOfferingName)}|${confidentCandidate.term.toLowerCase()}`;
      if (scheduleKeySet.has(confidentKey)) {
        return {
          status: "failed",
          failure: buildFailure("add", "already_in_schedule", "That course is already in this schedule."),
        };
      }

      return {
        status: "resolved",
        course: candidateToCourseRef(confidentCandidate),
      };
    }

    return {
      status: "failed",
      failure: buildFailure(
        "add",
        "ambiguous_reference",
        "I found multiple matching courses. Please choose one.",
        poolCandidates,
      ),
      candidates: poolCandidates,
    };
  }

  const selected = poolCandidates[0];
  const key = `${normalizeCourseCode(selected.code)}|${normalizeOfferingName(selected.sisOfferingName)}|${selected.term.toLowerCase()}`;
  if (scheduleKeySet.has(key)) {
    return {
      status: "failed",
      failure: buildFailure("add", "already_in_schedule", "That course is already in this schedule."),
    };
  }

  return {
    status: "resolved",
    course: candidateToCourseRef(selected),
  };
}

// --- Mutation executor (deterministic DB writes) -----------------------------
async function defaultRunModify(input: {
  scheduleId: string;
  operation: ScheduleOperation;
  addCourses: ScheduleCourseRef[];
  dropCourses: ScheduleCourseRef[];
  preflightFailures: ModifyScheduleFailure[];
}): Promise<ModifyScheduleCoursesOutput> {
  return modifyScheduleCourses(
    {
      scheduleId: input.scheduleId,
      operation: input.operation,
      addCourses: input.addCourses,
      dropCourses: input.dropCourses,
    },
    {
      preflightFailures: input.preflightFailures,
      addCourse: async (course) => {
        const inserted = await pool.query(
          `INSERT INTO schedule_courses (schedule_id, course_code, sis_offering_name, term, title, credits)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING
           RETURNING 1`,
          [
            input.scheduleId,
            course.courseCode,
            course.sisOfferingName,
            course.term,
            course.courseTitle?.trim() ?? "",
            course.credits ?? null,
          ],
        );
        return { added: (inserted.rowCount ?? 0) > 0 };
      },
      dropCourse: async (course) => {
        const removed = await pool.query(
          `DELETE FROM schedule_courses
           WHERE schedule_id = $1 AND course_code = $2 AND sis_offering_name = $3 AND term = $4
           RETURNING 1`,
          [input.scheduleId, course.courseCode, course.sisOfferingName, course.term],
        );
        return { removed: (removed.rowCount ?? 0) > 0 };
      },
    },
  );
}

function buildSuccessMessage(operation: ScheduleOperation, result: ModifyScheduleCoursesOutput): string {
  const addCount = result.added.length;
  const dropCount = result.removed.length;
  const failCount = result.failed.length;

  if (operation === "add" && failCount === 0) return `Added ${addCount} course${addCount === 1 ? "" : "s"} to your schedule.`;
  if (operation === "drop" && failCount === 0) return `Dropped ${dropCount} course${dropCount === 1 ? "" : "s"} from your schedule.`;
  if (operation === "replace" && failCount === 0) return "Updated your schedule.";
  if (failCount > 0 && (addCount > 0 || dropCount > 0)) return "I made the changes I could, but some requests need clarification.";
  if (failCount > 0 && addCount === 0 && dropCount === 0) {
    const firstSpecificFailure = result.failed.find((f) => typeof f.message === "string" && f.message.trim() !== "");
    if (firstSpecificFailure) return firstSpecificFailure.message;
  }
  return "I couldn't apply that schedule change yet.";
}

function buildHandledPayload(
  operation: ScheduleOperation,
  result: ModifyScheduleCoursesOutput,
  candidates: SearchCandidate[],
): AgentEditPayload {
  const base = {
    operation,
    added: result.added,
    removed: result.removed,
    failed: result.failed,
  };

  if (result.failed.some((f) => f.reasonCode === "ambiguous_reference") && candidates.length > 0) {
    const specificAmbiguousMessage = result.failed.find(
      (f) => f.reasonCode === "ambiguous_reference" && typeof f.message === "string" && f.message.trim() !== "",
    )?.message;
    return {
      type: "search",
      message: specificAmbiguousMessage ?? "I found multiple candidate courses. Please choose one.",
      results: candidates.map(candidateToSearchRow),
      scheduleChanges: base,
    };
  }

  return {
    type: "text",
    message: buildSuccessMessage(operation, result),
    scheduleChanges: base,
  };
}

// Main entry point: parse -> resolve -> mutate -> shape agent response.
export async function handleScheduleEditMessage(
  input: { userId: string; scheduleId?: string; message: string },
  deps: ScheduleEditDeps = {},
): Promise<EditHandledResult> {
  if (!input.scheduleId) return { handled: false };

  const intent = detectScheduleModificationIntent(input.message);
  logScheduleEdit("intent_detected", {
    scheduleId: input.scheduleId,
    operation: intent.operation,
    isScheduleModification: intent.isScheduleModification,
    message: input.message,
  });
  if (!intent.isScheduleModification) {
    return { handled: false };
  }

  const loadContext = deps.loadContext ?? loadScheduleContextForAgent;
  const loaded = await loadContext(input.userId, input.scheduleId);
  if (!loaded.ok) {
    logScheduleEdit("context_load_failed", {
      scheduleId: input.scheduleId,
      error: loaded.error,
    });
    return {
      handled: true,
      payload: {
        type: "text",
        message: loaded.error === "forbidden" ? "Forbidden" : "Schedule not found",
        scheduleChanges: {
          operation: intent.operation,
          added: [],
          removed: [],
          failed: [
            {
              action: "add",
              reasonCode: loaded.error === "forbidden" ? "forbidden" : "not_found",
              message: loaded.error === "forbidden" ? "Forbidden" : "Schedule not found",
            },
          ],
        },
      },
    };
  }

  const context = loaded.context;
  const scheduleTerm = context.scheduleTerm;
  const sides = getSideTexts(input.message, intent.operation);
  const llmParser = deps.parseWithLlm ?? defaultLlmParse;
  let parsed: ParsedEdit | null = deterministicParse(intent.operation, sides);
  let cachedLlmParsed: ParsedEdit | null = null;
  logScheduleEdit("deterministic_parse", {
    operation: parsed.operation,
    addRefCount: parsed.addRefs.length,
    dropRefCount: parsed.dropRefs.length,
    addRefs: parsed.addRefs,
    dropRefs: parsed.dropRefs,
  });
  const mergedTitles = await maybeMergeLlmTitles(input.message, intent.operation, sides, parsed, llmParser);
  parsed = mergedTitles.parsed;
  cachedLlmParsed = mergedTitles.llmParsed;
  if (cachedLlmParsed) {
    logScheduleEdit("llm_title_merge", {
      operation: parsed.operation,
      addRefCount: parsed.addRefs.length,
      dropRefCount: parsed.dropRefs.length,
      addRefs: parsed.addRefs,
      dropRefs: parsed.dropRefs,
    });
  }

  if (!hasSufficientRefs(parsed)) {
    const llmParsed = cachedLlmParsed ?? (await llmParser(input.message, intent.operation));
    if (llmParsed) parsed = llmParsed;
    logScheduleEdit("llm_fallback_parse", {
      hasLlmParsed: Boolean(llmParsed),
      operation: parsed?.operation,
      addRefCount: parsed?.addRefs.length ?? 0,
      dropRefCount: parsed?.dropRefs.length ?? 0,
      addRefs: parsed?.addRefs ?? [],
      dropRefs: parsed?.dropRefs ?? [],
    });
  }

  if (!parsed || !hasSufficientRefs(parsed)) {
    const clarification = "Please clarify which course(s) you want to add or drop.";
    logScheduleEdit("clarification_required", {
      reason: "insufficient_references",
      operation: intent.operation,
    });
    return {
      handled: true,
      payload: {
        type: "text",
        message: clarification,
        scheduleChanges: {
          operation: intent.operation,
          added: [],
          removed: [],
          failed: [
            {
              action: intent.operation === "drop" ? "drop" : "add",
              reasonCode: "ambiguous_reference",
              message: clarification,
            },
          ],
        },
      },
    };
  }

  const addResolved: ScheduleCourseRef[] = [];
  const dropResolved: ScheduleCourseRef[] = [];
  const failures: ModifyScheduleFailure[] = [];
  const ambiguousCandidates: SearchCandidate[] = [];

  for (const ref of parsed.dropRefs) {
    const resolved = await resolveDropRef(ref, context, scheduleTerm);
    if (resolved.status === "resolved") {
      dropResolved.push(resolved.course);
    } else {
      failures.push(resolved.failure);
      if (resolved.candidates) ambiguousCandidates.push(...resolved.candidates);
    }
  }

  for (const ref of parsed.addRefs) {
    const resolved = await resolveAddRef(ref, context, scheduleTerm, deps);
    if (resolved.status === "resolved") {
      addResolved.push(resolved.course);
    } else {
      failures.push(resolved.failure);
      if (resolved.candidates) ambiguousCandidates.push(...resolved.candidates);
    }
  }

  const runModify = deps.runModify ?? defaultRunModify;
  logScheduleEdit("resolution_complete", {
    operation: parsed.operation,
    resolvedAdds: addResolved.map((c) => ({
      courseCode: c.courseCode,
      sisOfferingName: c.sisOfferingName,
      term: c.term,
    })),
    resolvedDrops: dropResolved.map((c) => ({
      courseCode: c.courseCode,
      sisOfferingName: c.sisOfferingName,
      term: c.term,
    })),
    failureCount: failures.length,
    failures,
  });
  const output = await runModify({
    scheduleId: input.scheduleId,
    operation: parsed.operation,
    addCourses: addResolved,
    dropCourses: dropResolved,
    preflightFailures: failures,
  });

  logScheduleEdit("modify_result", {
    operation: parsed.operation,
    addedCount: output.added.length,
    removedCount: output.removed.length,
    failureCount: output.failed.length,
    failed: output.failed,
    needsClarification: output.needsClarification,
  });

  return {
    handled: true,
    payload: buildHandledPayload(parsed.operation, output, ambiguousCandidates),
  };
}
