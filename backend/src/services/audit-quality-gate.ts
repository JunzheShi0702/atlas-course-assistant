import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import type { AuditEvalMetrics } from "../types/eval-summary";
import type {
  ScheduleAuditFinding,
  ScheduleAuditIncompleteCheck,
  ScheduleAuditRecommendation,
  ScheduleAuditResult,
} from "../types/database";
import {
  analyzeScheduleWorkload,
  buildDefaultGoalAlignment,
} from "../tools/analyze-schedule-workload";
import type { ScheduleAgentContext } from "./schedule-context";

const auditQualityIssueSchema = z.object({
  type: z.enum(["unsupported_claim", "missed_constraint", "contradiction"]),
  message: z.string(),
});

const auditQualityEvaluationSchema = z.object({
  passed: z.boolean(),
  issues: z.array(auditQualityIssueSchema),
});

type AuditQualityEvaluation = z.infer<typeof auditQualityEvaluationSchema>;

type GenerateAuditFn = (qualityFeedback?: string) => Promise<ScheduleAuditResult>;
type EvaluateAuditFn = (result: ScheduleAuditResult) => Promise<AuditQualityEvaluation>;
type BuildFallbackFn = () => ScheduleAuditResult;

type RunAuditWithQualityGateArgs = {
  context: ScheduleAgentContext;
  evalsByCourse: Record<string, AuditEvalMetrics | null>;
  recommendationCandidates: Array<
    ScheduleAuditRecommendation & {
      overallQuality?: number | null;
      workload?: number | null;
      difficulty?: number | null;
      respondentCount?: number;
    }
  >;
  findings: ScheduleAuditFinding[];
  incompleteChecks?: ScheduleAuditIncompleteCheck[];
  missingEvaluationData?: string[];
};

type RunAuditWithQualityGateDeps = {
  generateAudit?: GenerateAuditFn;
  evaluateAudit?: EvaluateAuditFn;
  buildFallback?: BuildFallbackFn;
};

export type AuditQualityGateOutcome = {
  result: ScheduleAuditResult;
  resolution: "pass" | "regenerated" | "fallback";
};

type GenerateAuditObject = (args: {
  model: ReturnType<typeof openai>;
  schema: typeof auditQualityEvaluationSchema;
  system: string;
  prompt: string;
}) => Promise<{ object: AuditQualityEvaluation }>;

const generateAuditEvaluatorObject = generateObject as unknown as GenerateAuditObject;

function composeAuditResult(
  draft: ScheduleAuditResult,
  findings: ScheduleAuditFinding[],
  incompleteChecks: ScheduleAuditIncompleteCheck[],
  missingEvaluationData: string[],
): ScheduleAuditResult {
  return {
    ...draft,
    findings,
    ...(incompleteChecks.length > 0 ? { incompleteChecks } : {}),
    ...(missingEvaluationData.length > 0 ? { missingEvaluationData } : {}),
  };
}

function buildEvaluatorPrompt(
  context: ScheduleAgentContext,
  result: ScheduleAuditResult,
): string {
  const courseLines = context.courses.length > 0
    ? context.courses.map((course) =>
      `- ${course.courseCode} | ${course.courseTitle || "(no title)"} | ${course.term} | credits ${course.credits ?? "n/a"}`)
        .join("\n")
    : "- No courses in schedule.";

  const preferenceText = context.profile?.rawPreferencesText?.trim() || "None provided.";
  const goalText = context.profile?.rawGoalsText?.trim() || "None provided.";
  const workloadText = context.profile?.rawWorkloadText?.trim() || "None provided.";

  return [
    `Schedule: ${context.scheduleName} (${context.scheduleTerm})`,
    "",
    "Courses:",
    courseLines,
    "",
    `Goals: ${goalText}`,
    `Workload tolerance: ${workloadText}`,
    `Preferences: ${preferenceText}`,
    "",
    "Audit response JSON to evaluate:",
    JSON.stringify(result, null, 2),
    "",
    "Evaluate whether the audit response has:",
    "- unsupported claims not grounded in the provided schedule, metrics, findings, or recommendation candidates",
    "- missed user constraints or preferences that should have been acknowledged",
    "- internal contradictions across workload, recommendations, findings, or summary text",
  ].join("\n");
}

async function evaluateAuditQuality(
  context: ScheduleAgentContext,
  result: ScheduleAuditResult,
): Promise<AuditQualityEvaluation> {
  const { object } = await generateAuditEvaluatorObject({
    model: openai("gpt-4o-mini"),
    schema: auditQualityEvaluationSchema,
    system:
      "You are an audit-quality evaluator. Validate only schedule audit responses. " +
      "Fail responses that include unsupported claims, missed user constraints/preferences, or contradictions. " +
      "Be strict and return only structured evaluation output.",
    prompt: buildEvaluatorPrompt(context, result),
  });
  return object;
}

function formatEvaluatorFeedback(evaluation: AuditQualityEvaluation): string {
  return evaluation.issues
    .map((issue, index) => `${index + 1}. [${issue.type}] ${issue.message}`)
    .join("\n");
}

function buildFallbackNarrative(
  context: ScheduleAgentContext,
  workloadRange: ScheduleAuditResult["workloadRange"],
  missingEvaluationData: string[],
  incompleteChecks: ScheduleAuditIncompleteCheck[],
): string {
  const courseCount = context.courses.length;
  const base = `Atlas could not confidently validate a generated audit narrative, so this fallback summarizes only deterministic schedule signals for ${courseCount} course${courseCount === 1 ? "" : "s"}.`;
  const workloadLine = workloadRange
    ? ` The current deterministic workload estimate is ${workloadRange.min}-${workloadRange.max} hours per week.`
    : " A deterministic workload estimate was not available from the current credit data.";
  const missingDataLine = missingEvaluationData.length > 0
    ? ` Missing evaluation data for: ${missingEvaluationData.join(", ")}.`
    : "";
  const incompleteLine = incompleteChecks.length > 0
    ? ` Incomplete audit checks: ${incompleteChecks.map((check) => check.category).join(", ")}.`
    : "";
  return `${base}${workloadLine}${missingDataLine}${incompleteLine}`;
}

function buildFallbackAuditResult(
  context: ScheduleAgentContext,
  findings: ScheduleAuditFinding[],
  incompleteChecks: ScheduleAuditIncompleteCheck[],
  missingEvaluationData: string[],
  draft: ScheduleAuditResult,
): ScheduleAuditResult {
  return composeAuditResult(
    {
      narrativeSummary: buildFallbackNarrative(
        context,
        draft.workloadRange,
        missingEvaluationData,
        incompleteChecks,
      ),
      ...(draft.workloadRange ? { workloadRange: draft.workloadRange } : {}),
      goalAlignment: buildDefaultGoalAlignment(context),
      recommendations: [],
    },
    findings,
    incompleteChecks,
    missingEvaluationData,
  );
}

export async function runAuditWithQualityGate(
  args: RunAuditWithQualityGateArgs,
  deps: RunAuditWithQualityGateDeps = {},
): Promise<AuditQualityGateOutcome> {
  const {
    context,
    evalsByCourse,
    recommendationCandidates,
    findings,
    incompleteChecks = [],
    missingEvaluationData = [],
  } = args;

  const generateAudit =
    deps.generateAudit ??
    ((qualityFeedback?: string) =>
      analyzeScheduleWorkload(
        context,
        evalsByCourse,
        recommendationCandidates,
        qualityFeedback ? { qualityFeedback } : {},
      ));
  const evaluate =
    deps.evaluateAudit ?? ((result: ScheduleAuditResult) => evaluateAuditQuality(context, result));

  const initialDraft = await generateAudit();
  const initialComposed = composeAuditResult(
    initialDraft,
    findings,
    incompleteChecks,
    missingEvaluationData,
  );
  const firstEvaluation = await evaluate(initialComposed);
  if (firstEvaluation.passed) {
    return { result: initialComposed, resolution: "pass" };
  }

  const regeneratedDraft = await generateAudit(formatEvaluatorFeedback(firstEvaluation));
  const regeneratedComposed = composeAuditResult(
    regeneratedDraft,
    findings,
    incompleteChecks,
    missingEvaluationData,
  );
  const secondEvaluation = await evaluate(regeneratedComposed);
  if (secondEvaluation.passed) {
    return { result: regeneratedComposed, resolution: "regenerated" };
  }

  const fallback =
    deps.buildFallback?.() ??
    buildFallbackAuditResult(
      context,
      findings,
      incompleteChecks,
      missingEvaluationData,
      regeneratedComposed,
    );

  return { result: fallback, resolution: "fallback" };
}
