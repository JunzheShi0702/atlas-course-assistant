/**
 * getCourseEvalSummary LLM tool — Issue #41
 *
 * Given a courseId, queries course_evaluations, aggregates quantitative
 * metrics, generates an LLM summary grounded solely in those numbers, and
 * returns summaryText + metrics + attribution. Results are cached in-memory
 * by courseId to avoid duplicate LLM calls within a server session.
 */

import OpenAI from "openai";
import { getCachedCourseSummary, cacheCourseSummary, pool } from "../db";
import {
  CourseEvalSummaryResult,
  EvalAttribution,
  EvalMetrics,
} from "../types/eval-summary";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

export interface EvalRow {
  semester: string | null;
  instructor: string | null;
  overall_quality: string | null;
  teaching_effectiveness: string | null;
  intellectual_challange: string | null;
  work_load: string | null;
  feedback_quality: string | null;
  num_respondents: number | null;
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function weightedAvgOrNull(rows: EvalRow[], col: keyof EvalRow): number | null {
  const valid = rows
    .map((r) => ({
      value: r[col] !== null ? parseFloat(r[col] as string) : NaN,
      weight: r.num_respondents ?? null,
    }))
    .filter((r) => !isNaN(r.value));

  if (!valid.length) return null;

  const weighted = valid.filter((r) => r.weight !== null && r.weight! > 0);
  if (weighted.length > 0) {
    const totalWeight = weighted.reduce((sum, r) => sum + r.weight!, 0);
    if (totalWeight > 0) {
      return round2(
        weighted.reduce((sum, r) => sum + r.value * r.weight!, 0) / totalWeight,
      );
    }
  }

  return round2(valid.reduce((sum, r) => sum + r.value, 0) / valid.length);
}

/**
 * Weighted average of a metric across sections, using num_respondents as weights.
 * Falls back to an unweighted mean for any section missing a respondent count.
 */
export function weightedAvg(rows: EvalRow[], col: keyof EvalRow): number {
  const valid = rows
    .map((r) => ({
      value: r[col] !== null ? parseFloat(r[col] as string) : NaN,
      weight: r.num_respondents ?? null,
    }))
    .filter((r) => !isNaN(r.value));

  if (!valid.length) return 0;

  const allWeighted = valid.every((r) => r.weight !== null);
  if (allWeighted) {
    const totalWeight = valid.reduce((sum, r) => sum + r.weight!, 0);
    if (totalWeight === 0) return 0;
    return round2(
      valid.reduce((sum, r) => sum + r.value * r.weight!, 0) / totalWeight,
    );
  }

  return round2(valid.reduce((sum, r) => sum + r.value, 0) / valid.length);
}

/**
 * Produces a sortable key from a human-readable semester string.
 * Known formats: "Spring", "Summer", "Summer 2", "Fall", "Intersession" (winter break).
 * Order within a year: Spring → Summer → Summer 2 → Fall → Intersession
 */
export function semesterSortKey(sem: string): string {
  const year = sem.match(/\d{4}/)?.[0] ?? "0000";
  const s = sem.toLowerCase();
  const order = s.includes("spring") ? 1
    : s.includes("summer 2 ") ? 3
    : s.includes("summer") ? 2
    : s.includes("fall") ? 4
    : s.includes("intersession") ? 5
    : 6;
  return `${year}${order}`;
}

// ---------------------------------------------------------------------------
// LLM summary generation
// ---------------------------------------------------------------------------

async function generateSummaryText(
  metrics: EvalMetrics,
  attribution: EvalAttribution,
): Promise<string> {
  const { overallQuality, teachingEffectiveness, difficulty, workload, feedbackQuality } = metrics;
  const { instructorNames, termRange, sampleSize } = attribution;

  const instructorList =
    instructorNames.length > 0 ? instructorNames.join(", ") : "unknown instructors";

  const respondentLabel = `${sampleSize} student respondent${sampleSize === 1 ? "" : "s"}`;
  const prompt = `You are summarizing student course evaluation data. Generate a concise 2–3 sentence summary strictly based on the following quantitative metrics. Do not invent or assume any information beyond what is given.

Metrics are weighted averages across sections, weighted by number of respondents (${respondentLabel} total). All values are on a 5-point scale.

Metrics:
- Overall quality: ${overallQuality}
- Teaching effectiveness: ${teachingEffectiveness}
- Difficulty (intellectual challenge): ${difficulty}
- Workload: ${workload}
- Feedback quality: ${feedbackQuality}

Attribution:
- Instructors: ${instructorList}
- Term range: ${termRange.startTerm} – ${termRange.endTerm}

Write the summary in third-person and focus on what students reported.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 200,
  });

  return response.choices[0]?.message?.content?.trim() ?? "";
}

// ---------------------------------------------------------------------------
// Main tool function
// ---------------------------------------------------------------------------

/** Normalize eval lookup key; bare "###.###" is resolved via DB (AS/EN prefix). */
async function resolveEvalCourseCode(raw: string): Promise<string> {
  const t = raw.trim();
  if (/^[A-Z]{2}\.\d{3}\.\d{3}$/i.test(t)) {
    return t.toUpperCase();
  }
  if (!/^\d{3}\.\d{3}$/.test(t)) {
    return t;
  }
  const likePattern = `%.${t}`;
  const { rows: evalRows } = await pool.query<{ course_code: string }>(
    `SELECT DISTINCT course_code FROM course_evaluations
     WHERE course_code LIKE $1
     ORDER BY course_code
     LIMIT 3`,
    [likePattern],
  );
  if (evalRows.length === 1) {
    return evalRows[0]!.course_code;
  }
  if (evalRows.length > 1) {
    const asRow = evalRows.find((r) => r.course_code.startsWith("AS."));
    if (asRow) return asRow.course_code;
    const enRow = evalRows.find((r) => r.course_code.startsWith("EN."));
    if (enRow) return enRow.course_code;
    return evalRows[0]!.course_code;
  }
  const { rows: embRows } = await pool.query<{ code: string }>(
    `SELECT DISTINCT code FROM course_embeddings
     WHERE code LIKE $1
     ORDER BY code
     LIMIT 3`,
    [likePattern],
  );
  if (embRows.length === 1) {
    return embRows[0]!.code;
  }
  if (embRows.length > 1) {
    const asRow = embRows.find((r) => r.code.startsWith("AS."));
    if (asRow) return asRow.code;
    const enRow = embRows.find((r) => r.code.startsWith("EN."));
    if (enRow) return enRow.code;
    return embRows[0]!.code;
  }
  return t;
}

export async function getCourseEvalSummary(
  courseId: string,
): Promise<CourseEvalSummaryResult> {
  const resolvedCode = await resolveEvalCourseCode(courseId);

  // Check cache first - single lookup by course_code
  const cached = await getCachedCourseSummary(resolvedCode);
  if (cached) return cached;

  // Get all evaluation data for this course
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
     WHERE course_code = $1`,
    [resolvedCode],
  );

  if (!rows.length) {
    const result: CourseEvalSummaryResult = {
      hasData: false,
      message: "No evaluation data found for this course.",
    };
    // Cache with unknown term since no evals exist
    await cacheCourseSummary(resolvedCode, "Unknown", result);
    return result;
  }

  // Find latest term for cache invalidation
  const semesters = [...new Set(rows.map((r) => r.semester).filter(Boolean) as string[])]
    .sort((a, b) => semesterSortKey(b).localeCompare(semesterSortKey(a))); // DESC order
  const latestTerm = semesters[0] || 'Unknown';

  // Each row is one section; metrics are already averaged over that section's students.
  // We weight by num_respondents so larger sections contribute proportionally.
  const metrics: EvalMetrics = {
    overallQuality: weightedAvg(rows, "overall_quality"),
    teachingEffectiveness: weightedAvg(rows, "teaching_effectiveness"),
    difficulty: weightedAvg(rows, "intellectual_challange"),
    workload: weightedAvg(rows, "work_load"),
    feedbackQuality: weightedAvg(rows, "feedback_quality"),
  };

  // Build attribution
  const instructorNames = [
    ...new Set(rows.map((r) => r.instructor).filter(Boolean) as string[]),
  ];

  const totalRespondents = rows.reduce((s, r) => s + (r.num_respondents ?? 0), 0);

  const attribution: EvalAttribution = {
    instructorNames,
    termRange: {
      startTerm: semesters[semesters.length - 1] ?? "Unknown",
      endTerm: semesters[0] ?? "Unknown",
    },
    sampleSize: totalRespondents || rows.length,
  };

  const summaryText = await generateSummaryText(metrics, attribution);

  const result: CourseEvalSummaryResult = {
    hasData: true,
    summaryText,
    metrics,
    attribution,
  };

  await cacheCourseSummary(resolvedCode, latestTerm, result);
  return result;
}
