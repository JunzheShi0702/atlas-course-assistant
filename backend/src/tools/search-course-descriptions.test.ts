import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGenerateEmbedding, mockQuery } = vi.hoisted(() => ({
  mockGenerateEmbedding: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock("../db", () => ({
  pool: { query: mockQuery },
}));

vi.mock("../services/embeddings", () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

import { searchCourseDescriptions } from "./search-course-descriptions";

describe("searchCourseDescriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns no results and skips dependencies for blank queries", async () => {
    await expect(searchCourseDescriptions({ query: "   " })).resolves.toEqual({ results: [] });

    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("embeds the query and maps ranked vector rows", async () => {
    mockGenerateEmbedding.mockResolvedValueOnce([0.1, 0.2, 0.3]);
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          course_id: "en-601-226-fall-2025",
          code: "EN.601.226",
          sis_offering_name: "EN.601.226.01",
          term: "Fall 2025",
          title: "Data Structures",
          short_description: "Core data structures.",
          similarity: 0.87654,
          credits: "4.00",
        },
        {
          course_id: "en-601-220-fall-2025",
          code: "EN.601.220",
          sis_offering_name: "EN.601.220.01",
          term: "Fall 2025",
          title: "Intermediate Programming",
          short_description: "Programming techniques.",
          similarity: 0.65432,
          credits: null,
        },
      ],
    });

    const result = await searchCourseDescriptions({ query: "EN.601.226", limit: 2 });

    expect(mockGenerateEmbedding).toHaveBeenCalledWith("EN.601.226");
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("course_embeddings"), [
      JSON.stringify([0.1, 0.2, 0.3]),
      2,
      0.3,
    ]);
    expect(result.results).toEqual([
      {
        courseId: "en-601-226-fall-2025",
        sisOfferingName: "EN.601.226.01",
        code: "EN.601.226",
        title: "Data Structures",
        description: "Core data structures.",
        term: "Fall 2025",
        credits: 4,
        rank: 1,
        relevanceScore: 0.877,
        clearlyMatches: true,
      },
      {
        courseId: "en-601-220-fall-2025",
        sisOfferingName: "EN.601.220.01",
        code: "EN.601.220",
        title: "Intermediate Programming",
        description: "Programming techniques.",
        term: "Fall 2025",
        credits: undefined,
        rank: 2,
        relevanceScore: 0.654,
        clearlyMatches: false,
      },
    ]);
  });

  it("uses default limit when omitted", async () => {
    mockGenerateEmbedding.mockResolvedValueOnce([0.4]);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await searchCourseDescriptions({ query: "machine learning" });

    expect(mockQuery.mock.calls[0][1]).toEqual([JSON.stringify([0.4]), 5, 0.3]);
  });
});
