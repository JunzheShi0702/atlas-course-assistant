/**
 * analyzeScheduleWorkload — Issue #118
 *
 * Given a schedule's courses, per-course evaluation metrics, and user profile/memories,
 * calls the LLM to produce a structured workload audit (ScheduleAuditResult).
 */

import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { ScheduleAgentContext } from "../services/schedule-context";
import { ScheduleAuditResult, scheduleAuditResultSchema } from "../types/database";
import { EvalMetrics } from "../types/eval-summary";

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
    schema: scheduleAuditResultSchema,
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
