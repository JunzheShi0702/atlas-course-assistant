/**
 * getCourseEvalSummary LLM tool — Issue #41
 *
 * Given a courseId, queries course_evaluations, aggregates quantitative
 * metrics, generates an LLM summary grounded solely in those numbers, and
 * returns summaryText + metrics + attribution. Results are cached in-memory
 * by courseId to avoid duplicate LLM calls within a server session.
 */

import OpenAI from "openai";
import { cacheCourseSummary, pool } from "../db";
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
    const totalWeight = valid.reduce((s, r) => s + r.weight!, 0);
    if (totalWeight === 0) return 0;
    return round2(
      valid.reduce((s, r) => s + r.value * r.weight!, 0) / totalWeight,
    );
  }

  // Fallback: unweighted mean
  return round2(valid.reduce((s, r) => s + r.value, 0) / valid.length);
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

export async function getCourseEvalSummary(
  courseId: string,
): Promise<CourseEvalSummaryResult> {
  // Get all semesters and any cached summaries in a single query
  const { rows: semesterCacheRows } = await pool.query<{
    semester: string;
    summary: CourseEvalSummaryResult | null;
  }>(
    `SELECT DISTINCT e.semester, c.summary 
     FROM course_evaluations e 
     LEFT JOIN course_summaries c ON e.course_code = c.course_code AND e.semester = c.term 
     WHERE e.course_code = $1`,
    [courseId]
  );

  if (!semesterCacheRows.length) {
    const result: CourseEvalSummaryResult = {
      hasData: false,
      message: "No evaluation data found for this course.",
    };
    return result;
  }

  // Sort semesters chronologically using semesterSortKey and find the latest
  const sortedSemesters = semesterCacheRows
    .map(row => row.semester)
    .filter(Boolean)
    .sort((a, b) => semesterSortKey(b).localeCompare(semesterSortKey(a))); // DESC order

  const latestTerm = sortedSemesters[0] || 'Unknown';

  // Check if we have a cached summary for the latest term
  const cachedRow = semesterCacheRows.find(row => row.semester === latestTerm);
  if (cachedRow?.summary) {
    return cachedRow.summary;
  }

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
    [courseId],
  );

  if (!rows.length) {
    const result: CourseEvalSummaryResult = {
      hasData: false,
      message: "No evaluation data found for this course.",
    };
    await cacheCourseSummary(courseId, latestTerm, result);
    return result;
  }

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

  const semesters = [...new Set(rows.map((r) => r.semester).filter(Boolean) as string[])]
    .sort((a, b) => semesterSortKey(a).localeCompare(semesterSortKey(b)));

  const totalRespondents = rows.reduce((s, r) => s + (r.num_respondents ?? 0), 0);

  const attribution: EvalAttribution = {
    instructorNames,
    termRange: {
      startTerm: semesters[0] ?? "Unknown",
      endTerm: semesters[semesters.length - 1] ?? "Unknown",
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

  await cacheCourseSummary(courseId, latestTerm, result);
  return result;
}
