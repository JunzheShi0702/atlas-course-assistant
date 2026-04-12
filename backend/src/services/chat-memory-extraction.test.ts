import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGenerateObject = vi.fn();
const mockGenerateEmbeddingsBatch = vi.fn();

vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => mockGenerateObject(...args),
}));

vi.mock("@ai-sdk/openai", () => ({
  openai: vi.fn(() => "mock-model"),
}));

vi.mock("./embeddings", () => ({
  generateEmbeddingsBatch: (...args: unknown[]) => mockGenerateEmbeddingsBatch(...args),
}));

import {
  cosineSimilarity,
  filterDuplicateMemoryCandidates,
  CHAT_MEMORY_DEDUP_THRESHOLD,
  confidencePercentToStoredValue,
  runChatMemoryExtraction,
} from "./chat-memory-extraction";
import type { Pool } from "pg";

describe("confidencePercentToStoredValue", () => {
  it("maps 0–100 to 0.00–1.00 for NUMERIC(3,2)", () => {
    expect(confidencePercentToStoredValue(0)).toBe(0);
    expect(confidencePercentToStoredValue(100)).toBe(1);
    expect(confidencePercentToStoredValue(85)).toBe(0.85);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical unit vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBe(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });
});

describe("filterDuplicateMemoryCandidates", () => {
  it("returns empty when a candidate embedding matches an existing memory", () => {
    const existing = ["older memory"];
    const candidates = [{ memory_text: "new", memory_type: "preference" as const, confidence: 80 }];
    const embeddings = [
      [1, 0, 0],
      [0.99, 0.01, 0],
    ];
    expect(filterDuplicateMemoryCandidates(existing, candidates, embeddings, 0.88)).toEqual([]);
  });

  it("keeps candidates that are not similar to existing or prior kept candidates", () => {
    const existing: string[] = [];
    const candidates = [
      { memory_text: "a", memory_type: "preference" as const, confidence: 80 },
      { memory_text: "b", memory_type: "goal" as const, confidence: 75 },
    ];
    const embeddings = [
      [1, 0, 0],
      [0, 1, 0],
    ];
    expect(filterDuplicateMemoryCandidates(existing, candidates, embeddings, CHAT_MEMORY_DEDUP_THRESHOLD)).toEqual([
      0, 1,
    ]);
  });

  it("drops second candidate when it matches the first new candidate in the batch", () => {
    const existing: string[] = [];
    const candidates = [
      { memory_text: "a", memory_type: "preference" as const, confidence: 80 },
      { memory_text: "b", memory_type: "preference" as const, confidence: 82 },
    ];
    const embeddings = [
      [1, 0, 0],
      [0.99, 0.01, 0],
    ];
    expect(filterDuplicateMemoryCandidates(existing, candidates, embeddings, 0.88)).toEqual([0]);
  });
});

describe("runChatMemoryExtraction", () => {
  const mockQuery = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateObject.mockResolvedValue({
      object: {
        memories: [
          {
            memory_text: "Prefers morning sections when possible",
            memory_type: "preference",
            confidence: 90,
          },
        ],
      },
    });
    mockGenerateEmbeddingsBatch.mockResolvedValue([[1, 0, 0], [0, 1, 0]]);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ memory_text: "existing" }] })
      .mockResolvedValueOnce({ rows: [] });
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("inserts non-duplicate memories when embeddings differ from existing", async () => {
    const pool = { query: mockQuery } as unknown as Pool;
    await runChatMemoryExtraction({
      pool,
      appUserId: "00000000-0000-0000-0000-000000000001",
      userMessage: "Generally I learn better in the morning and want to avoid late classes.",
      userMessageId: "11111111-1111-1111-1111-111111111111",
    });

    expect(mockGenerateObject).toHaveBeenCalled();
    expect(mockGenerateEmbeddingsBatch).toHaveBeenCalled();
    const insertCalls = mockQuery.mock.calls.filter((c) => String(c[0]).includes("INSERT INTO user_memories"));
    expect(insertCalls.length).toBe(1);
    expect(insertCalls[0][1]).toEqual([
      "00000000-0000-0000-0000-000000000001",
      "Prefers morning sections when possible",
      "preference",
      0.9,
      "11111111-1111-1111-1111-111111111111",
    ]); // 90% → 0.90 in DB
  });

  it("skips LLM when message is too short", async () => {
    const pool = { query: mockQuery } as unknown as Pool;
    await runChatMemoryExtraction({
      pool,
      appUserId: "u1",
      userMessage: "ok thanks",
      userMessageId: "11111111-1111-1111-1111-111111111111",
    });
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("skips when OPENAI_API_KEY is unset", async () => {
    delete process.env.OPENAI_API_KEY;
    const pool = { query: mockQuery } as unknown as Pool;
    await runChatMemoryExtraction({
      pool,
      appUserId: "u1",
      userMessage: "I generally prefer small seminars and discussion-based courses for humanities.",
      userMessageId: "11111111-1111-1111-1111-111111111111",
    });
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });
});
