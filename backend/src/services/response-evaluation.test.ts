import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGenerateObject = vi.fn();

vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => mockGenerateObject(...args),
}));

vi.mock("@ai-sdk/openai", () => ({
  openai: vi.fn(() => "mock-model"),
}));

vi.mock("../middleware/auth", () => ({
  toDatabaseUserId: (id: string) => id,
}));

import {
  inferQueryType,
  evaluateResponseTypeCorrectness,
  evaluateToolSelectionEfficiency,
  evaluateFormatCompliance,
  evaluateConstraintCompliance,
  maybeReinforceConstraints,
  runResponseEvaluation,
} from "./response-evaluation";
import type { Pool } from "pg";

// ---------------------------------------------------------------------------
// inferQueryType
// ---------------------------------------------------------------------------

describe("inferQueryType", () => {
  it("classifies mutation intent", () => {
    expect(inferQueryType("add EN.601.226 to my schedule")).toBe("mutation");
    expect(inferQueryType("remove this course from schedule")).toBe("mutation");
  });

  it("classifies eval summary intent", () => {
    expect(inferQueryType("how are the professor ratings for intro stats")).toBe("eval_summary");
    expect(inferQueryType("is the workload heavy for this class")).toBe("eval_summary");
  });

  it("classifies details intent", () => {
    expect(inferQueryType("what time does EN.553.171 meet")).toBe("details");
    expect(inferQueryType("who teaches this section")).toBe("details");
  });

  it("classifies search intent", () => {
    expect(inferQueryType("find me intro CS courses")).toBe("search");
    expect(inferQueryType("show me classes about machine learning")).toBe("search");
  });

  it("falls back to text for ambiguous messages", () => {
    expect(inferQueryType("thanks")).toBe("text");
    expect(inferQueryType("that looks good")).toBe("text");
  });
});

// ---------------------------------------------------------------------------
// evaluateFormatCompliance
// ---------------------------------------------------------------------------

describe("evaluateFormatCompliance", () => {
  it("flags null payload", () => {
    expect(evaluateFormatCompliance(null)).not.toBeNull();
  });

  it("flags payload missing type field", () => {
    expect(evaluateFormatCompliance({ results: [] })).not.toBeNull();
  });

  it("passes well-formed payload with type string", () => {
    expect(evaluateFormatCompliance({ type: "search_results", results: [] })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// evaluateResponseTypeCorrectness
// ---------------------------------------------------------------------------

describe("evaluateResponseTypeCorrectness", () => {
  it("passes when response type matches expected types for search query", () => {
    expect(evaluateResponseTypeCorrectness("search", { type: "search_results" })).toBeNull();
    expect(evaluateResponseTypeCorrectness("search", { type: "text" })).toBeNull();
  });

  it("flags when response type mismatches query intent", () => {
    const issue = evaluateResponseTypeCorrectness("search", { type: "schedule_mutation" });
    expect(issue).not.toBeNull();
    expect(issue?.dimension).toBe("response_type");
    expect(issue?.severity).toBe("warn");
  });

  it("passes any type for text query intent", () => {
    expect(evaluateResponseTypeCorrectness("text", { type: "anything" })).toBeNull();
  });

  it("flags missing type field", () => {
    const issue = evaluateResponseTypeCorrectness("search", { results: [] });
    expect(issue).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// evaluateToolSelectionEfficiency
// ---------------------------------------------------------------------------

describe("evaluateToolSelectionEfficiency", () => {
  it("flags search query with no search tool called", () => {
    const issue = evaluateToolSelectionEfficiency("search", []);
    expect(issue).not.toBeNull();
    expect(issue?.dimension).toBe("tool_selection");
  });

  it("passes when a relevant tool was called for search", () => {
    expect(evaluateToolSelectionEfficiency("search", ["searchCourses"])).toBeNull();
    expect(evaluateToolSelectionEfficiency("search", ["semanticCourseSearch"])).toBeNull();
  });

  it("flags eval_summary with no eval tool called", () => {
    const issue = evaluateToolSelectionEfficiency("eval_summary", ["searchCourses"]);
    expect(issue).not.toBeNull();
  });

  it("passes when eval tool was called for eval_summary", () => {
    expect(evaluateToolSelectionEfficiency("eval_summary", ["getCourseEvalSummary"])).toBeNull();
  });

  it("passes mutation and text types regardless of tools", () => {
    expect(evaluateToolSelectionEfficiency("mutation", [])).toBeNull();
    expect(evaluateToolSelectionEfficiency("text", [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// evaluateConstraintCompliance
// ---------------------------------------------------------------------------

describe("evaluateConstraintCompliance", () => {
  beforeEach(() => {
    mockGenerateObject.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("returns empty when there are no constraint memories", async () => {
    const memories = [{ memory_text: "Likes CS", memory_type: "preference", source: "onboarding" }];
    const result = await evaluateConstraintCompliance("find me a class", { type: "text" }, memories);
    expect(result).toEqual([]);
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("returns issues for LLM-reported violations", async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        violations: [{ constraintText: "Avoids Monday classes", explanation: "Response includes Monday section" }],
      },
    });
    const memories = [{ memory_text: "Avoids Monday classes", memory_type: "constraint", source: "onboarding" }];
    const result = await evaluateConstraintCompliance("find me CS courses", { type: "search_results" }, memories);
    expect(result).toHaveLength(1);
    expect(result[0].dimension).toBe("constraint_compliance");
    expect(result[0].detail).toBe("Avoids Monday classes");
    expect(result[0].severity).toBe("error");
  });

  it("returns empty when LLM reports no violations", async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: { violations: [] } });
    const memories = [{ memory_text: "Avoids Monday classes", memory_type: "constraint", source: "onboarding" }];
    const result = await evaluateConstraintCompliance("find me CS courses", { type: "search_results" }, memories);
    expect(result).toEqual([]);
  });

  it("returns empty and logs warn when LLM throws", async () => {
    mockGenerateObject.mockRejectedValueOnce(new Error("API error"));
    const memories = [{ memory_text: "Avoids Monday classes", memory_type: "constraint", source: "onboarding" }];
    const result = await evaluateConstraintCompliance("find me CS courses", { type: "search_results" }, memories);
    expect(result).toEqual([]);
  });

  it("returns empty when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    const memories = [{ memory_text: "Avoids Monday classes", memory_type: "constraint", source: "onboarding" }];
    const result = await evaluateConstraintCompliance("find me CS courses", { type: "search_results" }, memories);
    expect(result).toEqual([]);
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// maybeReinforceConstraints
// ---------------------------------------------------------------------------

function makePool(queryResults: Array<{ rows: unknown[] }>): Pool {
  let callCount = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callCount] ?? { rows: [] };
      callCount++;
      return result;
    }),
  } as unknown as Pool;
}

describe("maybeReinforceConstraints", () => {
  it("does nothing when there are no constraint issues", async () => {
    const pool = makePool([]);
    await maybeReinforceConstraints(pool, "user-1", []);
    expect((pool.query as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("does not insert when violation count is below threshold (2 violations)", async () => {
    const recentLogs = [
      { issues: [{ dimension: "constraint_compliance", severity: "error", detail: "Avoids Monday classes" }] },
      { issues: [{ dimension: "constraint_compliance", severity: "error", detail: "Avoids Monday classes" }] },
    ];
    const pool = makePool([{ rows: recentLogs }, { rows: [] }]);
    const issues = [{ dimension: "constraint_compliance", severity: "error" as const, detail: "Avoids Monday classes" }];
    await maybeReinforceConstraints(pool, "user-1", issues);
    // Query for recent logs runs, but no INSERT (threshold not met)
    const queryCalls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
    const insertCall = queryCalls.find((c: unknown[]) => String(c[0]).includes("INSERT INTO user_memories"));
    expect(insertCall).toBeUndefined();
  });

  it("inserts reinforced memory when violation count reaches threshold (3 violations)", async () => {
    const recentLogs = [
      { issues: [{ dimension: "constraint_compliance", severity: "error", detail: "Avoids Monday classes" }] },
      { issues: [{ dimension: "constraint_compliance", severity: "error", detail: "Avoids Monday classes" }] },
      { issues: [{ dimension: "constraint_compliance", severity: "error", detail: "Avoids Monday classes" }] },
    ];
    // First query: recent logs. Second: check existing reinforced memory (none found). Third: INSERT.
    const pool = makePool([{ rows: recentLogs }, { rows: [] }, { rows: [] }]);
    const issues = [{ dimension: "constraint_compliance", severity: "error" as const, detail: "Avoids Monday classes" }];
    await maybeReinforceConstraints(pool, "user-1", issues);
    const queryCalls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
    const insertCall = queryCalls.find((c: unknown[]) => String(c[0]).includes("INSERT INTO user_memories"));
    expect(insertCall).toBeDefined();
    expect(String(insertCall[1][1])).toContain("IMPORTANT:");
    expect(String(insertCall[1][1])).toContain("Avoids Monday classes");
  });

  it("does not insert when reinforced memory already exists", async () => {
    const recentLogs = [
      { issues: [{ dimension: "constraint_compliance", severity: "error", detail: "Avoids Monday classes" }] },
      { issues: [{ dimension: "constraint_compliance", severity: "error", detail: "Avoids Monday classes" }] },
      { issues: [{ dimension: "constraint_compliance", severity: "error", detail: "Avoids Monday classes" }] },
    ];
    // Second query returns existing reinforced memory row → skip insert
    const pool = makePool([{ rows: recentLogs }, { rows: [{ id: "existing-uuid" }] }]);
    const issues = [{ dimension: "constraint_compliance", severity: "error" as const, detail: "Avoids Monday classes" }];
    await maybeReinforceConstraints(pool, "user-1", issues);
    const queryCalls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
    const insertCall = queryCalls.find((c: unknown[]) => String(c[0]).includes("INSERT INTO user_memories"));
    expect(insertCall).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// runResponseEvaluation (integration-style with mocked pool)
// ---------------------------------------------------------------------------

describe("runResponseEvaluation", () => {
  beforeEach(() => {
    mockGenerateObject.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("never throws even when pool.query rejects", async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error("DB down")) } as unknown as Pool;
    await expect(
      runResponseEvaluation({
        pool,
        appUserId: "user-1",
        userMessage: "find me a CS course",
        assistantMessageId: null,
        finalPayload: { type: "search_results", results: [] },
        toolSteps: ["searchCourses"],
        canonicalMemories: [],
      }),
    ).resolves.toBeUndefined();
  });

  it("writes an eval log row for a well-formed response", async () => {
    const queryCalls: unknown[][] = [];
    const pool = {
      query: vi.fn(async (...args: unknown[]) => {
        queryCalls.push(args);
        return { rows: [] };
      }),
    } as unknown as Pool;

    await runResponseEvaluation({
      pool,
      appUserId: "user-1",
      userMessage: "find me intro CS courses",
      assistantMessageId: "msg-123",
      finalPayload: { type: "search_results", results: [] },
      toolSteps: ["searchCourses"],
      canonicalMemories: [],
    });

    const insertCall = queryCalls.find((c) => String(c[0]).includes("INSERT INTO agent_eval_logs"));
    expect(insertCall).toBeDefined();
  });
});
