import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGenerateObject } = vi.hoisted(() => {
  const mockGenerateObject = vi.fn();
  return { mockGenerateObject };
});

vi.mock("ai", () => ({ generateObject: mockGenerateObject }));
vi.mock("@ai-sdk/openai", () => ({ openai: vi.fn(() => "mock-model") }));

import {
  analyzeScheduleWorkload,
  buildDefaultGoalAlignment,
  calculateWorkloadRange,
  groundAuditRecommendations,
  normalizeGoalAlignment,
} from "./analyze-schedule-workload";
import { ScheduleAgentContext } from "../services/schedule-context";
import { AuditEvalMetrics } from "../types/eval-summary";

// LLM returns only the qualitative fields now; workloadRange is deterministic
const mockLlmObject = {
  narrativeSummary: "This is a manageable schedule.",
  goalAlignment: {
    score: 4.2,
    rationale: "The schedule supports the student's ML goals while keeping a manageable balance.",
    alignedGoals: ["I want to get into ML research."],
    conflicts: [],
  },
  recommendations: ["EN.601.320"],
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
  canonicalMemories: [],
  ...overrides,
});

const makeEvals = (): Record<string, AuditEvalMetrics | null> => ({
  "EN.601.226": {
    overallQuality: 4.1,
    teachingEffectiveness: 4.0,
    difficulty: 3.5,
    workload: 3.8,
    feedbackQuality: 3.9,
    sampleSize: 42,
    sectionCount: 2,
  },
  "EN.553.171": {
    overallQuality: 3.7,
    teachingEffectiveness: 3.6,
    difficulty: 3.9,
    workload: 3.2,
    feedbackQuality: 3.5,
    sampleSize: 31,
    sectionCount: 1,
  },
});

const recommendationCandidates = [
  {
    courseCode: "EN.601.320",
    sisOfferingName: "EN.601.320",
    term: "Spring 2026",
    title: "Parallel Programming",
    overallQuality: 4.5,
    workload: 3.1,
    difficulty: 3.4,
    respondentCount: 30,
  },
];

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
      "EN.601.226": { overallQuality: 3, teachingEffectiveness: 3, difficulty: 3, workload: 3, feedbackQuality: 3, sampleSize: 10, sectionCount: 1 },
      "EN.553.171": { overallQuality: 3, teachingEffectiveness: 3, difficulty: 3, workload: 3, feedbackQuality: 3, sampleSize: 10, sectionCount: 1 },
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
      "EN.601.226": { overallQuality: 5, teachingEffectiveness: 5, difficulty: 5, workload: 5, feedbackQuality: 5, sampleSize: 10, sectionCount: 1 },
      "EN.553.171": { overallQuality: 5, teachingEffectiveness: 5, difficulty: 5, workload: 5, feedbackQuality: 5, sampleSize: 10, sectionCount: 1 },
    };
    const result = calculateWorkloadRange(makeContext().courses, evals);
    expect(result).toEqual({ min: 15, max: 21 });
  });

  it("scales correctly at score=1", () => {
    // score=1 → 1 hr/credit; 3 credits × 1 = 3 hrs × 2 courses = 6 pts
    // min=round(6*0.85)=5, max=round(6*1.15)=7
    const evals = {
      "EN.601.226": { overallQuality: 1, teachingEffectiveness: 1, difficulty: 1, workload: 1, feedbackQuality: 1, sampleSize: 10, sectionCount: 1 },
      "EN.553.171": { overallQuality: 1, teachingEffectiveness: 1, difficulty: 1, workload: 1, feedbackQuality: 1, sampleSize: 10, sectionCount: 1 },
    };
    const result = calculateWorkloadRange(makeContext().courses, evals);
    expect(result).toEqual({ min: 5, max: 7 });
  });

  it("falls back to neutral workload when only partial metrics are available", () => {
    const evals = {
      "EN.601.226": {
        overallQuality: 4.2,
        teachingEffectiveness: 4.1,
        difficulty: 3.4,
        workload: null,
        feedbackQuality: null,
        sampleSize: 12,
        sectionCount: 1,
      },
      "EN.553.171": null,
    };
    const result = calculateWorkloadRange(makeContext().courses, evals);
    expect(result).toEqual({ min: 10, max: 14 });
  });
});

// ---------------------------------------------------------------------------
// analyzeScheduleWorkload
// ---------------------------------------------------------------------------

describe("analyzeScheduleWorkload", () => {
  it("returns deterministic workloadRange merged with LLM qualitative fields", async () => {
    const result = await analyzeScheduleWorkload(makeContext(), makeEvals(), recommendationCandidates);
    // workloadRange comes from calculateWorkloadRange, not the LLM
    expect(result.workloadRange).toBeDefined();
    expect(result.narrativeSummary).toBe(mockLlmObject.narrativeSummary);
    expect(result.goalAlignment).toEqual(mockLlmObject.goalAlignment);
    expect(result.recommendations).toEqual([]);
  });

  it("includes pre-calculated workload in prompt", async () => {
    await analyzeScheduleWorkload(makeContext(), makeEvals(), recommendationCandidates);
    const call = mockGenerateObject.mock.calls[0][0];
    expect(call.prompt).toContain("Pre-calculated weekly workload");
    expect(call.prompt).toContain("hrs/week");
  });

  it("includes credits column in course table", async () => {
    await analyzeScheduleWorkload(makeContext(), makeEvals(), recommendationCandidates);
    const call = mockGenerateObject.mock.calls[0][0];
    expect(call.prompt).toContain("Credits");
    expect(call.prompt).toContain("3");
  });

  it("handles partial null evals without throwing", async () => {
    const evals: Record<string, AuditEvalMetrics | null> = {
      "EN.601.226": {
        overallQuality: 4.1,
        teachingEffectiveness: 4.0,
        difficulty: 3.5,
        workload: 3.8,
        feedbackQuality: 3.9,
        sampleSize: 20,
        sectionCount: 1,
      },
      "EN.553.171": null,
    };
    const result = await analyzeScheduleWorkload(makeContext(), evals, recommendationCandidates);
    expect(result.workloadRange).toBeDefined();
    const call = mockGenerateObject.mock.calls[0][0];
    expect(call.prompt).toContain("no eval data");
  });

  it("omits workloadRange when no courses have credits", async () => {
    const context = makeContext({
      courses: makeContext().courses.map((c) => ({ ...c, credits: null })),
    });
    const result = await analyzeScheduleWorkload(context, makeEvals(), recommendationCandidates);
    expect(result.workloadRange).toBeUndefined();
  });

  it("handles null profile gracefully", async () => {
    const result = await analyzeScheduleWorkload(
      makeContext({ profile: null }),
      makeEvals(),
      recommendationCandidates,
    );
    expect(result.narrativeSummary).toBe(mockLlmObject.narrativeSummary);
    const call = mockGenerateObject.mock.calls[0][0];
    expect(call.prompt).toContain("No profile available");
    expect(call.prompt).toContain("No structured long-term memories stored.");
  });

  it("calls out partial evaluation metrics and respondent counts in the prompt", async () => {
    const evals: Record<string, AuditEvalMetrics | null> = {
      "EN.601.226": {
        overallQuality: 4.1,
        teachingEffectiveness: null,
        difficulty: 3.5,
        workload: null,
        feedbackQuality: 3.9,
        sampleSize: 8,
        sectionCount: 1,
      },
      "EN.553.171": null,
    };

    await analyzeScheduleWorkload(makeContext(), evals, recommendationCandidates);

    const call = mockGenerateObject.mock.calls[0][0];
    expect(call.prompt).toContain("partial evaluation data; missing workload, teaching");
    expect(call.prompt).toContain("Respondents");
    expect(call.prompt).toContain("| 8 |");
    expect(call.system).toContain("OUTPUT RULES");
    expect(call.system).toContain("name those specific courses and limitations");
  });

  it('allows quantitative metric references when Evaluation Data Notes is "None."', async () => {
    await analyzeScheduleWorkload(makeContext(), makeEvals(), recommendationCandidates);

    const call = mockGenerateObject.mock.calls[0][0];
    expect(call.prompt).toContain("Evaluation Data Notes:\nNone.");
    expect(call.prompt).toContain("you may cite the provided quantitative evaluation metrics directly");
    expect(call.system).toContain("you may cite those quantitative metrics directly");
  });

  it("propagates errors from generateObject", async () => {
    mockGenerateObject.mockRejectedValue(new Error("LLM failure"));
    await expect(
      analyzeScheduleWorkload(makeContext(), makeEvals(), recommendationCandidates),
    ).rejects.toThrow("LLM failure");
  });

  it("includes legacy derived memories in the long-term memory section when canonical store is empty", async () => {
    await analyzeScheduleWorkload(
      makeContext({ canonicalMemories: [] }),
      makeEvals(),
      recommendationCandidates,
    );
    const call = mockGenerateObject.mock.calls[0][0];
    expect(call.prompt).toContain("Long-term memories (same canonical store");
    expect(call.prompt).toContain("Derived memories (legacy JSON from onboarding");
    expect(call.prompt).toContain("Targeting ML PhD programs");
  });

  it("includes canonical user_memories in the audit prompt and does not duplicate legacy JSON when canonical rows exist", async () => {
    const base = makeContext();
    await analyzeScheduleWorkload(
      {
        ...base,
        canonicalMemories: [
          { memory_text: "Prefer no Friday exams", memory_type: "constraint", source: "chat" },
        ],
        profile: base.profile
          ? {
              ...base.profile,
              derivedMemories: [{ type: "goal", content: "Should not appear when canonical wins" }],
            }
          : null,
      },
      makeEvals(),
      recommendationCandidates,
    );
    const call = mockGenerateObject.mock.calls[0][0];
    expect(call.prompt).toContain("Structured memories (canonical store — user_memories):");
    expect(call.prompt).toContain("Prefer no Friday exams");
    expect(call.prompt).not.toContain("Should not appear when canonical wins");
  });

  it("mentions long-term memories in the system prompt for goal alignment", async () => {
    await analyzeScheduleWorkload(makeContext(), makeEvals(), recommendationCandidates);
    const call = mockGenerateObject.mock.calls[0][0];
    expect(call.system).toContain("long-term memories");
  });
});

describe("goal alignment helpers", () => {
  it("builds an explicit fallback object when no goals are available", () => {
    expect(buildDefaultGoalAlignment(makeContext({ profile: null, canonicalMemories: [] }))).toEqual({
      score: null,
      rationale: "No explicit goals were available, so goal alignment could not be scored confidently.",
      alignedGoals: [],
      conflicts: [],
    });
  });

  it("uses only explicit goals in fallback goal alignment and excludes constraint tokens", () => {
    expect(
      buildDefaultGoalAlignment(
        makeContext({
          canonicalMemories: [
            { memory_text: "Prefer Tue/Thu afternoons", memory_type: "constraint", source: "chat" },
            { memory_text: "Software Engineering", memory_type: "goal", source: "chat" },
          ],
        }),
      ),
    ).toEqual({
      score: null,
      rationale: "Goal alignment needs to be interpreted from the student's stated goals, preferences, and available schedule data.",
      alignedGoals: ["I want to get into ML research.", "Software Engineering"],
      conflicts: [],
    });
  });

  it("normalizes sparse LLM goal-alignment output against the fallback shape", () => {
    expect(
      normalizeGoalAlignment(
        {
          score: null,
          rationale: "",
          alignedGoals: ["I want to get into ML research.", ""],
          conflicts: ["", "The plan may be heavier than preferred."],
        },
        makeContext(),
      ),
    ).toEqual({
      score: null,
      rationale: "Goal alignment needs to be interpreted from the student's stated goals, preferences, and available schedule data.",
      alignedGoals: ["I want to get into ML research."],
      conflicts: ["The plan may be heavier than preferred."],
    });
  });

  it("grounds selected offering names to exact recommendation objects", () => {
    expect(
      groundAuditRecommendations(
        ["EN.601.320", "EN.999.999"],
        recommendationCandidates,
      ),
    ).toEqual([
      {
        courseCode: "EN.601.320",
        sisOfferingName: "EN.601.320",
        term: "Spring 2026",
        title: "Parallel Programming",
      },
    ]);
  });
});
