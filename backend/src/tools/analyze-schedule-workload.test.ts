import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGenerateObject } = vi.hoisted(() => {
  const mockGenerateObject = vi.fn();
  return { mockGenerateObject };
});

vi.mock("ai", () => ({ generateObject: mockGenerateObject }));
vi.mock("@ai-sdk/openai", () => ({ openai: vi.fn(() => "mock-model") }));

import { analyzeScheduleWorkload } from "./analyze-schedule-workload";
import { ScheduleAgentContext } from "../services/schedule-context";
import { EvalMetrics } from "../types/eval-summary";
import { ScheduleAuditResult } from "../types/database";

const mockResult: ScheduleAuditResult = {
  workloadRange: { min: 15, max: 20 },
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
    { courseCode: "EN.601.226", sisOfferingName: "EN.601.226", term: "Spring 2026", courseTitle: "Data Structures" },
    { courseCode: "EN.553.171", sisOfferingName: "EN.553.171", term: "Spring 2026", courseTitle: "Discrete Math" },
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
  mockGenerateObject.mockResolvedValue({ object: mockResult });
});

describe("analyzeScheduleWorkload", () => {
  it("returns the structured result from generateObject", async () => {
    const result = await analyzeScheduleWorkload(makeContext(), makeEvals());
    expect(result).toEqual(mockResult);
    expect(mockGenerateObject).toHaveBeenCalledOnce();
  });

  it("calls generateObject with system and prompt parameters", async () => {
    await analyzeScheduleWorkload(makeContext(), makeEvals());
    const call = mockGenerateObject.mock.calls[0][0];
    expect(call.system).toContain("academic advisor");
    expect(call.prompt).toContain("EN.601.226");
    expect(call.prompt).toContain("Data Structures");
    expect(call.prompt).toContain("ML research");
  });

  it("handles partial null evals without throwing", async () => {
    const evals: Record<string, EvalMetrics | null> = {
      "EN.601.226": { overallQuality: 4.1, teachingEffectiveness: 4.0, difficulty: 3.5, workload: 3.8, feedbackQuality: 3.9 },
      "EN.553.171": null,
    };
    const result = await analyzeScheduleWorkload(makeContext(), evals);
    expect(result).toEqual(mockResult);
    const call = mockGenerateObject.mock.calls[0][0];
    expect(call.prompt).toContain("no eval data");
  });

  it("handles all evals null without throwing", async () => {
    const evals: Record<string, EvalMetrics | null> = {
      "EN.601.226": null,
      "EN.553.171": null,
    };
    const result = await analyzeScheduleWorkload(makeContext(), evals);
    expect(result).toEqual(mockResult);
  });

  it("handles null profile gracefully", async () => {
    const context = makeContext({ profile: null });
    const result = await analyzeScheduleWorkload(context, makeEvals());
    expect(result).toEqual(mockResult);
    const call = mockGenerateObject.mock.calls[0][0];
    expect(call.prompt).toContain("No profile available");
  });

  it("propagates errors from generateObject", async () => {
    mockGenerateObject.mockRejectedValue(new Error("LLM failure"));
    await expect(analyzeScheduleWorkload(makeContext(), makeEvals())).rejects.toThrow("LLM failure");
  });
});
