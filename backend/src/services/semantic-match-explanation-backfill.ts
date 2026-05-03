/**
 * Batch LLM fill for semantic search cards when matchExplanation was omitted or defaulted
 * (e.g. forced search payload path). Keeps deterministic suffixes from preference/constraint logic.
 */

import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

export const SEMANTIC_SEARCH_FALLBACK_EXPLANATION =
  "Related to your search by course description.";

const KNOWN_TRAILING_NOTE_PREFIXES = [
  "Preference mismatch:",
  "Constraint note:",
  "Preference note:",
] as const;

const backfillResponseSchema = z.object({
  items: z.array(
    z.object({
      /** Index into the parent search `results` array (same as listed in the prompt). */
      resultIndex: z.number().int().min(0),
      matchExplanation: z.string().min(8).max(500),
    }),
  ),
});

type BackfillResponse = z.infer<typeof backfillResponseSchema>;

type GenerateSemanticMatchExplanationObject = (args: {
  model: ReturnType<typeof openai>;
  schema: typeof backfillResponseSchema;
  temperature?: number;
  system: string;
  prompt: string;
}) => Promise<{ object: BackfillResponse }>;

const generateSemanticMatchExplanationObject =
  generateObject as unknown as GenerateSemanticMatchExplanationObject;

/** Exported for tests: detect rows where the deterministic placeholder should be replaced. */
export function stripDeterministicFallbackPrefix(explanation: string): {
  shouldReplaceBase: boolean;
  trailingNotes: string;
} {
  const t = explanation.trim();
  if (t === "") {
    return { shouldReplaceBase: true, trailingNotes: "" };
  }
  if (t === SEMANTIC_SEARCH_FALLBACK_EXPLANATION) {
    return { shouldReplaceBase: true, trailingNotes: "" };
  }
  if (!t.startsWith(SEMANTIC_SEARCH_FALLBACK_EXPLANATION)) {
    return { shouldReplaceBase: false, trailingNotes: "" };
  }
  let rest = t.slice(SEMANTIC_SEARCH_FALLBACK_EXPLANATION.length).trimStart();
  if (rest.startsWith(".")) {
    rest = rest.slice(1).trimStart();
  }
  if (rest === "") {
    return { shouldReplaceBase: true, trailingNotes: "" };
  }
  const hasKnownContinuation = KNOWN_TRAILING_NOTE_PREFIXES.some((p) =>
    rest.startsWith(p),
  );
  if (hasKnownContinuation) {
    return { shouldReplaceBase: true, trailingNotes: rest };
  }
  return { shouldReplaceBase: false, trailingNotes: "" };
}

function rowNeedsSemanticExplanationBackfill(row: Record<string, unknown>): boolean {
  if (row.clearlyMatches !== false) return false;
  const expl =
    typeof row.matchExplanation === "string" ? row.matchExplanation : "";
  return stripDeterministicFallbackPrefix(expl).shouldReplaceBase;
}

function combineBaseWithTrailingNotes(base: string, trailingNotes: string): string {
  const b = base.trim();
  const t = trailingNotes.trim();
  if (!t) return b;
  return `${b} ${t}`;
}

function truncateMiddle(input: string, max: number): string {
  const s = input.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export async function backfillSemanticMatchExplanationsInResults(
  userMessage: string,
  results: unknown[],
): Promise<unknown[]> {
  if (!results.length || !process.env.OPENAI_API_KEY?.trim()) {
    return results;
  }

  type Candidate = { index: number; trailingNotes: string };
  const candidates: Candidate[] = [];

  results.forEach((r, index) => {
    if (!r || typeof r !== "object") return;
    const row = r as Record<string, unknown>;
    if (!rowNeedsSemanticExplanationBackfill(row)) return;
    const expl =
      typeof row.matchExplanation === "string" ? row.matchExplanation : "";
    const { trailingNotes } = stripDeterministicFallbackPrefix(expl);
    candidates.push({ index, trailingNotes });
  });

  if (candidates.length === 0) return results;

  const trimmedUser = truncateMiddle(userMessage, 2800);

  const candidateIndices = new Set(candidates.map((c) => c.index));

  const payloadForModel = candidates.map((c) => {
    const row = results[c.index];
    const rec = row as Record<string, unknown>;
    const desc =
      typeof rec.description === "string" ? truncateMiddle(rec.description, 520) : "";
    const title = typeof rec.title === "string" ? rec.title : "";
    const code = typeof rec.code === "string" ? rec.code : "";
    return {
      resultIndex: c.index,
      code,
      title,
      description: desc,
    };
  });

  try {
    const { object } = await generateSemanticMatchExplanationObject({
      model: openai("gpt-4o-mini"),
      schema: backfillResponseSchema,
      temperature: 0.25,
      system: [
        "You generate short explanations for undergraduate course search results at Johns Hopkins.",
        "Given the student's search message and course fields, write 1–2 sentences per course explaining why the course could match what they looked for.",
        "Use concrete terms from title and description. No markdown or links.",
        'Do not use negative disclaimers (e.g. "not really related", "unrelated"). Stay neutral or positive.',
        "Every item must set resultIndex to the same integer listed for that course below (position in the search results array).",
        "Produce exactly one explanation per requested course.",
      ].join("\n"),
      prompt: `Student search (verbatim, may be truncated):\n"""${trimmedUser}"""\n\nCourses (JSON):\n${JSON.stringify(
        payloadForModel,
      )}`,
    });

    const byIndex = new Map<number, string>();
    for (const entry of object.items) {
      if (!candidateIndices.has(entry.resultIndex)) continue;
      const text = entry.matchExplanation.trim();
      if (text) byIndex.set(entry.resultIndex, text);
    }

    return results.map((r, index) => {
      const cand = candidates.find((c) => c.index === index);
      if (!cand || !r || typeof r !== "object") return r;
      const generated = byIndex.get(cand.index);
      if (!generated) return r;
      const row = r as Record<string, unknown>;
      return {
        ...row,
        matchExplanation: combineBaseWithTrailingNotes(generated, cand.trailingNotes),
      };
    });
  } catch (err) {
    console.error("[semantic-match-explanation-backfill] generateObject failed:", err);
    return results;
  }
}
