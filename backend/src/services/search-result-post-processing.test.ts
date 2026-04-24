import { describe, expect, it } from "vitest";
import {
  appendMismatchNotes,
  applyDeterministicSearchRanking,
} from "./search-result-post-processing";

describe("applyDeterministicSearchRanking", () => {
  it("ranks aligned rows above mismatch rows with same base signal", () => {
    const rows = [
      {
        code: "EN.601.226",
        matchType: "semantic",
        relevanceScore: 0.9,
        constraintAlignment: "mismatch",
        rank: 1,
      },
      {
        code: "EN.553.171",
        matchType: "semantic",
        relevanceScore: 0.9,
        constraintAlignment: "aligned",
        rank: 2,
      },
    ];

    const ranked = applyDeterministicSearchRanking(rows) as Array<Record<string, unknown>>;
    expect(ranked[0].code).toBe("EN.553.171");
    expect(ranked[1].code).toBe("EN.601.226");
  });

  it("applies larger penalty for constraint mismatch than preference mismatch", () => {
    const rows = [
      {
        code: "EN.601.226",
        matchType: "semantic",
        relevanceScore: 0.8,
        constraintAlignment: "mismatch",
        rank: 1,
      },
      {
        code: "EN.553.171",
        matchType: "semantic",
        relevanceScore: 0.8,
        preferenceAlignment: "mismatch",
        rank: 2,
      },
    ];

    const ranked = applyDeterministicSearchRanking(rows) as Array<Record<string, unknown>>;
    expect(ranked[0].code).toBe("EN.553.171");
    expect(ranked[1].code).toBe("EN.601.226");
  });

  it("uses deterministic tie-break order", () => {
    const rows = [
      {
        code: "EN.601.300",
        matchType: "semantic",
        relevanceScore: 0.5,
        rank: 2,
      },
      {
        code: "EN.601.200",
        matchType: "semantic",
        relevanceScore: 0.5,
        rank: 2,
      },
      {
        code: "EN.601.100",
        matchType: "semantic",
        relevanceScore: 0.5,
        rank: 1,
      },
    ];

    const first = applyDeterministicSearchRanking(rows) as Array<Record<string, unknown>>;
    const second = applyDeterministicSearchRanking(rows) as Array<Record<string, unknown>>;
    expect(first.map((r) => r.code)).toEqual(["EN.601.100", "EN.601.200", "EN.601.300"]);
    expect(second.map((r) => r.code)).toEqual(first.map((r) => r.code));
  });
});

describe("appendMismatchNotes", () => {
  it("appends constraint and preference mismatch notes once while preserving existing explanation", () => {
    const rows = [
      {
        code: "EN.601.226",
        matchExplanation: "Strong semantic match to your query.",
        constraintAlignment: "mismatch",
        constraintMismatchReasons: ["days", "school"],
        preferenceAlignment: "mismatch",
        preferenceMismatchReasons: ["time_window"],
      },
    ];

    const once = appendMismatchNotes(rows) as Array<Record<string, unknown>>;
    const twice = appendMismatchNotes(once) as Array<Record<string, unknown>>;
    const explanation = String(once[0].matchExplanation);

    expect(explanation).toContain("Strong semantic match to your query.");
    expect(explanation).toContain("Constraint note:");
    expect(explanation).toContain("Preference note:");
    expect(twice[0].matchExplanation).toBe(explanation);
  });
});
