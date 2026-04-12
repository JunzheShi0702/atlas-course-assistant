import { pool } from "../db";
import { resolveEvalCourseCode, weightedAvgOrNull, type EvalRow } from "./get-course-eval-summary";

export interface CourseMetrics {
  workload: number | null;
  difficulty: number | null;
  overallQuality: number | null;
  respondentCount: number;
}

export interface QueryCourseMetricsResult {
  courseCode: string;
  term: string;
  metrics: CourseMetrics | null;
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
    && metrics.respondentCount === 0
  ) {
    return null;
  }

  return metrics;
}

/**
 * Rounding policy: weighted metric aggregates are rounded to 2 decimal places
 * via weightedAvgOrNull so tool output remains stable numeric JSON.
 */
export async function queryCourseMetrics(
  courseCode: string,
  term: string,
): Promise<QueryCourseMetricsResult> {
  const resolvedCourseCode = await resolveEvalCourseCode(courseCode);
  const normalizedTerm = normalizeCourseMetricsTerm(term);
  const { rows } = await pool.query<EvalRow>(
    `SELECT
       semester,
       instructor,
       overall_quality,
       teaching_effectiveness,
       intellectual_challange,
       work_load,
       feedback_quality,
       num_respondents
     FROM course_evaluations
     WHERE course_code = $1 AND semester = $2`,
    [resolvedCourseCode, normalizedTerm],
  );

  const metrics = aggregateCourseMetrics(rows);
  if (metrics === null) {
    return {
      courseCode: resolvedCourseCode,
      term: normalizedTerm,
      metrics: null,
    };
  }

  return {
    courseCode: resolvedCourseCode,
    term: normalizedTerm,
    metrics,
  };
}
