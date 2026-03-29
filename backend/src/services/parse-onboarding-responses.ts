/**
 * LLM-backed extraction of structured preference memories from onboarding text + presets.
 * Invoked only from PUT /api/user/profile — the agent reads `user_profiles.derived_memories` only.
 */

import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

export const derivedMemoriesSchema = z.object({
  goals: z
    .array(z.string())
    .describe(
      "Snake_case or short tags for academic/career goals (e.g. graduate_school_ml, industry_swe, pre_med)",
    ),
  workloadTolerance: z
    .enum(["light", "medium", "heavy", "unspecified"])
    .describe("Preferred overall course workload intensity"),
  timePreferences: z
    .array(z.string())
    .describe(
      "Snake_case time or day preferences (e.g. after_11am, no_friday, morning_classes, back_to_back_ok)",
    ),
  notes: z
    .array(z.string())
    .describe("Short factual bullets the schedule advisor can cite (projects, learning style, constraints)"),
});

export type DerivedMemories = z.infer<typeof derivedMemoriesSchema>;

export type ParseOnboardingInput = {
  goals: string;
  workload: string;
  preferences: string;
  goalPresets?: string[];
  workloadPresets?: string[];
  preferencePresets?: string[];
};

const ONBOARDING_PARSE_SYSTEM = `You are extracting structured preference memories for Atlas, a JHU undergraduate course planning assistant.

Rules:
- Output ONLY structured fields that match the schema; be conservative and grounded in the user's text and presets.
- Use snake_case tokens in arrays where examples show that style (e.g. graduate_school_ml, after_11am).
- If information is missing or vague, use empty arrays, notes explaining uncertainty sparingly, and workloadTolerance "unspecified".
- Do not invent specific majors, employers, or schedules not hinted at in the input.
- Merge preset chips with free-text: presets are authoritative labels the user selected; reconcile with prose when both exist.`;

function buildOnboardingUserPrompt(input: ParseOnboardingInput): string {
  const lines = [
    "### Career / academic goals (free text)",
    input.goals.trim() || "(none)",
    "",
    "### Workload (free text)",
    input.workload.trim() || "(none)",
    "",
    "### Class / time preferences (free text)",
    input.preferences.trim() || "(none)",
  ];
  if (input.goalPresets?.length) {
    lines.push("", "### Goal presets (selected chips)", input.goalPresets.join(", "));
  }
  if (input.workloadPresets?.length) {
    lines.push("", "### Workload presets", input.workloadPresets.join(", "));
  }
  if (input.preferencePresets?.length) {
    lines.push("", "### Time / preference presets", input.preferencePresets.join(", "));
  }
  return lines.join("\n");
}

export function emptyDerivedMemories(): DerivedMemories {
  return {
    goals: [],
    workloadTolerance: "unspecified",
    timePreferences: [],
    notes: [],
  };
}

function hasParserInputContent(input: ParseOnboardingInput): boolean {
  const text = [input.goals, input.workload, input.preferences].some((s) => s.trim().length > 0);
  const presets = [input.goalPresets, input.workloadPresets, input.preferencePresets].some(
    (a) => a && a.length > 0,
  );
  return text || Boolean(presets);
}

/**
 * Returns structured memories to persist, or `null` when nothing should be written:
 * - No substantive text/presets after merge → `null` (caller passes null so COALESCE keeps existing JSON).
 * - Model/API failure → `null` (do not overwrite good stored memories with an empty object).
 */
export async function parseOnboardingResponses(
  input: ParseOnboardingInput,
): Promise<DerivedMemories | null> {
  if (!hasParserInputContent(input)) {
    return null;
  }

  try {
    const { object } = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: derivedMemoriesSchema,
      system: ONBOARDING_PARSE_SYSTEM,
      prompt: buildOnboardingUserPrompt(input),
      temperature: 0,
    });
    return object;
  } catch (err) {
    console.error("[parseOnboardingResponses] failed:", err);
    return null;
  }
}

const TEXT_MEMORY_TRIGGER_KEYS = new Set([
  "goalsText",
  "raw_goals_text",
  "workloadText",
  "raw_workload_text",
  "preferencesText",
  "raw_preferences_text",
]);

const PRESET_MEMORY_TRIGGER_KEYS = new Set([
  "goalPresets",
  "workloadPresets",
  "preferencePresets",
]);

function isNonEmptyPresetArray(body: Record<string, unknown>, key: string): boolean {
  const v = body[key];
  return Array.isArray(v) && v.length > 0;
}

function isSubstantiveTextMemoryValue(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * True when the client sent at least one substantive onboarding field (non-empty trimmed text,
 * or a non-empty preset array). Keys present with only empty strings or empty arrays do not trigger.
 */
export function shouldRecomputeDerivedMemories(body: Record<string, unknown>): boolean {
  for (const k of Object.keys(body)) {
    if (TEXT_MEMORY_TRIGGER_KEYS.has(k) && isSubstantiveTextMemoryValue(body[k])) return true;
    if (PRESET_MEMORY_TRIGGER_KEYS.has(k) && isNonEmptyPresetArray(body, k)) return true;
  }
  return false;
}

export function mergeProfileTextsForDerivation(
  body: Record<string, unknown>,
  incoming: {
    raw_goals_text: string | null;
    raw_workload_text: string | null;
    raw_preferences_text: string | null;
  },
  existing: {
    raw_goals_text: string | null;
    raw_workload_text: string | null;
    raw_preferences_text: string | null;
  } | null,
): { goals: string; workload: string; preferences: string } {
  const pick = (camel: string, snake: string, inc: string | null, ex: string | null) =>
    camel in body || snake in body ? (inc ?? "") : (ex ?? "");

  return {
    goals: pick("goalsText", "raw_goals_text", incoming.raw_goals_text, existing?.raw_goals_text ?? null),
    workload: pick(
      "workloadText",
      "raw_workload_text",
      incoming.raw_workload_text,
      existing?.raw_workload_text ?? null,
    ),
    preferences: pick(
      "preferencesText",
      "raw_preferences_text",
      incoming.raw_preferences_text,
      existing?.raw_preferences_text ?? null,
    ),
  };
}

export function allOnboardingTextKeysInBody(body: Record<string, unknown>): boolean {
  const goals = "goalsText" in body || "raw_goals_text" in body;
  const workload = "workloadText" in body || "raw_workload_text" in body;
  const prefs = "preferencesText" in body || "raw_preferences_text" in body;
  return goals && workload && prefs;
}
