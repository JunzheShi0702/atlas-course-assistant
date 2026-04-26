import {
  SEARCH_ALIGNMENT_PENALTIES,
  SEARCH_MATCH_TYPE_BASE_WEIGHTS,
} from "../tools/search-ranking-constants";
import type { ConstraintMismatchReason, SearchMatchType } from "../types/search";

type SearchRow = Record<string, unknown>;

type PreferenceMismatchReason = "days" | "time_window";

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeConstraintReasons(value: unknown): ConstraintMismatchReason[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<ConstraintMismatchReason>([
    "days",
    "time_window",
    "school",
    "level",
    "department",
    "credits",
    "writing_intensive",
    "course_number",
    "instructor",
  ]);
  return value.filter(
    (reason): reason is ConstraintMismatchReason =>
      typeof reason === "string" && allowed.has(reason as ConstraintMismatchReason),
  );
}

function normalizePreferenceReasons(value: unknown): PreferenceMismatchReason[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<PreferenceMismatchReason>(["days", "time_window"]);
  return value.filter(
    (reason): reason is PreferenceMismatchReason =>
      typeof reason === "string" && allowed.has(reason as PreferenceMismatchReason),
  );
}

function joinLabels(labels: string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function buildConstraintMismatchText(reasons: ConstraintMismatchReason[]): string {
  const labelMap: Record<ConstraintMismatchReason, string> = {
    days: "day constraints",
    time_window: "time window constraints",
    school: "school constraint",
    level: "level constraint",
    department: "department constraint",
    credits: "credit constraint",
    writing_intensive: "writing-intensive constraint",
    course_number: "course number constraint",
    instructor: "instructor constraint",
  };
  const labels = reasons.map((reason) => labelMap[reason]).filter(Boolean);
  const suffix = labels.length > 0 ? `may not satisfy ${joinLabels(labels)}.` : "may not satisfy some requested filters.";
  return `Constraint note: ${suffix}`;
}

function buildPreferenceMismatchText(reasons: PreferenceMismatchReason[]): string {
  const hasDays = reasons.includes("days");
  const hasTime = reasons.includes("time_window");
  const mismatchLabel = hasDays && hasTime
    ? "may not align with preferred days and preferred time window"
    : hasDays
      ? "may not align with preferred days"
      : hasTime
        ? "may not align with preferred time window"
        : "may not align with saved preferences";
  return `Preference note: ${mismatchLabel}.`;
}

function appendSentenceOnce(existing: string, sentence: string): string {
  if (!sentence || existing.includes(sentence)) return existing;
  return existing ? `${existing} ${sentence}` : sentence;
}

export function appendMismatchNotes(results: unknown[]): unknown[] {
  return results.map((row) => {
    if (!row || typeof row !== "object") return row;
    const result = row as SearchRow;
    const existingExplanation =
      typeof result.matchExplanation === "string" ? result.matchExplanation.trim() : "";
    let matchExplanation = existingExplanation;

    if (result.constraintAlignment === "mismatch") {
      const reasons = normalizeConstraintReasons(result.constraintMismatchReasons);
      matchExplanation = appendSentenceOnce(matchExplanation, buildConstraintMismatchText(reasons));
    }
    if (result.preferenceAlignment === "mismatch") {
      const reasons = normalizePreferenceReasons(result.preferenceMismatchReasons);
      matchExplanation = appendSentenceOnce(matchExplanation, buildPreferenceMismatchText(reasons));
    }

    if (matchExplanation === existingExplanation) return row;
    return { ...result, matchExplanation };
  });
}

function toMatchType(value: unknown): SearchMatchType {
  if (value === "exact" || value === "hybrid" || value === "constraint" || value === "semantic") {
    return value;
  }
  return "semantic";
}

function rowScore(row: SearchRow): number {
  const matchType = toMatchType(row.matchType);
  const base = SEARCH_MATCH_TYPE_BASE_WEIGHTS[matchType];
  const relevance = asFiniteNumber(row.relevanceScore) ?? 0;
  const relevanceBonus = relevance * 100;
  const clearlyMatchesBonus = row.clearlyMatches === true ? 40 : 0;

  const constraintPenalty =
    row.constraintAlignment === "mismatch" ? SEARCH_ALIGNMENT_PENALTIES.constraintMismatch : 0;
  const preferencePenalty =
    row.preferenceAlignment === "mismatch" ? SEARCH_ALIGNMENT_PENALTIES.preferenceMismatch : 0;

  return base + relevanceBonus + clearlyMatchesBonus + constraintPenalty + preferencePenalty;
}

export function applyDeterministicSearchRanking(results: unknown[]): unknown[] {
  const decorated = results.map((row, idx) => {
    const record = row && typeof row === "object" ? (row as SearchRow) : ({} as SearchRow);
    const originalRank = asFiniteNumber(record.rank) ?? Number.MAX_SAFE_INTEGER;
    const relevanceScore = asFiniteNumber(record.relevanceScore) ?? 0;
    const code = typeof record.code === "string" ? record.code.toLowerCase() : "";
    return {
      original: row,
      score: rowScore(record),
      originalRank,
      relevanceScore,
      code,
      idx,
    };
  });

  decorated.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.originalRank !== b.originalRank) return a.originalRank - b.originalRank;
    if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore;
    const codeCmp = a.code.localeCompare(b.code);
    if (codeCmp !== 0) return codeCmp;
    return a.idx - b.idx;
  });

  return decorated.map((entry, index) => {
    if (!entry.original || typeof entry.original !== "object") return entry.original;
    return {
      ...(entry.original as SearchRow),
      rank: index + 1,
    };
  });
}
