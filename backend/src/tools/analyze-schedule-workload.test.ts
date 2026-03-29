import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGenerateObject } = vi.hoisted(() => {
  const mockGenerateObject = vi.fn();
  return { mockGenerateObject };
});

vi.mock("ai", () => ({ generateObject: mockGenerateObject }));
vi.mock("@ai-sdk/openai", () => ({ openai: vi.fn(() => "mock-model") }));

import { analyzeScheduleWorkload, calculateWorkloadRange } from "./analyze-schedule-workload";
import { ScheduleAgentContext } from "../services/schedule-context";
import { EvalMetrics } from "../types/eval-summary";

// LLM returns only the qualitative fields now; workloadRange is deterministic
const mockLlmObject = {
  difficulty: 3.5,
  feasibilityLabel: "moderate",
  narrativeSummary: "This is a manageable schedule.",
  goalAlignment: "Aligns well with CS goals.",
  recommendations: ["Consider office hours for difficult courses."],
};

const makeContext = (overrides: Partial<ScheduleAgentContext> = {}): ScheduleAgentContext => ({
  scheduleName: "Spring 2026 - Main",
  scheduleTerm: "Spring 2026",
  courses: [
    { courseCode: "EN.601.226", sisOfferingName: "EN.601.226", term: "Spring 2026", courseTitle: "Data Structures", credits: 3 },
    { courseCode: "EN.553.171", sisOfferingName: "EN.553.171", term: "Spring 2026", courseTitle: "Discrete Math", credits: 3 },
  ],
  profile: {
    school: "Whiting School of Engineering",
    degrees: ["B.S. Computer Science"],
    rawGoalsText: "I want to get into ML research.",
    rawWorkloadText: "I can handle heavy workloads.",
    rawPreferencesText: "I prefer morning classes.",
    derivedMemories: [{ type: "goal", content: "Targeting ML PhD programs" }],
  },
  ...overrides,
});

const makeEvals = (): Record<string, EvalMetrics | null> => ({
  "EN.601.226": { overallQuality: 4.1, teachingEffectiveness: 4.0, difficulty: 3.5, workload: 3.8, feedbackQuality: 3.9 },
  "EN.553.171": { overallQuality: 3.7, teachingEffectiveness: 3.6, difficulty: 3.9, workload: 3.2, feedbackQuality: 3.5 },
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateObject.mockResolvedValue({ object: mockLlmObject });
});

// ---------------------------------------------------------------------------
// calculateWorkloadRange
// hours_per_credit(score) = 2 + (score - 3) * 0.5
// ---------------------------------------------------------------------------

describe("calculateWorkloadRange", () => {
  it("returns null when courses list is empty", () => {
    expect(calculateWorkloadRange([], {})).toBeNull();
  });

  it("returns null when no course has credit data", () => {
    const courses = makeContext().courses.map((c) => ({ ...c, credits: null }));
    expect(calculateWorkloadRange(courses, makeEvals())).toBeNull();
  });

  it("calculates correctly for score=3 (neutral)", () => {
    // score=3 → 2 hrs/credit; 3 credits × 2 = 6 hrs/course × 2 courses = 12 pts
    // min=round(12*0.85)=10, max=round(12*1.15)=14
    const evals = {
      "EN.601.226": { overallQuality: 3, teachingEffectiveness: 3, difficulty: 3, workload: 3, feedbackQuality: 3 },
      "EN.553.171": { overallQuality: 3, teachingEffectiveness: 3, difficulty: 3, workload: 3, feedbackQuality: 3 },
    };
    const result = calculateWorkloadRange(makeContext().courses, evals);
    expect(result).toEqual({ min: 10, max: 14 });
  });

  it("uses score=3 as fallback for courses with null evals", () => {
    const evals = { "EN.601.226": null, "EN.553.171": null };
    const result = calculateWorkloadRange(makeContext().courses, evals);
    expect(result).toEqual({ min: 10, max: 14 });
  });

  it("scales correctly at score=5", () => {
    // score=5 → 3 hrs/credit; 3 credits × 3 = 9 hrs × 2 courses = 18 pts
    // min=round(18*0.85)=15, max=round(18*1.15)=21
    const evals = {
      "EN.601.226": { overallQuality: 5, teachingEffectiveness: 5, difficulty: 5, workload: 5, feedbackQuality: 5 },
      "EN.553.171": { overallQuality: 5, teachingEffectiveness: 5, difficulty: 5, workload: 5, feedbackQuality: 5 },
    };
    const result = calculateWorkloadRange(makeContext().courses, evals);
    expect(result).toEqual({ min: 15, max: 21 });
  });

  it("scales correctly at score=1", () => {
    // score=1 → 1 hr/credit; 3 credits × 1 = 3 hrs × 2 courses = 6 pts
    // min=round(6*0.85)=5, max=round(6*1.15)=7
    const evals = {
      "EN.601.226": { overallQuality: 1, teachingEffectiveness: 1, difficulty: 1, workload: 1, feedbackQuality: 1 },
      "EN.553.171": { overallQuality: 1, teachingEffectiveness: 1, difficulty: 1, workload: 1, feedbackQuality: 1 },
    };
    const result = calculateWorkloadRange(makeContext().courses, evals);
    expect(result).toEqual({ min: 5, max: 7 });
  });
});

// ---------------------------------------------------------------------------
// analyzeScheduleWorkload
// ---------------------------------------------------------------------------

describe("analyzeScheduleWorkload", () => {
  it("returns deterministic workloadRange merged with LLM qualitative fields", async () => {
    const result = await analyzeScheduleWorkload(makeContext(), makeEvals());
    // workloadRange comes from calculateWorkloadRange, not the LLM
    expect(result.workloadRange).toBeDefined();
    expect(result.narrativeSummary).toBe(mockLlmObject.narrativeSummary);
    expect(result.feasibilityLabel).toBe("moderate");
  });

  it("includes pre-calculated workload in prompt", async () => {
    await analyzeScheduleWorkload(makeContext(), makeEvals());
    const call = mockGenerateObject.mock.calls[0][0];
    expect(call.prompt).toContain("Pre-calculated weekly workload");
    expect(call.prompt).toContain("hrs/week");
  });

  it("includes credits column in course table", async () => {
    await analyzeScheduleWorkload(makeContext(), makeEvals());
    const call = mockGenerateObject.mock.calls[0][0];
    expect(call.prompt).toContain("Credits");
    expect(call.prompt).toContain("3");
  });

  it("handles partial null evals without throwing", async () => {
    const evals: Record<string, EvalMetrics | null> = {
      "EN.601.226": { overallQuality: 4.1, teachingEffectiveness: 4.0, difficulty: 3.5, workload: 3.8, feedbackQuality: 3.9 },
      "EN.553.171": null,
    };
    const result = await analyzeScheduleWorkload(makeContext(), evals);
    expect(result.workloadRange).toBeDefined();
    const call = mockGenerateObject.mock.calls[0][0];
    expect(call.prompt).toContain("no eval data");
  });

  it("omits workloadRange when no courses have credits", async () => {
    const context = makeContext({
      courses: makeContext().courses.map((c) => ({ ...c, credits: null })),
    });
    const result = await analyzeScheduleWorkload(context, makeEvals());
    expect(result.workloadRange).toBeUndefined();
  });

  it("handles null profile gracefully", async () => {
    const result = await analyzeScheduleWorkload(makeContext({ profile: null }), makeEvals());
    expect(result.narrativeSummary).toBe(mockLlmObject.narrativeSummary);
    const call = mockGenerateObject.mock.calls[0][0];
    expect(call.prompt).toContain("No profile available");
  });

  it("propagates errors from generateObject", async () => {
    mockGenerateObject.mockRejectedValue(new Error("LLM failure"));
    await expect(analyzeScheduleWorkload(makeContext(), makeEvals())).rejects.toThrow("LLM failure");
  });
});
