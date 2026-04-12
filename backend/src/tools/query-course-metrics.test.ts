import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock("../db", () => ({
  pool: { query: mockQuery },
}));

import {
  aggregateCourseMetrics,
  buildQueryCourseMetricsNoDataMessage,
  normalizeCourseMetricsTerm,
  queryCourseMetrics,
} from "./query-course-metrics";

describe("queryCourseMetrics", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("returns metrics: null when no evaluation rows exist for the course and term", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    await expect(
      queryCourseMetrics("EN.601.226", "Spring 2026"),
    ).resolves.toEqual({
      courseCode: "EN.601.226",
      term: "Spring 2026",
      metrics: null,
    });
  });

  it("normalizes the requested term before querying and returning results", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          semester: "Spring 2026",
          instructor: "Prof A",
          overall_quality: "4.0",
          teaching_effectiveness: "4.0",
          intellectual_challange: "3.0",
          work_load: "2.0",
          feedback_quality: "4.0",
          num_respondents: 10,
        },
      ],
    } as never);

    const result = await queryCourseMetrics("EN.601.226", "  spring   2026 ");

    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [
      "EN.601.226",
      "Spring 2026",
    ]);
    expect(result.term).toBe("Spring 2026");
  });

  it("resolves bare course codes before querying metrics", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ course_code: "AS.601.226" }],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            semester: "Spring 2026",
            instructor: "Prof A",
            overall_quality: "4.0",
            teaching_effectiveness: "4.0",
            intellectual_challange: "3.0",
            work_load: "2.0",
            feedback_quality: "4.0",
            num_respondents: 10,
          },
        ],
      } as never);

    const result = await queryCourseMetrics("601.226", "Spring 2026");

    expect(result.courseCode).toBe("AS.601.226");
    expect(mockQuery).toHaveBeenNthCalledWith(2, expect.any(String), [
      "AS.601.226",
      "Spring 2026",
    ]);
  });

  it("aggregates all sections for a course and term using respondentCount weighting", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          semester: "Spring 2026",
          instructor: "Prof A",
          overall_quality: "4.0",
          teaching_effectiveness: "4.0",
          intellectual_challange: "3.0",
          work_load: "2.0",
          feedback_quality: "4.0",
          num_respondents: 10,
        },
        {
          semester: "Spring 2026",
          instructor: "Prof B",
          overall_quality: "5.0",
          teaching_effectiveness: "4.0",
          intellectual_challange: "4.0",
          work_load: "3.0",
          feedback_quality: "4.0",
          num_respondents: 30,
        },
      ],
    } as never);

    await expect(
      queryCourseMetrics("EN.601.226", "Spring 2026"),
    ).resolves.toEqual({
      courseCode: "EN.601.226",
      term: "Spring 2026",
      metrics: {
        workload: 2.75,
        difficulty: 3.75,
        overallQuality: 4.75,
        respondentCount: 40,
      },
    });
  });

  it("returns stable numeric rounding to two decimals", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          semester: "Spring 2026",
          instructor: "Prof A",
          overall_quality: "4.0",
          teaching_effectiveness: "4.0",
          intellectual_challange: "3.0",
          work_load: "2.0",
          feedback_quality: "4.0",
          num_respondents: 1,
        },
        {
          semester: "Spring 2026",
          instructor: "Prof B",
          overall_quality: "4.0",
          teaching_effectiveness: "4.0",
          intellectual_challange: "4.0",
          work_load: "2.0",
          feedback_quality: "4.0",
          num_respondents: 2,
        },
        {
          semester: "Spring 2026",
          instructor: "Prof C",
          overall_quality: "4.0",
          teaching_effectiveness: "4.0",
          intellectual_challange: "5.0",
          work_load: "5.0",
          feedback_quality: "4.0",
          num_respondents: 3,
        },
      ],
    } as never);

    const result = await queryCourseMetrics("EN.601.226", "Spring 2026");
    expect(result.metrics?.difficulty).toBe(4.33);
    expect(result.metrics?.workload).toBe(3.5);
  });

  it("ignores invalid metric values and non-positive respondent counts", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          semester: "Spring 2026",
          instructor: "Prof A",
          overall_quality: "4.0",
          teaching_effectiveness: "4.0",
          intellectual_challange: "invalid",
          work_load: "-1.0",
          feedback_quality: "4.0",
          num_respondents: 10,
        },
        {
          semester: "Spring 2026",
          instructor: "Prof B",
          overall_quality: "9.0",
          teaching_effectiveness: "4.0",
          intellectual_challange: "3.5",
          work_load: "2.5",
          feedback_quality: "4.0",
          num_respondents: 0,
        },
        {
          semester: "Spring 2026",
          instructor: "Prof C",
          overall_quality: "4.5",
          teaching_effectiveness: "4.0",
          intellectual_challange: "4.0",
          work_load: "3.0",
          feedback_quality: "4.0",
          num_respondents: 20,
        },
      ],
    } as never);

    await expect(
      queryCourseMetrics("EN.601.226", "Spring 2026"),
    ).resolves.toEqual({
      courseCode: "EN.601.226",
      term: "Spring 2026",
      metrics: {
        workload: 3,
        difficulty: 4,
        overallQuality: 4.33,
        respondentCount: 30,
      },
    });
  });

  it("keeps partial metric results when only some columns have usable values", () => {
    expect(
      aggregateCourseMetrics([
        {
          semester: "Spring 2026",
          instructor: "Prof A",
          overall_quality: "4.0",
          teaching_effectiveness: "4.0",
          intellectual_challange: null,
          work_load: null,
          feedback_quality: "4.0",
          num_respondents: 10,
        },
      ]),
    ).toEqual({
      workload: null,
      difficulty: null,
      overallQuality: 4,
      respondentCount: 10,
    });
  });

  it("returns null metrics when rows exist but none contain usable metric data", () => {
    expect(
      aggregateCourseMetrics([
        {
          semester: "Spring 2026",
          instructor: "Prof A",
          overall_quality: "invalid",
          teaching_effectiveness: "4.0",
          intellectual_challange: null,
          work_load: null,
          feedback_quality: "4.0",
          num_respondents: 0,
        },
      ]),
    ).toBeNull();
  });
});

describe("query course metric helpers", () => {
  it("normalizes common academic term formatting", () => {
    expect(normalizeCourseMetricsTerm("  summer   2   2026 ")).toBe("Summer 2 2026");
    expect(normalizeCourseMetricsTerm("fall 2026")).toBe("Fall 2026");
    expect(normalizeCourseMetricsTerm("Quarter 1 2026")).toBe("Quarter 1 2026");
  });

  it("builds a reusable no-data message for downstream callers", () => {
    expect(buildQueryCourseMetricsNoDataMessage("EN.601.226", "Spring 2026")).toBe(
      "No course evaluation metrics were found for EN.601.226 in Spring 2026.",
    );
  });
});
