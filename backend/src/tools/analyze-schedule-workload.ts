/**
 * analyzeScheduleWorkload — Issue #118
 *
 * Given a schedule's courses, per-course evaluation metrics, and user profile/memories,
 * calls the LLM to produce a structured workload audit (ScheduleAuditResult).
 */

import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { formatAuditMemoryContext, ScheduleAgentContext } from "../services/schedule-context";
import {
  ScheduleAuditRecommendation,
  ScheduleAuditResult,
  ScheduleGoalAlignment,
} from "../types/database";
import { AuditEvalMetrics } from "../types/eval-summary";

// ---------------------------------------------------------------------------
// Deterministic workload calculation
// hours_per_credit(score) = 2 + (score - 3) * 0.5
// score=1 → 1.0 hr/credit, score=3 → 2.0 hr/credit, score=5 → 3.0 hr/credit
// Courses missing eval data fall back to score=3 (neutral).
// ---------------------------------------------------------------------------

export function calculateWorkloadRange(
  courses: ScheduleAgentContext["courses"],
  evalsByCourse: Record<string, AuditEvalMetrics | null>,
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
  goalAlignment: z.object({
    score: z.number().min(0).max(5).nullable(),
    rationale: z.string(),
    alignedGoals: z.array(z.string()),
    conflicts: z.array(z.string()),
  }).nullable(),
  recommendations: z.array(z.string()),
});
type LlmAuditResult = z.infer<typeof llmAuditSchema>;

function collectDeclaredGoals(context: ScheduleAgentContext): string[] {
  const goals = new Set<string>();
  const profileGoal = context.profile?.rawGoalsText?.trim();
  if (profileGoal) goals.add(profileGoal);

  for (const memory of context.canonicalMemories) {
    if (memory.memory_type === "goal" || memory.memory_type === "constraint") {
      const text = memory.memory_text.trim();
      if (text) goals.add(text);
    }
  }

  return [...goals];
}

export function buildDefaultGoalAlignment(
  context: ScheduleAgentContext,
): ScheduleGoalAlignment {
  const declaredGoals = collectDeclaredGoals(context);
  if (declaredGoals.length === 0) {
    return {
      score: null,
      rationale: "No explicit goals or constraints were available, so goal alignment could not be scored confidently.",
      alignedGoals: [],
      conflicts: [],
    };
  }

  return {
    score: null,
    rationale: "Goal alignment needs to be interpreted from the student's stated goals, preferences, and available schedule data.",
    alignedGoals: declaredGoals,
    conflicts: [],
  };
}

export function normalizeGoalAlignment(
  goalAlignment: LlmAuditResult["goalAlignment"],
  context: ScheduleAgentContext,
): ScheduleGoalAlignment {
  const fallback = buildDefaultGoalAlignment(context);
  if (!goalAlignment) {
    return fallback;
  }

  return {
    score: goalAlignment.score,
    rationale: goalAlignment.rationale.trim() || fallback.rationale,
    alignedGoals: goalAlignment.alignedGoals.filter((goal) => goal.trim().length > 0),
    conflicts: goalAlignment.conflicts.filter((conflict) => conflict.trim().length > 0),
  };
}

export function groundAuditRecommendations(
  selectedOfferingNames: string[],
  candidates: ScheduleAuditRecommendation[],
): ScheduleAuditRecommendation[] {
  const byOffering = new Map(
    candidates.map((candidate) => [candidate.sisOfferingName, candidate] as const),
  );

  return selectedOfferingNames
    .map((offeringName) => byOffering.get(offeringName))
    .filter((candidate): candidate is ScheduleAuditRecommendation => Boolean(candidate))
    .map((candidate) => ({
      courseCode: candidate.courseCode,
      sisOfferingName: candidate.sisOfferingName,
      term: candidate.term,
      title: candidate.title,
    }));
}

function toScheduleAuditResult(
  result: LlmAuditResult,
  workloadRange: { min: number; max: number } | null,
  context: ScheduleAgentContext,
  recommendationCandidates: ScheduleAuditRecommendation[],
): ScheduleAuditResult {
  return {
    narrativeSummary: result.narrativeSummary,
    ...(workloadRange ? { workloadRange } : {}),
    ...(result.difficulty !== null ? { difficulty: result.difficulty } : {}),
    ...(result.feasibilityLabel ? { feasibilityLabel: result.feasibilityLabel } : {}),
    goalAlignment: normalizeGoalAlignment(result.goalAlignment, context),
    recommendations: groundAuditRecommendations(result.recommendations, recommendationCandidates),
  };
}

type GenerateAuditObject = (args: {
  model: ReturnType<typeof openai>;
  schema: typeof llmAuditSchema;
  system: string;
  prompt: string;
}) => Promise<{ object: LlmAuditResult }>;

const generateAuditObject = generateObject as unknown as GenerateAuditObject;

function fmt(n: number | null | undefined): string {
  return typeof n === "number" ? n.toFixed(2) : "n/a";
}

function buildPrompt(
  context: ScheduleAgentContext,
  evalsByCourse: Record<string, AuditEvalMetrics | null>,
  workloadRange: { min: number; max: number } | null,
  recommendationCandidates: Array<
    ScheduleAuditRecommendation & {
      overallQuality?: number | null;
      workload?: number | null;
      difficulty?: number | null;
      respondentCount?: number;
    }
  >,
): string {
  const { scheduleName, scheduleTerm, courses, profile } = context;

  const courseRows = courses.map((c) => {
    const e = evalsByCourse[c.courseCode];
    const credits = c.credits != null ? String(c.credits) : "n/a";
    if (!e) {
      return `| ${c.courseCode} | ${c.courseTitle || "(no title)"} | ${credits} | no eval data | no eval data | no eval data | no eval data | 0 |`;
    }
    return `| ${c.courseCode} | ${c.courseTitle || "(no title)"} | ${credits} | ${fmt(e.workload)} | ${fmt(e.difficulty)} | ${fmt(e.overallQuality)} | ${fmt(e.feedbackQuality)} | ${e.sampleSize} |`;
  });

  const courseTable = [
    `| Code | Title | Credits | Workload (/5) | Difficulty (/5) | Quality (/5) | Feedback (/5) | Respondents |`,
    `|------|-------|---------|----------------|------------------|--------------|----------------|-------------|`,
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
      ]
        .filter(Boolean)
        .join("\n")
    : "No profile available.";

  const memorySection = formatAuditMemoryContext(context.canonicalMemories, profile);

  const dataNotes = courses
    .map((course) => {
      const metrics = evalsByCourse[course.courseCode];
      if (!metrics) {
        return `- ${course.courseCode}: no evaluation data available.`;
      }
      const missingFields = [
        metrics.workload === null ? "workload" : null,
        metrics.difficulty === null ? "difficulty" : null,
        metrics.overallQuality === null ? "quality" : null,
        metrics.feedbackQuality === null ? "feedback" : null,
        metrics.teachingEffectiveness === null ? "teaching" : null,
      ].filter(Boolean);
      if (missingFields.length === 0) return null;
      return `- ${course.courseCode}: partial evaluation data; missing ${missingFields.join(", ")}.`;
    })
    .filter(Boolean)
    .join("\n");

  const recommendationLines = recommendationCandidates.length > 0
    ? recommendationCandidates.map((candidate) => {
        const metrics = [
          typeof candidate.overallQuality === "number" ? `quality ${candidate.overallQuality.toFixed(2)}` : null,
          typeof candidate.workload === "number" ? `workload ${candidate.workload.toFixed(2)}` : null,
          typeof candidate.difficulty === "number" ? `difficulty ${candidate.difficulty.toFixed(2)}` : null,
          typeof candidate.respondentCount === "number" && candidate.respondentCount > 0
            ? `${candidate.respondentCount} respondents`
            : null,
        ].filter(Boolean).join(", ");
        return `- ${candidate.sisOfferingName} | ${candidate.title} | ${candidate.term}${metrics ? ` | ${metrics}` : ""}`;
      }).join("\n")
    : "No grounded same-term alternatives were found from SIS offerings.";

  return `Schedule: "${scheduleName}" (${scheduleTerm})

${workloadLine}

Courses:
${courseTable}

Evaluation Data Notes:
${dataNotes || "None."}

Grounded alternative candidates (real SIS offerings only; recommendations must come only from this list):
${recommendationLines}

Student Profile:
${profileSection}

Long-term memories (same canonical store as schedule chat and agent; use for goal alignment and preferences):
${memorySection}

Audit requirements:
- Use the pre-calculated workload range exactly as provided; do not recalculate it.
- Reason in this order: workload and credits, course mix, evaluation data quality, then student goals/preferences.
- If evaluation data is missing or partial, say so explicitly and avoid overstating confidence.
- If the student's goals and stated workload tolerance conflict, explain the tradeoff directly and recommend the least-bad option grounded in the listed courses only.
- Keep the narrativeSummary to 3-5 sentences with stable phrasing for similar schedules.
- goalAlignment must be an object with { score, rationale, alignedGoals, conflicts }.
- recommendations must be an array of SIS offering names chosen only from the grounded alternative candidate list above.
- If there is not enough data to recommend an alternative confidently, return an empty recommendations array and say so explicitly in the rationale or summary.`;
}

export async function analyzeScheduleWorkload(
  context: ScheduleAgentContext,
  evalsByCourse: Record<string, AuditEvalMetrics | null>,
  recommendationCandidates: Array<
    ScheduleAuditRecommendation & {
      overallQuality?: number | null;
      workload?: number | null;
      difficulty?: number | null;
      respondentCount?: number;
    }
  > = [],
): Promise<ScheduleAuditResult> {
  if (context.courses.length === 0) {
    return {
      narrativeSummary: "No course added",
      goalAlignment: buildDefaultGoalAlignment(context),
      recommendations: [],
    };
  }

  const workloadRange = calculateWorkloadRange(context.courses, evalsByCourse);

  const { object } = await generateAuditObject({
    model: openai("gpt-4o-mini"),
    schema: llmAuditSchema,
    system:
      "You are an academic advisor analyzing a student's course schedule. " +
      "Given their courses, evaluation metrics, student profile, and long-term memories (when present), produce a structured workload audit. " +
      "The weekly workload range is pre-calculated and provided — reference it in your narrative. " +
      "Be honest about uncertainty when evaluation data is missing. " +
      "Workload scale is 1–5 (5 = heaviest). " +
      "Use stable wording for similar inputs and avoid unsupported claims.\n\n" +
      "FEASIBILITY LABEL RULES (follow strictly in order):\n" +
      "1. If the schedule has fewer than 3 courses, feasibilityLabel MUST be 'light'.\n" +
      "2. If the total credits across all courses exceed 20, feasibilityLabel MUST be 'heavy'.\n" +
      "3. If 3 or more courses are math-heavy (e.g. calculus, statistics, linear algebra, differential equations, probability, discrete math) or writing-heavy (e.g. writing, composition, literature, seminar, rhetoric, essay), feasibilityLabel MUST be 'heavy'.\n" +
      "4. Otherwise, use your judgment based on the course mix and eval data.\n\n" +
      "OUTPUT RULES:\n" +
      "- If data is missing, acknowledge the exact limitation instead of guessing.\n" +
      "- goalAlignment should explain fit with the student's stated goals and long-term memories when relevant. If no explicit goals exist, say that clearly and use score=null.\n" +
      "- recommendations should contain SIS offering names from the provided grounded candidate list only, or be an empty array when no defensible recommendation exists.",
    prompt: buildPrompt(context, evalsByCourse, workloadRange, recommendationCandidates),
  });
  return toScheduleAuditResult(object, workloadRange, context, recommendationCandidates);
}
