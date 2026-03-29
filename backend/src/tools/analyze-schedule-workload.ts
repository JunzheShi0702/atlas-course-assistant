/**
 * analyzeScheduleWorkload — Issue #118
 *
 * Given a schedule's courses, per-course evaluation metrics, and user profile/memories,
 * calls the LLM to produce a structured workload audit (ScheduleAuditResult).
 */

import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { ScheduleAgentContext } from "../services/schedule-context";
import { ScheduleAuditResult } from "../types/database";
import { EvalMetrics } from "../types/eval-summary";

// ---------------------------------------------------------------------------
// Deterministic workload calculation
// hours_per_credit(score) = 2 + (score - 3) * 0.5
// score=1 → 1.0 hr/credit, score=3 → 2.0 hr/credit, score=5 → 3.0 hr/credit
// Courses missing eval data fall back to score=3 (neutral).
// ---------------------------------------------------------------------------

export function calculateWorkloadRange(
  courses: ScheduleAgentContext["courses"],
  evalsByCourse: Record<string, EvalMetrics | null>,
): { min: number; max: number } | null {
  if (courses.length === 0) return null;

  let hasAnyCreditData = false;
  let pointEstimate = 0;

  for (const course of courses) {
    const credits = course.credits;
    if (credits == null) continue;
    hasAnyCreditData = true;

    const score = evalsByCourse[course.courseCode]?.workload ?? 3;
    const hrsPerCredit = 2 + (score - 3) * 0.5;
    pointEstimate += credits * hrsPerCredit;
  }

  if (!hasAnyCreditData) return null;

  return {
    min: Math.round(pointEstimate * 0.85),
    max: Math.round(pointEstimate * 1.15),
  };
}

// ---------------------------------------------------------------------------
// LLM schema — workloadRange excluded; calculated deterministically above
// ---------------------------------------------------------------------------

const llmAuditSchema = z.object({
  difficulty: z.number().min(1).max(5).nullable(),
  feasibilityLabel: z.enum(["light", "moderate", "heavy", "extreme"]).nullable(),
  narrativeSummary: z.string(),
  goalAlignment: z.string().nullable(),
  recommendations: z.array(z.string()).nullable(),
});
type LlmAuditResult = z.infer<typeof llmAuditSchema>;

function toScheduleAuditResult(
  result: LlmAuditResult,
  workloadRange: { min: number; max: number } | null,
): ScheduleAuditResult {
  return {
    narrativeSummary: result.narrativeSummary,
    ...(workloadRange ? { workloadRange } : {}),
    ...(result.difficulty !== null ? { difficulty: result.difficulty } : {}),
    ...(result.feasibilityLabel ? { feasibilityLabel: result.feasibilityLabel } : {}),
    ...(result.goalAlignment !== null ? { goalAlignment: result.goalAlignment } : {}),
    ...(result.recommendations ? { recommendations: result.recommendations } : {}),
  };
}

type GenerateAuditObject = (args: {
  model: ReturnType<typeof openai>;
  schema: typeof llmAuditSchema;
  system: string;
  prompt: string;
}) => Promise<{ object: LlmAuditResult }>;

const generateAuditObject = generateObject as unknown as GenerateAuditObject;

function fmt(n: number | undefined): string {
  return n !== undefined ? n.toFixed(2) : "n/a";
}

function buildPrompt(
  context: ScheduleAgentContext,
  evalsByCourse: Record<string, EvalMetrics | null>,
  workloadRange: { min: number; max: number } | null,
): string {
  const { scheduleName, scheduleTerm, courses, profile } = context;

  const courseRows = courses.map((c) => {
    const e = evalsByCourse[c.courseCode];
    const credits = c.credits != null ? String(c.credits) : "n/a";
    if (!e) {
      return `| ${c.courseCode} | ${c.courseTitle || "(no title)"} | ${credits} | no eval data | no eval data | no eval data |`;
    }
    return `| ${c.courseCode} | ${c.courseTitle || "(no title)"} | ${credits} | ${fmt(e.workload)} | ${fmt(e.difficulty)} | ${fmt(e.overallQuality)} |`;
  });

  const courseTable = [
    `| Code | Title | Credits | Workload (/5) | Difficulty (/5) | Quality (/5) |`,
    `|------|-------|---------|--------------|-----------------|--------------|`,
    ...courseRows,
  ].join("\n");

  const workloadLine = workloadRange
    ? `Pre-calculated weekly workload: ${workloadRange.min}–${workloadRange.max} hrs/week (deterministic; use this in your narrative).`
    : "Weekly workload could not be calculated (no credit data available).";

  const profileSection = profile
    ? [
        profile.school ? `School: ${profile.school}` : null,
        profile.degrees?.length ? `Degrees: ${profile.degrees.join(", ")}` : null,
        profile.rawGoalsText ? `Goals: ${profile.rawGoalsText.slice(0, 1000)}` : null,
        profile.rawWorkloadText ? `Workload tolerance: ${profile.rawWorkloadText.slice(0, 500)}` : null,
        profile.rawPreferencesText ? `Preferences: ${profile.rawPreferencesText.slice(0, 500)}` : null,
        profile.derivedMemories
          ? `Memories: ${JSON.stringify(profile.derivedMemories).slice(0, 1000)}`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "No profile available.";

  return `Schedule: "${scheduleName}" (${scheduleTerm})

${workloadLine}

Courses:
${courseTable}

Student Profile:
${profileSection}`;
}

export async function analyzeScheduleWorkload(
  context: ScheduleAgentContext,
  evalsByCourse: Record<string, EvalMetrics | null>,
): Promise<ScheduleAuditResult> {
  const workloadRange = calculateWorkloadRange(context.courses, evalsByCourse);

  const { object } = await generateAuditObject({
    model: openai("gpt-4o-mini"),
    schema: llmAuditSchema,
    system:
      "You are an academic advisor analyzing a student's course schedule. " +
      "Given their courses, evaluation metrics, and personal profile, produce a structured workload audit. " +
      "The weekly workload range is pre-calculated and provided — reference it in your narrative. " +
      "Be honest about uncertainty when evaluation data is missing. " +
      "Workload scale is 1–5 (5 = heaviest).",
    prompt: buildPrompt(context, evalsByCourse, workloadRange),
  });
  return toScheduleAuditResult(object, workloadRange);
}
