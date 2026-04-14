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
  /** Normalized term from the tool call (SIS / schedule term or user-specified). */
  requestedTerm: string;
  /**
   * Semesters whose rows were aggregated into `metrics` — cite this (not `requestedTerm`)
   * when describing where evaluation numbers come from.
   */
  evaluationsTermRange: string | null;
  metrics: CourseMetrics | null;
  /** How rows were chosen relative to `requestedTerm`. */
  metricsSource: QueryCourseMetricsSource | null;
}

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
  term: string,
): string {
  return `No course evaluation metrics were found for ${courseCode} in ${term}.`;
}

const EVAL_METRICS_SELECT = `SELECT
       semester,
       instructor,
       overall_quality,
       teaching_effectiveness,
       intellectual_challange,
       work_load,
       feedback_quality,
       num_respondents
     FROM course_evaluations`;

function chronologicallySortedSemesters(rows: EvalRow[]): string[] {
  const distinct = [...new Set(rows.map((r) => r.semester).filter(Boolean) as string[])];
  return distinct.sort((a, b) => semesterSortKey(a).localeCompare(semesterSortKey(b)));
}

/** Human-readable span of semesters (earliest – latest) for tool + model citations. */
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

function noMetricsResult(
  resolvedCourseCode: string,
  normalizedTerm: string,
): QueryCourseMetricsResult {
  return {
    courseCode: resolvedCourseCode,
    requestedTerm: normalizedTerm,
    evaluationsTermRange: null,
    metrics: null,
    metricsSource: null,
  };
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

/**
 * Rounding policy: weighted metric aggregates are rounded to 2 decimal places
 * via weightedAvgOrNull so tool output remains stable numeric JSON.
 *
 * Semester selection: we first try the requested term (e.g. the student's schedule term).
 * Course evals usually lag the current term; when that term has no (usable) rows, we
 * aggregate prior offerings (excluding the requested term), then fall back to all rows.
 */
export async function queryCourseMetrics(
  courseCode: string,
  term: string,
): Promise<QueryCourseMetricsResult> {
  const resolvedCourseCode = await resolveEvalCourseCode(courseCode);
  const normalizedTerm = normalizeCourseMetricsTerm(term);

  const { rows: exactRows } = await pool.query<EvalRow>(
    `${EVAL_METRICS_SELECT}
     WHERE course_code = $1 AND semester = $2`,
    [resolvedCourseCode, normalizedTerm],
  );

  let metrics = aggregateCourseMetrics(exactRows);
  if (metrics !== null) {
    return {
      courseCode: resolvedCourseCode,
      requestedTerm: normalizedTerm,
      evaluationsTermRange: formatEvaluationsTermRange(exactRows),
      metrics,
      metricsSource: "exact_term",
    };
  }

  const { rows: priorRows } = await pool.query<EvalRow>(
    `${EVAL_METRICS_SELECT}
     WHERE course_code = $1 AND semester IS DISTINCT FROM $2`,
    [resolvedCourseCode, normalizedTerm],
  );

  metrics = aggregateCourseMetrics(priorRows);
  if (metrics !== null) {
    return {
      courseCode: resolvedCourseCode,
      requestedTerm: normalizedTerm,
      evaluationsTermRange: formatEvaluationsTermRange(priorRows),
      metrics,
      metricsSource: "historical_offerings",
    };
  }

  const { rows: allRows } = await pool.query<EvalRow>(
    `${EVAL_METRICS_SELECT}
     WHERE course_code = $1`,
    [resolvedCourseCode],
  );

  metrics = aggregateCourseMetrics(allRows);
  if (metrics === null) {
    return noMetricsResult(resolvedCourseCode, normalizedTerm);
  }

  return {
    courseCode: resolvedCourseCode,
    requestedTerm: normalizedTerm,
    evaluationsTermRange: formatEvaluationsTermRange(allRows),
    metrics,
    metricsSource: "all_available",
  };
}
