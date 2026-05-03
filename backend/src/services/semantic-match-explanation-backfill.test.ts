import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGenerateObject = vi.fn();

vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => mockGenerateObject(...args),
}));

vi.mock("@ai-sdk/openai", () => ({
  openai: vi.fn(() => "mock-model"),
}));

import {
  SEMANTIC_SEARCH_FALLBACK_EXPLANATION,
  backfillSemanticMatchExplanationsInResults,
  stripDeterministicFallbackPrefix,
} from "./semantic-match-explanation-backfill";

describe("stripDeterministicFallbackPrefix", () => {
  it("flags empty as replaceable", () => {
    expect(stripDeterministicFallbackPrefix("")).toEqual({
      shouldReplaceBase: true,
      trailingNotes: "",
    });
  });

  it("detects standalone fallback sentence", () => {
    expect(
      stripDeterministicFallbackPrefix(SEMANTIC_SEARCH_FALLBACK_EXPLANATION),
    ).toEqual({
      shouldReplaceBase: true,
      trailingNotes: "",
    });
  });

  it("detects fallback with preference mismatch suffix", () => {
    const trailing =
      "Preference mismatch: conflicts with preferred days and preferred time window.";
    expect(
      stripDeterministicFallbackPrefix(
        `${SEMANTIC_SEARCH_FALLBACK_EXPLANATION} ${trailing}`,
      ),
    ).toEqual({
      shouldReplaceBase: true,
      trailingNotes: trailing,
    });
  });

  it("detects fallback with Constraint note suffix", () => {
    const trailing =
      "Constraint note: may not satisfy day constraints and time window constraints.";
    expect(
      stripDeterministicFallbackPrefix(
        `${SEMANTIC_SEARCH_FALLBACK_EXPLANATION} ${trailing}`,
      ),
    ).toEqual({
      shouldReplaceBase: true,
      trailingNotes: trailing,
    });
  });

  it("does not replace custom explanations without the fallback prefix", () => {
    expect(
      stripDeterministicFallbackPrefix(
        "This course covers compilers and aligns with systems interest.",
      ),
    ).toEqual({
      shouldReplaceBase: false,
      trailingNotes: "",
    });
  });
});

describe("backfillSemanticMatchExplanationsInResults", () => {
  beforeEach(() => {
    mockGenerateObject.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("skips when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    const rows = [
      {
        clearlyMatches: false as const,
        matchExplanation: SEMANTIC_SEARCH_FALLBACK_EXPLANATION,
      },
    ];
    await expect(backfillSemanticMatchExplanationsInResults("music", rows)).resolves.toEqual(
      rows,
    );
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("fills placeholder and preserves preference mismatch trailing text", async () => {
    const trailing =
      "Preference mismatch: conflicts with preferred days and preferred time window.";
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        items: [
          {
            resultIndex: 0,
            matchExplanation:
              "The seminar connects to qualitative methods often used when studying civic engagement.",
          },
        ],
      },
    });
    const rows: unknown[] = [
      {
        clearlyMatches: false,
        matchExplanation: `${SEMANTIC_SEARCH_FALLBACK_EXPLANATION} ${trailing}`,
        description: "...",
      },
    ];
    const out = await backfillSemanticMatchExplanationsInResults("civic engagement", rows);
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
    expect(String((out[0] as Record<string, unknown>).matchExplanation)).toContain(
      "qualitative methods",
    );
    expect(String((out[0] as Record<string, unknown>).matchExplanation)).toContain(trailing);
  });

  it("ignores rows without clearlyMatches === false", async () => {
    const rows = [
      { clearlyMatches: true, matchExplanation: undefined },
      { matchExplanation: SEMANTIC_SEARCH_FALLBACK_EXPLANATION },
    ];
    await backfillSemanticMatchExplanationsInResults("anything", rows);
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });
});
