import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { mockGetCourseEvalSummary, mockFetchSisCourseDetails, mockMapRawToSisCourse } = vi.hoisted(() => ({
  mockGetCourseEvalSummary: vi.fn(),
  mockFetchSisCourseDetails: vi.fn(),
  mockMapRawToSisCourse: vi.fn(),
}));

vi.mock("../tools/get-course-eval-summary", () => ({
  getCourseEvalSummary: mockGetCourseEvalSummary,
}));

vi.mock("../services/sis-client", () => ({
  fetchSisCourseDetails: mockFetchSisCourseDetails,
}));

vi.mock("../tools/search-courses-by-sis-constraints", () => ({
  mapRawToSisCourse: mockMapRawToSisCourse,
}));

import coursesRouter from "./courses";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/courses", coursesRouter);
  return app;
}

describe("GET /api/courses/:id/eval-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns tool output on success", async () => {
    mockGetCourseEvalSummary.mockResolvedValueOnce({
      courseId: "en-601-226-spring-2026",
      hasData: true,
      summaryText: "Great course.",
      sourceData: [
        {
          term: "Spring 2025",
          instructor: "Dr. Ada",
          metricName: "overall_quality",
          metricLabel: "Overall Quality",
          metricValue: 4.6,
          respondentCount: 20,
        },
      ],
      sourceDataMeta: {
        totalDataPoints: 1,
        returnedDataPoints: 1,
        truncated: false,
      },
    });

    const res = await request(makeApp()).get("/api/courses/en-601-226-spring-2026/eval-summary");

    expect(res.status).toBe(200);
    expect(res.body.summaryText).toBe("Great course.");
    expect(res.body.sourceData).toHaveLength(1);
    expect(res.body.sourceData[0].metricName).toBe("overall_quality");
    expect(res.body.sourceDataMeta).toEqual({
      totalDataPoints: 1,
      returnedDataPoints: 1,
      truncated: false,
    });
    expect(mockGetCourseEvalSummary).toHaveBeenCalledWith("en-601-226-spring-2026");
  });

  it("returns no-data shape with empty sourceData", async () => {
    mockGetCourseEvalSummary.mockResolvedValueOnce({
      hasData: false,
      message: "No evaluation data found for this course.",
      sourceData: [],
      sourceDataMeta: {
        totalDataPoints: 0,
        returnedDataPoints: 0,
        truncated: false,
      },
    });

    const res = await request(makeApp()).get("/api/courses/en-601-999-spring-2026/eval-summary");

    expect(res.status).toBe(200);
    expect(res.body.hasData).toBe(false);
    expect(res.body.sourceData).toEqual([]);
    expect(res.body.sourceDataMeta).toEqual({
      totalDataPoints: 0,
      returnedDataPoints: 0,
      truncated: false,
    });
  });

  it("returns 500 when tool throws", async () => {
    mockGetCourseEvalSummary.mockRejectedValueOnce(new Error("llm down"));

    const res = await request(makeApp()).get("/api/courses/en-601-226-spring-2026/eval-summary");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to generate evaluation summary." });
  });
});

describe("GET /api/courses/:id/details", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps SIS course when found", async () => {
    const raw = { OfferingName: "EN.601.226" };
    const mapped = { offeringName: "EN.601.226", title: "Data Structures" };
    mockFetchSisCourseDetails.mockResolvedValueOnce(raw);
    mockMapRawToSisCourse.mockReturnValueOnce(mapped);

    const res = await request(makeApp()).get("/api/courses/en-601-226-spring-2026/details");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      courseId: "en-601-226-spring-2026",
      details: mapped,
    });
  });

  it("returns fallback details when SIS course is missing", async () => {
    mockFetchSisCourseDetails.mockResolvedValueOnce(null);

    const res = await request(makeApp()).get("/api/courses/en-553-171-spring-2026/details");

    expect(res.status).toBe(200);
    expect(res.body.courseId).toBe("en-553-171-spring-2026");
    expect(res.body.details.title).toBe("Course details unavailable");
    expect(res.body.details.offeringName).toBe("EN.553.171");
  });

  it("returns 500 when SIS fetch throws", async () => {
    mockFetchSisCourseDetails.mockRejectedValueOnce(new Error("SIS timeout"));

    const res = await request(makeApp()).get("/api/courses/en-553-171-spring-2026/details");

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      error: "Failed to fetch course details",
      detail: "SIS timeout",
      courseId: "en-553-171-spring-2026",
      details: null,
    });
  });
});
