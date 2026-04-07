import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { mockSearchCourseDescriptions } = vi.hoisted(() => ({
  mockSearchCourseDescriptions: vi.fn(),
}));

vi.mock("../tools/search-course-descriptions", () => ({
  searchCourseDescriptions: mockSearchCourseDescriptions,
}));

import searchRouter from "./search";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/search", searchRouter);
  return app;
}

describe("GET /api/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when query is missing", async () => {
    const res = await request(makeApp()).get("/api/search");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "query is required" });
    expect(mockSearchCourseDescriptions).not.toHaveBeenCalled();
  });

  it("uses default limit=5 when limit is omitted", async () => {
    mockSearchCourseDescriptions.mockResolvedValueOnce({ results: [] });

    const res = await request(makeApp()).get("/api/search").query({ query: "machine learning" });

    expect(res.status).toBe(200);
    expect(mockSearchCourseDescriptions).toHaveBeenCalledWith({
      query: "machine learning",
      limit: 5,
    });
  });

  it("forwards explicit numeric limit", async () => {
    mockSearchCourseDescriptions.mockResolvedValueOnce({ results: [] });

    const res = await request(makeApp()).get("/api/search").query({ query: "cs", limit: "7" });

    expect(res.status).toBe(200);
    expect(mockSearchCourseDescriptions).toHaveBeenCalledWith({
      query: "cs",
      limit: 7,
    });
  });

  it("returns 500 when search tool throws", async () => {
    mockSearchCourseDescriptions.mockRejectedValueOnce(new Error("search failed"));

    const res = await request(makeApp()).get("/api/search").query({ query: "algorithms" });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Search failed. Please try again." });
  });
});
