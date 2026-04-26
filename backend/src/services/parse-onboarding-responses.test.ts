import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateObject } from "ai";

vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

import {
  parseOnboardingResponses,
  mergeProfileTextsForDerivation,
  shouldRecomputeDerivedMemories,
  allOnboardingTextKeysInBody,
  coerceDerivedMemoriesFromUnknown,
} from "./parse-onboarding-responses";

const mockGenerateObject = vi.mocked(generateObject);

describe("parseOnboardingResponses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null without calling the model when all inputs are blank", async () => {
    const out = await parseOnboardingResponses({
      goals: "",
      workload: "",
      preferences: "",
    });
    expect(out).toBeNull();
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("returns structured object from the model on success", async () => {
    const structured = {
      goals: [
        { value: "graduate_school_ml", confidence: 0.85, fromSelectedChoice: false },
        { value: "research_oriented", confidence: 0.88, fromSelectedChoice: false },
      ],
      workloadTolerance: "medium" as const,
      workloadFromSelectedChoiceOnly: false,
      workloadConfidence: 0.72,
      timePreferences: [
        { value: "after_11am", confidence: 0.9, fromSelectedChoice: false },
        { value: "no_friday", confidence: 0.88, fromSelectedChoice: false },
      ],
      notes: [{ value: "prefers project-based classes", confidence: 0.8, fromSelectedChoice: false }],
    };
    mockGenerateObject.mockResolvedValueOnce({ object: structured } as never);

    const out = await parseOnboardingResponses({
      goals: "I want to do ML research",
      workload: "moderate",
      preferences: "after 11am, no Friday labs",
    });

    expect(out).toEqual(structured);
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
    const call = mockGenerateObject.mock.calls[0][0] as { prompt: string };
    expect(call.prompt).toContain("ML research");
    expect(call.prompt).toContain("moderate");
  });

  it("includes preset sections in the prompt when provided", async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        goals: [{ value: "industry", confidence: 1, fromSelectedChoice: true }],
        workloadTolerance: "unspecified",
        workloadFromSelectedChoiceOnly: false,
        workloadConfidence: 0,
        timePreferences: [],
        notes: [],
      },
    } as never);

    await parseOnboardingResponses({
      goals: "",
      workload: "",
      preferences: "",
      goalPresets: ["industry_swe"],
      workloadPresets: ["medium_load"],
    });

    const call = mockGenerateObject.mock.calls[0][0] as { prompt: string };
    expect(call.prompt).toContain("industry_swe");
    expect(call.prompt).toContain("medium_load");
  });

  it("returns null when the model call fails so stored memories are not overwritten", async () => {
    mockGenerateObject.mockRejectedValueOnce(new Error("API down"));

    const out = await parseOnboardingResponses({
      goals: "anything",
      workload: "",
      preferences: "",
    });

    expect(out).toBeNull();
  });
});

describe("coerceDerivedMemoriesFromUnknown", () => {
  it("maps legacy string-array JSON to items with default confidence", () => {
    const out = coerceDerivedMemoriesFromUnknown({
      goals: ["a", "b"],
      workloadTolerance: "light",
      timePreferences: ["no_friday"],
      notes: ["n1"],
    });
    expect(out).toEqual({
      goals: [
        { value: "a", confidence: 0.7, fromSelectedChoice: false },
        { value: "b", confidence: 0.7, fromSelectedChoice: false },
      ],
      workloadTolerance: "light",
      workloadFromSelectedChoiceOnly: false,
      workloadConfidence: 0.7,
      timePreferences: [{ value: "no_friday", confidence: 0.7, fromSelectedChoice: false }],
      notes: [{ value: "n1", confidence: 0.7, fromSelectedChoice: false }],
    });
  });
});

describe("shouldRecomputeDerivedMemories", () => {
  it("is true when a text field is non-empty or a preset array is non-empty", () => {
    expect(shouldRecomputeDerivedMemories({ goalsText: "x" })).toBe(true);
    expect(shouldRecomputeDerivedMemories({ raw_goals_text: "x" })).toBe(true);
    expect(shouldRecomputeDerivedMemories({ goalPresets: ["a"] })).toBe(true);
    expect(shouldRecomputeDerivedMemories({ goalPresets: [] })).toBe(false);
    expect(shouldRecomputeDerivedMemories({ goalsText: "" })).toBe(false);
    expect(shouldRecomputeDerivedMemories({ goalsText: "   " })).toBe(false);
    expect(
      shouldRecomputeDerivedMemories({
        goalsText: "",
        workloadText: "",
        preferencesText: "",
        goalPresets: [],
      }),
    ).toBe(false);
    expect(shouldRecomputeDerivedMemories({ school: "KSAS" })).toBe(false);
  });
});

describe("allOnboardingTextKeysInBody", () => {
  it("requires all three text dimensions (camel or snake)", () => {
    expect(allOnboardingTextKeysInBody({ goalsText: "a", workloadText: "b", preferencesText: "c" })).toBe(
      true,
    );
    expect(allOnboardingTextKeysInBody({ goalsText: "a", workloadText: "b" })).toBe(false);
  });
});

describe("mergeProfileTextsForDerivation", () => {
  it("uses incoming values when keys are present in the body", () => {
    const body = { goalsText: "new goals" };
    const merged = mergeProfileTextsForDerivation(
      body,
      {
        raw_goals_text: "new goals",
        raw_workload_text: null,
        raw_preferences_text: null,
      },
      {
        raw_goals_text: "old goals",
        raw_workload_text: "old w",
        raw_preferences_text: "old p",
      },
    );
    expect(merged.goals).toBe("new goals");
    expect(merged.workload).toBe("old w");
    expect(merged.preferences).toBe("old p");
  });
});
