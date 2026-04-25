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
    if (memory.memory_type === "goal") {
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
      rationale: "No explicit goals were available, so goal alignment could not be scored confidently.",
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
  _recommendationCandidates: ScheduleAuditRecommendation[],
): ScheduleAuditResult {
  return {
    narrativeSummary: result.narrativeSummary,
    ...(workloadRange ? { workloadRange } : {}),
    goalAlignment: normalizeGoalAlignment(result.goalAlignment, context),
    recommendations: [],
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
  _recommendationCandidates: Array<
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

  return `Schedule: "${scheduleName}" (${scheduleTerm})

${workloadLine}

Courses:
${courseTable}

Evaluation Data Notes:
${dataNotes || "None."}

Student Profile:
${profileSection}

Long-term memories (same canonical store as schedule chat and agent; use for goal alignment and preferences):
${memorySection}

Audit requirements:
- Use the pre-calculated workload range exactly as provided; do not recalculate it.
- Reason in this order: workload and credits, course mix, evaluation data quality, then student goals/preferences.
- If evaluation data is missing or partial, say so explicitly and avoid overstating confidence.
- If Evaluation Data Notes is "None.", do not say that explicit evaluation data is unavailable or missing. In that case, evaluation metrics are available for all listed courses.
- If Evaluation Data Notes is "None.", you may cite the provided quantitative evaluation metrics directly in the narrativeSummary or goalAlignment when they help explain workload, risk, or broad goal fit.
- If Evaluation Data Notes contains entries, be specific about which course is missing data or has only partial data. Do not replace that with a vague statement that evaluation data is generally limited.
- Keep the narrativeSummary to 2-4 sentences with stable phrasing for similar schedules.
- narrativeSummary should do only four things: summarize overall workload, name the primary risk(s), call out any notable preference mismatch or heavy-course concentration, and briefly note broad goal fit when supported by the current course titles and stated goals.
- narrativeSummary should still feel like an audit explanation for the current schedule. Mention the course mix or specific courses when that helps explain the workload, risk, or broad goal fit.
- Do not generate detailed alternative-planning advice in narrativeSummary.
- goalAlignment must be an object with { score, rationale, alignedGoals, conflicts }.
- goalAlignment.rationale should be 1-2 sentences and should not repeat the narrativeSummary.
- alignedGoals should be 1-4 short, bullet-ready factual statements. Each bullet should mention a specific course or course group and how it broadly supports one stated goal.
- conflicts should be 0-4 short, bullet-ready factual statements. Use them for concrete goal-fit limits or clear schedule/preference mismatches when supported.
- Do not dump raw preference tokens, day names, or major/minor labels into alignedGoals.
- recommendations must be an empty array for this audit workflow.`;
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
  options: { qualityFeedback?: string } = {},
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
      "Use stable wording for similar inputs and avoid unsupported claims.\n\n" +
      "OUTPUT RULES:\n" +
      "- If data is missing, acknowledge the exact limitation instead of guessing.\n" +
      "- Do not claim that evaluation data is unavailable unless the prompt explicitly says some courses have no evaluation data or partial evaluation data.\n" +
      "- When evaluation metrics are available for all listed courses, you may cite those quantitative metrics directly to explain workload, risk, or broad fit.\n" +
      "- When only some courses are missing or partial, name those specific courses and limitations instead of saying evaluation data is broadly unavailable.\n" +
      "- narrativeSummary should read like a concise audit of the current schedule, not a generic fallback. Explain the current course mix, primary risk, and broad goal fit in plain language.\n" +
      "- High-level statements like 'this schedule broadly supports software engineering goals through foundational CS coursework' are acceptable when the course titles support them.\n" +
      "- goalAlignment should explain fit with the student's stated goals and long-term memories when relevant. If no explicit goals exist, say that clearly and use score=null.\n" +
      "- goalAlignment.alignedGoals must be concise factual bullets, not a restatement of the user's raw goals.\n" +
      "- goalAlignment.conflicts should capture concrete limits or mismatches when supported; otherwise leave it empty.\n" +
      "- recommendations should contain SIS offering names from the provided grounded candidate list only, or be an empty array when no defensible recommendation exists.",
    prompt: [
      buildPrompt(context, evalsByCourse, workloadRange, recommendationCandidates),
      options.qualityFeedback
        ? [
            "",
            "Revision requirements from the audit quality evaluator:",
            options.qualityFeedback,
            "Revise the audit to resolve every issue above while staying grounded in the provided schedule, eval data, and candidate list.",
          ].join("\n")
        : "",
    ].join(""),
  });
  return toScheduleAuditResult(object, workloadRange, context, recommendationCandidates);
}
