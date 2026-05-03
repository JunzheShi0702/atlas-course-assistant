import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock("./pool", () => ({
  pool: { query: mockQuery },
}));

import { cacheCourseSummary, getCachedCourseSummary } from "./db";

const validSummary = {
  hasData: false,
  message: "No evaluation data found for this course.",
  sourceData: [],
  sourceDataMeta: {
    totalDataPoints: 0,
    returnedDataPoints: 0,
    truncated: false,
  },
};

describe("course summary cache helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when there is no cached row", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(getCachedCourseSummary("EN.601.226")).resolves.toBeNull();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][1]).toEqual(["EN.601.226"]);
  });

  it("returns cached summary when latest eval term matches", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ summary: validSummary, latest_term: "Spring 2025" }],
      })
      .mockResolvedValueOnce({
        rows: [{ semester: "Fall 2024" }, { semester: "Spring 2025" }],
      });

    await expect(getCachedCourseSummary("EN.601.226")).resolves.toEqual(validSummary);
  });

  it("invalidates cached summary when fresher eval data exists", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ summary: validSummary, latest_term: "Fall 2024" }],
      })
      .mockResolvedValueOnce({
        rows: [{ semester: "Fall 2024" }, { semester: "Spring 2025" }],
      });

    await expect(getCachedCourseSummary("EN.601.226")).resolves.toBeNull();
  });

  it("rejects invalid cached JSON shape", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ summary: { hasData: true }, latest_term: "Spring 2025" }],
      })
      .mockResolvedValueOnce({
        rows: [{ semester: "Spring 2025" }],
      });

    await expect(getCachedCourseSummary("EN.601.226")).resolves.toBeNull();
  });

  it("upserts serialized summaries", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await cacheCourseSummary("EN.601.226", "Spring 2025", validSummary);

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT"), [
      "EN.601.226",
      "Spring 2025",
      JSON.stringify(validSummary),
    ]);
  });
});
