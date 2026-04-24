/**
 * Offline response evaluator (Issue #278).
 * Fires async after a response is sent — never throws, never delays the user.
 * Mirrors the triggerChatMemoryExtraction fire-and-forget pattern.
 */

import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import type { Pool } from "pg";
import { toDatabaseUserId } from "../middleware/auth";
import type { CanonicalMemoryRow } from "./schedule-context";

export interface EvalParams {
  pool: Pool;
  appUserId: string;
  userMessage: string;
  assistantMessageId: string | null;
  finalPayload: unknown;
  toolSteps: string[];
  canonicalMemories: CanonicalMemoryRow[];
}

interface EvalIssue {
  dimension: string;
  severity: "warn" | "error";
  detail: string;
}

type QueryType = "search" | "eval_summary" | "details" | "mutation" | "text";

// ---------------------------------------------------------------------------
// Query type inference (keyword heuristic — no LLM cost)
// ---------------------------------------------------------------------------

export function inferQueryType(message: string): QueryType {
  const s = message.toLowerCase();
  if (/\b(add|remove|drop|build|create|delete|modify|swap|replace)\b/.test(s) &&
      /\b(course|class|section|schedule)\b/.test(s)) {
    return "mutation";
  }
  if (/\b(eval|evaluation|rating|review|quality|score|workload|difficulty|recommend|prof|professor|instructor)\b/.test(s)) {
    return "eval_summary";
  }
  if (/\b(detail|section|meeting|time|room|when|where|instructor|who teach|syllabus|credit)\b/.test(s)) {
    return "details";
  }
  if (/\b(find|search|look|show|list|what|which|any|course|class|classes|courses)\b/.test(s)) {
    return "search";
  }
  return "text";
}

// ---------------------------------------------------------------------------
// Evaluation dimensions (deterministic)
// ---------------------------------------------------------------------------

const RESPONSE_TYPE_EXPECTATIONS: Record<QueryType, string[]> = {
  search: ["search_results", "course_list", "text"],
  eval_summary: ["eval_summary", "text"],
  details: ["course_details", "search_results", "text"],
  mutation: ["schedule_mutation", "text"],
  text: [],
};

export function evaluateResponseTypeCorrectness(
  queryType: QueryType,
  finalPayload: unknown,
): EvalIssue | null {
  const expected = RESPONSE_TYPE_EXPECTATIONS[queryType];
  if (expected.length === 0) return null;
  const responseType =
    finalPayload != null &&
    typeof finalPayload === "object" &&
    "type" in (finalPayload as object)
      ? String((finalPayload as Record<string, unknown>).type)
      : null;
  if (!responseType) {
    return { dimension: "response_type", severity: "warn", detail: "Response payload missing type field" };
  }
  if (!expected.includes(responseType)) {
    return {
      dimension: "response_type",
      severity: "warn",
      detail: `Query looks like "${queryType}" but response type is "${responseType}"; expected one of: ${expected.join(", ")}`,
    };
  }
  return null;
}

const EXPECTED_TOOLS: Record<QueryType, string[]> = {
  search: ["searchCourses", "semanticCourseSearch"],
  eval_summary: ["getCourseEvalSummary", "queryCourseMetrics"],
  details: ["getSisCourseDetails"],
  mutation: [],
  text: [],
};

export function evaluateToolSelectionEfficiency(
  queryType: QueryType,
  toolSteps: string[],
): EvalIssue | null {
  const relevant = EXPECTED_TOOLS[queryType];
  if (relevant.length === 0) return null;
  const usedRelevant = toolSteps.some((t) => relevant.includes(t));
  if (!usedRelevant) {
    return {
      dimension: "tool_selection",
      severity: "warn",
      detail: `Query looks like "${queryType}" but none of [${relevant.join(", ")}] were called (called: [${toolSteps.join(", ") || "none"}])`,
    };
  }
  return null;
}

export function evaluateFormatCompliance(finalPayload: unknown): EvalIssue | null {
  if (finalPayload == null || typeof finalPayload !== "object") {
    return { dimension: "format", severity: "error", detail: "Response payload is not an object" };
  }
  const p = finalPayload as Record<string, unknown>;
  if (typeof p.type !== "string" || !p.type) {
    return { dimension: "format", severity: "error", detail: 'Response payload missing required "type" string field' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Constraint compliance check (LLM-backed, gpt-4o as independent judge)
// ---------------------------------------------------------------------------

const violationSchema = z.object({
  violations: z.array(
    z.object({
      constraintText: z.string(),
      explanation: z.string(),
    }),
  ),
});

const COMPLIANCE_SYSTEM = `You are an evaluator checking whether an AI assistant's response respected a student's stored scheduling constraints.

Given a list of constraints and the assistant's response JSON, identify any constraints that were clearly violated.
A violation occurs when the response contains courses, times, or suggestions that directly contradict a stated constraint.

Be conservative: only flag clear violations, not speculative ones.
Return {"violations": []} when no constraints were violated or when you cannot determine from the response.`;

export async function evaluateConstraintCompliance(
  userMessage: string,
  finalPayload: unknown,
  canonicalMemories: CanonicalMemoryRow[],
): Promise<EvalIssue[]> {
  const constraints = canonicalMemories.filter((m) => m.memory_type === "constraint");
  if (constraints.length === 0) return [];
  if (!process.env.OPENAI_API_KEY?.trim()) return [];

  let payloadText: string;
  try {
    payloadText = JSON.stringify(finalPayload);
  } catch {
    payloadText = String(finalPayload);
  }

  try {
    const { object } = await generateObject({
      model: openai("gpt-4o"),
      schema: violationSchema,
      system: COMPLIANCE_SYSTEM,
      prompt: `Student constraints:\n${constraints.map((c) => `- ${c.memory_text}`).join("\n")}\n\nUser message:\n"""${userMessage}"""\n\nAssistant response:\n${payloadText.slice(0, 4000)}`,
      temperature: 0,
    });
    return object.violations.map((v) => ({
      dimension: "constraint_compliance",
      severity: "error" as const,
      detail: v.constraintText,
    }));
  } catch (err) {
    console.warn("[response-evaluation] constraint compliance check failed:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Constraint reinforcement
// ---------------------------------------------------------------------------

const REINFORCEMENT_WINDOW = "14 days";
const REINFORCEMENT_THRESHOLD = 3;

export async function maybeReinforceConstraints(
  pool: Pool,
  dbUserId: string,
  issues: EvalIssue[],
): Promise<void> {
  const constraintIssues = issues.filter((i) => i.dimension === "constraint_compliance");
  if (constraintIssues.length === 0) return;

  const { rows: recentRows } = await pool.query<{ issues: unknown }>(
    `SELECT issues FROM agent_eval_logs
     WHERE user_id = $1 AND created_at > now() - interval '${REINFORCEMENT_WINDOW}'
     ORDER BY created_at DESC LIMIT 100`,
    [dbUserId],
  );

  const violationCounts = new Map<string, number>();
  for (const row of recentRows) {
    const rowIssues = Array.isArray(row.issues) ? (row.issues as EvalIssue[]) : [];
    for (const issue of rowIssues) {
      if (issue.dimension === "constraint_compliance" && issue.detail) {
        violationCounts.set(issue.detail, (violationCounts.get(issue.detail) ?? 0) + 1);
      }
    }
  }

  for (const issue of constraintIssues) {
    const count = violationCounts.get(issue.detail) ?? 0;
    if (count < REINFORCEMENT_THRESHOLD) continue;

    const reinforced = `IMPORTANT: ${issue.detail} — previously ignored, must be respected`;

    const { rows: existing } = await pool.query<{ id: string }>(
      `SELECT id FROM user_memories WHERE user_id = $1 AND memory_text ILIKE 'IMPORTANT: %' AND memory_text ILIKE $2`,
      [dbUserId, `%${issue.detail.slice(0, 80)}%`],
    );
    if (existing.length > 0) continue;

    try {
      await pool.query(
        `INSERT INTO user_memories (user_id, memory_text, memory_type, source, confidence)
         VALUES ($1, $2, 'constraint', 'manual', 1.0)`,
        [dbUserId, reinforced],
      );
    } catch (err) {
      console.error("[response-evaluation] failed to insert reinforced memory:", err);
    }
  }
}

// ---------------------------------------------------------------------------
// DB write
// ---------------------------------------------------------------------------

async function writeEvalLog(
  pool: Pool,
  dbUserId: string,
  params: EvalParams,
  queryType: QueryType,
  issues: EvalIssue[],
): Promise<void> {
  const responseType =
    params.finalPayload != null &&
    typeof params.finalPayload === "object" &&
    "type" in (params.finalPayload as object)
      ? String((params.finalPayload as Record<string, unknown>).type)
      : null;

  let rawResponse: unknown = null;
  try {
    rawResponse = params.finalPayload;
  } catch {
    // keep null
  }

  await pool.query(
    `INSERT INTO agent_eval_logs
       (user_id, message_id, query_type, response_type, tool_sequence, issues, passed, raw_query, raw_response)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      dbUserId,
      params.assistantMessageId,
      queryType,
      responseType,
      params.toolSteps,
      JSON.stringify(issues),
      issues.filter((i) => i.severity === "error").length === 0,
      params.userMessage.slice(0, 2000),
      rawResponse != null ? rawResponse : null,
    ],
  );
}

// ---------------------------------------------------------------------------
// Fire-and-forget entry point
// ---------------------------------------------------------------------------

export async function runResponseEvaluation(params: EvalParams): Promise<void> {
  const dbUserId = toDatabaseUserId(params.appUserId);

  try {
    const queryType = inferQueryType(params.userMessage);
    const issues: EvalIssue[] = [];

    const formatIssue = evaluateFormatCompliance(params.finalPayload);
    if (formatIssue) issues.push(formatIssue);

    const typeIssue = evaluateResponseTypeCorrectness(queryType, params.finalPayload);
    if (typeIssue) issues.push(typeIssue);

    const toolIssue = evaluateToolSelectionEfficiency(queryType, params.toolSteps);
    if (toolIssue) issues.push(toolIssue);

    try {
      const complianceIssues = await evaluateConstraintCompliance(
        params.userMessage,
        params.finalPayload,
        params.canonicalMemories,
      );
      issues.push(...complianceIssues);
    } catch (err) {
      console.error("[response-evaluation] constraint compliance phase failed:", err);
    }

    try {
      await writeEvalLog(params.pool, dbUserId, params, queryType, issues);
    } catch (err) {
      console.error("[response-evaluation] writeEvalLog failed:", err);
      return;
    }

    try {
      await maybeReinforceConstraints(params.pool, dbUserId, issues);
    } catch (err) {
      console.error("[response-evaluation] reinforcement phase failed:", err);
    }
  } catch (err) {
    console.error("[response-evaluation] runResponseEvaluation failed:", err);
  }
}
