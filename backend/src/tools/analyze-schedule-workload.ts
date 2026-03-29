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

// OpenAI structured output requires every property to be in `required`.
// Zod .optional() fields are omitted from `required`, which causes a 400.
// Use .nullable() here so all fields are required but can be null.
const llmAuditSchema = z.object({
  workloadRange: z.object({ min: z.number(), max: z.number() }).nullable(),
  difficulty: z.number().min(1).max(5).nullable(),
  feasibilityLabel: z.enum(["light", "moderate", "heavy", "extreme"]).nullable(),
  narrativeSummary: z.string(),
  goalAlignment: z.string().nullable(),
  recommendations: z.array(z.string()).nullable(),
});

function fmt(n: number | undefined): string {
  return n !== undefined ? n.toFixed(2) : "n/a";
}

function buildPrompt(
  context: ScheduleAgentContext,
  evalsByCourse: Record<string, EvalMetrics | null>,
): string {
  const { scheduleName, scheduleTerm, courses, profile } = context;

  const courseRows = courses.map((c) => {
    const e = evalsByCourse[c.courseCode];
    if (!e) {
      return `| ${c.courseCode} | ${c.courseTitle || "(no title)"} | no eval data | no eval data | no eval data |`;
    }
    return `| ${c.courseCode} | ${c.courseTitle || "(no title)"} | ${fmt(e.workload)} | ${fmt(e.difficulty)} | ${fmt(e.overallQuality)} |`;
  });

  const courseTable = [
    `| Code | Title | Workload (/5) | Difficulty (/5) | Quality (/5) |`,
    `|------|-------|--------------|-----------------|--------------|`,
    ...courseRows,
  ].join("\n");

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

Courses:
${courseTable}

Student Profile:
${profileSection}`;
}

export async function analyzeScheduleWorkload(
  context: ScheduleAgentContext,
  evalsByCourse: Record<string, EvalMetrics | null>,
): Promise<ScheduleAuditResult> {
  const { object } = await generateObject({
    model: openai("gpt-4o-mini"),
    schema: llmAuditSchema,
    system:
      "You are an academic advisor analyzing a student's course schedule. " +
      "Given their courses, evaluation metrics, and personal profile, produce a structured workload audit " +
      "with numeric estimates and a narrative summary. " +
      "Be honest about uncertainty when evaluation data is missing. " +
      "Workload scale is 1–5 (5 = heaviest). Estimate weekly hours based on the workload scores.",
    prompt: buildPrompt(context, evalsByCourse),
  });
  return object;
}
