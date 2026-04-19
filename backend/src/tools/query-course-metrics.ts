import { pool } from "../db";
import {
  resolveEvalCourseCode,
  semesterSortKey,
  weightedAvgOrNull,
  type EvalRow,
} from "./get-course-eval-summary";

export interface CourseMetrics {
  workload: number | null;
  difficulty: number | null;
  overallQuality: number | null;
  respondentCount: number;
}

export type QueryCourseMetricsSource =
  | "exact_term"
  | "historical_offerings"
  | "all_available";

export interface QueryCourseMetricsResult {
  courseCode: string;
  requestedTerm: string;
  evaluationsTermRange: string | null;
  metricsSource: QueryCourseMetricsSource | null;
  term: string;
  scope: "cross-term" | "term-specific";
  meta: {
    semestersIncluded: string[];
    evaluationRowCount: number;
    termFilterApplied: string | null;
  };
  metrics: CourseMetrics | null;
}

const ALL_TERMS_LABEL = "All terms";
const CROSS_TERM_ALIASES = new Set(["all", "all terms", "overall", "any term", "any terms"]);
const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/;

const TERM_SEASON_PATTERN = /^(spring|summer 2|summer|fall|intersession)\s+(\d{4})$/i;

function normalizeMetricValue(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 5) {
    return null;
  }

  return String(parsed);
}

function normalizeRespondentCount(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.round(value);
}

export function normalizeCourseMetricsTerm(term: string): string {
  const trimmed = term.trim().replace(/\s+/g, " ");
  const match = trimmed.match(TERM_SEASON_PATTERN);
  if (!match) {
    return trimmed;
  }

  const [, season, year] = match;
  return `${season[0]!.toUpperCase()}${season.slice(1).toLowerCase()} ${year}`;
}

export function buildQueryCourseMetricsNoDataMessage(
  courseCode: string,
  term?: string,
): string {
  if (typeof term !== "string" || term.trim().length === 0) {
    return `No course evaluation metrics were found for ${courseCode} across all terms.`;
  }

  return `No course evaluation metrics were found for ${courseCode} in ${term}.`;
}

function normalizeOptionalCourseMetricsTerm(term?: string): string | null {
  if (typeof term !== "string") {
    return null;
  }

  const trimmed = term.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) {
    return null;
  }

  if (CONTROL_CHAR_PATTERN.test(trimmed)) {
    return null;
  }

  if (CROSS_TERM_ALIASES.has(trimmed.toLowerCase())) {
    return null;
  }

  return normalizeCourseMetricsTerm(trimmed);
}

function normalizeCourseCodeInput(courseCode: string): string {
  return courseCode.trim();
}

function chronologicallySortedSemesters(rows: EvalRow[]): string[] {
  const distinct = [...new Set(rows.map((r) => r.semester).filter(Boolean) as string[])];
  return distinct.sort((a, b) => semesterSortKey(a).localeCompare(semesterSortKey(b)));
}

export function formatEvaluationsTermRange(rows: EvalRow[]): string | null {
  const semesters = chronologicallySortedSemesters(rows);
  if (semesters.length === 0) {
    return null;
  }
  if (semesters.length === 1) {
    return semesters[0]!;
  }
  return `${semesters[0]!} – ${semesters[semesters.length - 1]!}`;
}

function collectSemestersIncluded(rows: EvalRow[]): string[] {
  return [...new Set(rows
    .map((row) => row.semester?.trim() ?? "")
    .filter((semester) => semester.length > 0))]
    .sort((a, b) => semesterSortKey(b).localeCompare(semesterSortKey(a)));
}

function sanitizeEvalRow(row: EvalRow): EvalRow {
  return {
    ...row,
    overall_quality: normalizeMetricValue(row.overall_quality),
    teaching_effectiveness: normalizeMetricValue(row.teaching_effectiveness),
    intellectual_challange: normalizeMetricValue(row.intellectual_challange),
    work_load: normalizeMetricValue(row.work_load),
    feedback_quality: normalizeMetricValue(row.feedback_quality),
    num_respondents: normalizeRespondentCount(row.num_respondents),
  };
}

export function aggregateCourseMetrics(rows: EvalRow[]): CourseMetrics | null {
  if (rows.length === 0) {
    return null;
  }

  const sanitizedRows = rows.map(sanitizeEvalRow);
  const metrics: CourseMetrics = {
    workload: weightedAvgOrNull(sanitizedRows, "work_load"),
    difficulty: weightedAvgOrNull(sanitizedRows, "intellectual_challange"),
    overallQuality: weightedAvgOrNull(sanitizedRows, "overall_quality"),
    respondentCount: sanitizedRows.reduce((sum, row) => sum + (row.num_respondents ?? 0), 0),
  };

  if (
    metrics.workload === null
    && metrics.difficulty === null
    && metrics.overallQuality === null
  ) {
    return null;
  }

  return metrics;
}

export async function queryCourseMetrics(
  courseCode: string,
  term?: string,
): Promise<QueryCourseMetricsResult> {
  const resolvedCourseCode = await resolveEvalCourseCode(normalizeCourseCodeInput(courseCode));
  const normalizedTerm = normalizeOptionalCourseMetricsTerm(term);

  const queryBase = `SELECT
       semester,
       instructor,
       overall_quality,
       teaching_effectiveness,
       intellectual_challange,
       work_load,
       feedback_quality,
       num_respondents
     FROM course_evaluations
     WHERE course_code = $1`;

  const queryText = normalizedTerm === null
    ? queryBase
    : `${queryBase} AND semester = $2`;
  const queryValues = normalizedTerm === null
    ? [resolvedCourseCode]
    : [resolvedCourseCode, normalizedTerm];

  const { rows } = await pool.query<EvalRow>(queryText, queryValues);

  const scope = normalizedTerm === null ? "cross-term" : "term-specific";
  const scopeTerm = normalizedTerm ?? ALL_TERMS_LABEL;
  const evaluationsTermRange = formatEvaluationsTermRange(rows);
  const metricsSource: QueryCourseMetricsSource | null = rows.length === 0
    ? null
    : scope === "term-specific"
      ? "exact_term"
      : "all_available";
  const meta = {
    semestersIncluded: collectSemestersIncluded(rows),
    evaluationRowCount: rows.length,
    termFilterApplied: normalizedTerm,
  };

  const metrics = aggregateCourseMetrics(rows);
  if (metrics === null) {
    return {
      courseCode: resolvedCourseCode,
      requestedTerm: scopeTerm,
      evaluationsTermRange,
      metricsSource: null,
      term: scopeTerm,
      scope,
      meta,
      metrics: null,
    };
  }

  return {
    courseCode: resolvedCourseCode,
    requestedTerm: scopeTerm,
    evaluationsTermRange,
    metricsSource,
    term: scopeTerm,
    scope,
    meta,
    metrics,
  };
}
