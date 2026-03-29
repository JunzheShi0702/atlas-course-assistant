import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class OpenAI {
    embeddings = { create: mockCreate };
  },
}));

import { generateEmbedding, generateEmbeddingsBatch } from "./embeddings";

describe("embeddings service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generateEmbedding trims input and returns first embedding", async () => {
    mockCreate.mockResolvedValueOnce({
      data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
    });

    const embedding = await generateEmbedding("  data structures  ");

    expect(mockCreate).toHaveBeenCalledWith({
      model: "text-embedding-3-small",
      input: "data structures",
    });
    expect(embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it("generateEmbeddingsBatch trims inputs and returns embeddings sorted by index", async () => {
    mockCreate.mockResolvedValueOnce({
      data: [
        { index: 1, embedding: [2, 2] },
        { index: 0, embedding: [1, 1] },
      ],
    });

    const embeddings = await generateEmbeddingsBatch(["  first  ", " second"]);

    expect(mockCreate).toHaveBeenCalledWith({
      model: "text-embedding-3-small",
      input: ["first", "second"],
    });
    expect(embeddings).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });
});
