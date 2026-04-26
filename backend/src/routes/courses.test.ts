import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const {
  mockGetCourseEvalSummary,
  mockGetSisCourseDetails,
  mockSearchCoursesBySisConstraints,
  mockDbQuery,
} = vi.hoisted(() => ({
  mockGetCourseEvalSummary: vi.fn(),
  mockGetSisCourseDetails: vi.fn(),
  mockSearchCoursesBySisConstraints: vi.fn(),
  mockDbQuery: vi.fn(),
}));

vi.mock("../tools/get-course-eval-summary", () => ({
  getCourseEvalSummary: mockGetCourseEvalSummary,
}));

vi.mock("../services/get-sis-course-details", () => ({
  getSisCourseDetails: mockGetSisCourseDetails,
}));

vi.mock("../db", () => ({
  pool: { query: mockDbQuery },
}));

vi.mock("../tools/search-courses-by-sis-constraints", () => ({
  searchCoursesBySisConstraints: mockSearchCoursesBySisConstraints,
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
    mockDbQuery.mockResolvedValue({ rows: [] });
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

describe("GET /api/courses/sis-search-raw", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbQuery.mockResolvedValue({ rows: [] });
  });

  it("uses DB-first suggestions when available", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ code: "AS.110.304", title: "Chemical Engineering Thermodynamics" }],
    });
    const res = await request(makeApp()).get("/api/courses/sis-search-raw?query=AS.110.304&limit=8");
    expect(res.status).toBe(200);
    expect(res.body.courses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          offeringName: "AS.110.304",
          title: "Chemical Engineering Thermodynamics",
        }),
      ]),
    );
    expect(mockSearchCoursesBySisConstraints).not.toHaveBeenCalled();
  });

  it("falls back to SIS when DB has no results", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockSearchCoursesBySisConstraints.mockResolvedValueOnce({
      courses: [
        {
          offeringName: "EN.601.226",
          title: "Data Structures",
          sectionName: "",
          description: "",
          schoolName: "",
          department: "",
          level: "",
          timeOfDay: "",
          daysOfWeek: "",
          location: "",
          instructors: [],
          status: "",
        },
      ],
    });
    const res = await request(makeApp()).get("/api/courses/sis-search-raw?query=EN.601.226&limit=8");
    expect(res.status).toBe(200);
    expect(res.body.courses[0].offeringName).toBe("EN.601.226");
    expect(mockSearchCoursesBySisConstraints).toHaveBeenCalled();
  });
});

describe("GET /api/courses/:id/details", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns mapped SIS course when found", async () => {
    const mapped = { offeringName: "EN.601.226", title: "Data Structures" };
    mockGetSisCourseDetails.mockResolvedValueOnce({
      courseId: "en-601-226-spring-2026",
      course: mapped,
    });

    const res = await request(makeApp()).get("/api/courses/en-601-226-spring-2026/details");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      courseId: "en-601-226-spring-2026",
      details: mapped,
    });
  });

  it("returns fallback details when SIS course is missing", async () => {
    mockGetSisCourseDetails.mockResolvedValueOnce({
      courseId: "en-553-171-spring-2026",
      course: null,
      message: "Course not found",
    });

    const res = await request(makeApp()).get("/api/courses/en-553-171-spring-2026/details");

    expect(res.status).toBe(200);
    expect(res.body.courseId).toBe("en-553-171-spring-2026");
    expect(res.body.details.title).toBe("Course details unavailable");
    expect(res.body.details.offeringName).toBe("EN.553.171");
    expect(res.body.details.description).toBe("Course not found");
  });

  it("returns fallback details for invalid legacy courseIds", async () => {
    mockGetSisCourseDetails.mockResolvedValueOnce({
      courseId: "AS.010.311-All terms-3",
      course: null,
      message:
        "Invalid courseId format. Expected values like en-553-171-spring-2026 or en-553-171-01-spring-2026.",
    });

    const res = await request(makeApp()).get("/api/courses/AS.010.311-All%20terms-3/details");

    expect(res.status).toBe(200);
    expect(res.body.courseId).toBe("AS.010.311-All terms-3");
    expect(res.body.details.offeringName).toBe("AS.010.311");
    expect(res.body.details.description).toContain("Invalid courseId format");
  });

  it("returns 500 when SIS details service throws", async () => {
    mockGetSisCourseDetails.mockRejectedValueOnce(new Error("SIS timeout"));

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
