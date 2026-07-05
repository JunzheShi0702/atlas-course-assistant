import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import type { AuditEvalMetrics } from "../types/eval-summary";
import type {
  ScheduleAuditFinding,
  ScheduleAuditIncompleteCheck,
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

function isBlockingIssue(issue: { type: string; message: string }): boolean {
  if (issue.type === "contradiction") {
    return true;
  }

  if (issue.type === "missed_constraint") {
    const message = issue.message.toLowerCase();
    return [
      "must-have",
      "must have",
      "required",
      "hard constraint",
      "non-negotiable",
      "non negotiable",
    ].some((pattern) => message.includes(pattern));
  }

  if (issue.type !== "unsupported_claim") {
    return false;
  }

  const message = issue.message.toLowerCase();
  return [
    "without explicit evaluation data",
    "no explicit evaluation data",
    "evaluation data is unavailable",
    "nonexistent",
    "invented",
    "not provided",
    "not in the schedule",
    "not in schedule",
    "not grounded",
    "specific recommendation",
    "course not in",
    "made up",
    "hallucinated",
  ].some((pattern) => message.includes(pattern));
}

function normalizeEvaluation(
  evaluation: AuditQualityEvaluation,
): AuditQualityEvaluation {
  const issues = evaluation.issues.filter(isBlockingIssue);
  return {
    passed: issues.length === 0,
    issues,
  };
}

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
    "Evaluate whether the audit response has any material problems:",
    "- unsupported claims that assert specific facts not grounded in the provided schedule, workload range, or findings",
    "- an incorrect claim that explicit evaluation data is unavailable even though missingEvaluationData is absent and the response already relies on evaluation-based workload or finding signals",
    "- a clearly missed named constraint or preference, such as a preferred time window or day preference that should have been mentioned because a finding already shows a mismatch",
    "- a direct contradiction between the summary and the deterministic findings or workload range",
    "- Broad, high-level goal-fit language is allowed when it is plausibly supported by the course titles and stated goals. Do not fail a response just because goal-fit language is cautious or approximate.",
    "- Do not fail conservative responses simply because optional fields are absent, uncertainty is acknowledged, recommendations are empty, or the response chooses not to give detailed alternatives.",
  ].join("\n");
}

async function evaluateAuditQuality(
  context: ScheduleAgentContext,
  result: ScheduleAuditResult,
): Promise<AuditQualityEvaluation> {
  const { object } = await generateAuditEvaluatorObject({
    model: openai("gpt-4.1-mini"),
    schema: auditQualityEvaluationSchema,
    temperature: 0,
    system:
      "You are an audit-quality evaluator. Validate only schedule audit responses. " +
      "Fail responses only for clearly material unsupported claims, clearly missed named user constraints/preferences, or direct contradictions with deterministic signals. " +
      "Allow broad, high-level statements about likely goal fit when they are plausibly supported by the course titles and stated goals. " +
      "Do not fail conservative responses simply because optional fields are omitted, uncertainty is acknowledged, recommendations are empty, or the response avoids detailed alternatives. " +
      "Return only structured evaluation output.",
    prompt: buildEvaluatorPrompt(context, result),
  });
  return normalizeEvaluation(object);
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
  const base = `Atlas returned a conservative audit summary based on deterministic schedule signals for ${courseCount} course${courseCount === 1 ? "" : "s"}.`;
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
        [],
        qualityFeedback ? { qualityFeedback } : {},
      ));
  const evaluate =
    deps.evaluateAudit ?? ((result: ScheduleAuditResult) => evaluateAuditQuality(context, result));
  let latestDraft: ScheduleAuditResult = {
    narrativeSummary: "",
    goalAlignment: buildDefaultGoalAlignment(context),
    recommendations: [],
  };

  try {
    const initialDraft = await generateAudit();
    latestDraft = initialDraft;
    const initialComposed = composeAuditResult(
      initialDraft,
      findings,
      incompleteChecks,
      missingEvaluationData,
    );
    const firstEvaluation = normalizeEvaluation(await evaluate(initialComposed));
    console.info("[audit-quality-gate] initial_evaluation", {
      scheduleName: context.scheduleName,
      passed: firstEvaluation.passed,
      issues: firstEvaluation.issues,
    });
    if (firstEvaluation.passed) {
      return { result: initialComposed, resolution: "pass" };
    }
    console.info("[audit-quality-gate] regenerate_after_initial_failure", {
      scheduleName: context.scheduleName,
      issues: firstEvaluation.issues,
    });

    const regeneratedDraft = await generateAudit(formatEvaluatorFeedback(firstEvaluation));
    latestDraft = regeneratedDraft;
    const regeneratedComposed = composeAuditResult(
      regeneratedDraft,
      findings,
      incompleteChecks,
      missingEvaluationData,
    );
    const secondEvaluation = normalizeEvaluation(await evaluate(regeneratedComposed));
    console.info("[audit-quality-gate] regenerated_evaluation", {
      scheduleName: context.scheduleName,
      passed: secondEvaluation.passed,
      issues: secondEvaluation.issues,
    });
    if (secondEvaluation.passed) {
      return { result: regeneratedComposed, resolution: "regenerated" };
    }
    console.info("[audit-quality-gate] fallback_after_second_failure", {
      scheduleName: context.scheduleName,
      issues: secondEvaluation.issues,
    });
  } catch (error) {
    console.warn("[audit-quality-gate] infrastructure_failure", {
      scheduleName: context.scheduleName,
      error: error instanceof Error ? error.message : String(error),
    });
    // Fall through to deterministic fallback when the quality-gate infrastructure fails.
  }

  const fallback =
    deps.buildFallback?.() ??
    buildFallbackAuditResult(
      context,
      findings,
      incompleteChecks,
      missingEvaluationData,
      latestDraft,
    );

  return { result: fallback, resolution: "fallback" };
}
