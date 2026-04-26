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
  clampCourseMetricsTermToAllowedWindow,
  formatEvaluationsTermRange,
  maxAllowedExplicitCourseMetricsTerm,
  normalizeCourseMetricsTerm,
  queryCourseMetrics,
} from "./query-course-metrics";

const sampleRow = (semester: string, workload: string, respondents: number) => ({
  semester,
  instructor: "Prof A",
  overall_quality: "4.0",
  teaching_effectiveness: "4.0",
  intellectual_challange: "3.0",
  work_load: workload,
  feedback_quality: "4.0",
  num_respondents: respondents,
});

describe("queryCourseMetrics", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("returns metrics: null when no exact-term or historical rows exist", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    await expect(
      queryCourseMetrics("EN.601.226", "Spring 2026"),
    ).resolves.toEqual({
      courseCode: "EN.601.226",
      requestedTerm: "Spring 2026",
      evaluationsTermRange: null,
      term: "Spring 2026",
      scope: "term-specific",
      meta: {
        semestersIncluded: [],
        evaluationRowCount: 0,
        termFilterApplied: "Spring 2026",
      },
      metrics: null,
      metricsSource: null,
    });
    expect(mockQuery).toHaveBeenNthCalledWith(1, expect.stringContaining("semester = $2"), [
      "EN.601.226",
      "Spring 2026",
    ]);
    expect(mockQuery).toHaveBeenNthCalledWith(2, expect.stringContaining("IS DISTINCT FROM $2"), [
      "EN.601.226",
      "Spring 2026",
    ]);
  });

  it("defaults to cross-term aggregation when term is omitted", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          semester: "Fall 2025",
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

    await expect(queryCourseMetrics("EN.601.226")).resolves.toEqual({
      courseCode: "EN.601.226",
      requestedTerm: "All terms",
      evaluationsTermRange: "Fall 2025 – Spring 2026",
      term: "All terms",
      scope: "cross-term",
      meta: {
        semestersIncluded: ["Spring 2026", "Fall 2025"],
        evaluationRowCount: 2,
        termFilterApplied: null,
      },
      metrics: {
        workload: 2.75,
        difficulty: 3.75,
        overallQuality: 4.75,
        respondentCount: 40,
      },
      metricsSource: "all_available",
    });
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ["EN.601.226"]);
  });

  it("treats common all-term aliases as cross-term scope", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          semester: "Fall 2025",
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

    const result = await queryCourseMetrics("EN.601.226", " overall ");

    expect(result.scope).toBe("cross-term");
    expect(result.term).toBe("All terms");
    expect(result.requestedTerm).toBe("All terms");
    expect(result.meta).toEqual({
      semestersIncluded: ["Fall 2025"],
      evaluationRowCount: 1,
      termFilterApplied: null,
    });
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ["EN.601.226"]);
  });

  it("trims course code input before resolving and querying", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ course_code: "AS.601.226" }],
      } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    const result = await queryCourseMetrics("  601.226  ", "Spring 2026");

    expect(result.courseCode).toBe("AS.601.226");
    expect(result.meta.termFilterApplied).toBe("Spring 2026");
    expect(mockQuery).toHaveBeenNthCalledWith(1, expect.any(String), ["%.601.226"]);
    expect(mockQuery).toHaveBeenNthCalledWith(2, expect.stringContaining("semester = $2"), [
      "AS.601.226",
      "Spring 2026",
    ]);
    expect(mockQuery).toHaveBeenNthCalledWith(3, expect.stringContaining("IS DISTINCT FROM $2"), [
      "AS.601.226",
      "Spring 2026",
    ]);
  });

  it("falls back to cross-term when term contains control characters", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    const result = await queryCourseMetrics("EN.601.226", "Spring\u0007 2026");

    expect(result.scope).toBe("cross-term");
    expect(result.term).toBe("All terms");
    expect(result.requestedTerm).toBe("All terms");
    expect(result.meta.termFilterApplied).toBeNull();
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ["EN.601.226"]);
  });

  it("treats unrecognized term phrases as cross-term scope", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    const result = await queryCourseMetrics(
      "EN.601.226",
      "Spring 2026'; DROP TABLE course_evaluations; --",
    );

    const [queryText, queryValues] = mockQuery.mock.calls[0] as [string, string[]];
    expect(queryText).not.toContain("semester = $2");
    expect(queryText).not.toContain("DROP TABLE");
    expect(queryValues).toEqual(["EN.601.226"]);
    expect(result.scope).toBe("cross-term");
    expect(result.term).toBe("All terms");
  });

  it("falls back to historical offerings when exact-term rows are missing", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({
        rows: [sampleRow("Fall 2025", "2.0", 12)],
      } as never);

    await expect(queryCourseMetrics("EN.601.226", "Spring 2026")).resolves.toEqual({
      courseCode: "EN.601.226",
      requestedTerm: "Spring 2026",
      evaluationsTermRange: "Fall 2025",
      term: "Spring 2026",
      scope: "term-specific",
      meta: {
        semestersIncluded: ["Fall 2025"],
        evaluationRowCount: 1,
        termFilterApplied: "Spring 2026",
      },
      metrics: {
        workload: 2,
        difficulty: 3,
        overallQuality: 4,
        respondentCount: 12,
      },
      metricsSource: "historical_offerings",
    });
  });

  it("normalizes the requested term before querying and returning results", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [sampleRow("Spring 2026", "2.0", 10)],
    } as never);

    const result = await queryCourseMetrics("EN.601.226", "  spring   2026 ");

    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [
      "EN.601.226",
      "Spring 2026",
    ]);
    expect(result.requestedTerm).toBe("Spring 2026");
    expect(result.term).toBe("Spring 2026");
    expect(result.scope).toBe("term-specific");
    expect(result.metricsSource).toBe("exact_term");
    expect(result.evaluationsTermRange).toBe("Spring 2026");
    expect(result.meta).toEqual({
      semestersIncluded: ["Spring 2026"],
      evaluationRowCount: 1,
      termFilterApplied: "Spring 2026",
    });
  });

  it("resolves bare course codes before querying metrics", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ course_code: "AS.601.226" }],
      } as never)
      .mockResolvedValueOnce({
        rows: [sampleRow("Spring 2026", "2.0", 10)],
      } as never);

    const result = await queryCourseMetrics("601.226", "Spring 2026");

    expect(result.courseCode).toBe("AS.601.226");
    expect(result.scope).toBe("term-specific");
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
      requestedTerm: "Spring 2026",
      evaluationsTermRange: "Spring 2026",
      term: "Spring 2026",
      scope: "term-specific",
      meta: {
        semestersIncluded: ["Spring 2026"],
        evaluationRowCount: 2,
        termFilterApplied: "Spring 2026",
      },
      metrics: {
        workload: 2.75,
        difficulty: 3.75,
        overallQuality: 4.75,
        respondentCount: 40,
      },
      metricsSource: "exact_term",
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
      requestedTerm: "Spring 2026",
      evaluationsTermRange: "Spring 2026",
      term: "Spring 2026",
      scope: "term-specific",
      meta: {
        semestersIncluded: ["Spring 2026"],
        evaluationRowCount: 3,
        termFilterApplied: "Spring 2026",
      },
      metrics: {
        workload: 3,
        difficulty: 4,
        overallQuality: 4.33,
        respondentCount: 30,
      },
      metricsSource: "exact_term",
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

  it("returns null metrics even when respondents exist but all tracked metric fields sanitize away", () => {
    expect(
      aggregateCourseMetrics([
        {
          semester: "Spring 2026",
          instructor: "Prof A",
          overall_quality: "invalid",
          teaching_effectiveness: "4.0",
          intellectual_challange: "9.0",
          work_load: "-2.0",
          feedback_quality: "4.0",
          num_respondents: 12,
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
    expect(buildQueryCourseMetricsNoDataMessage("EN.601.226")).toBe(
      "No course evaluation metrics were found for EN.601.226 across all terms.",
    );
    expect(buildQueryCourseMetricsNoDataMessage("EN.601.226", "")).toBe(
      "No course evaluation metrics were found for EN.601.226 across all terms.",
    );
  });

  it("formats term range from rows", () => {
    expect(
      formatEvaluationsTermRange([
        {
          semester: "Spring 2025",
          instructor: null,
          overall_quality: null,
          teaching_effectiveness: null,
          intellectual_challange: null,
          work_load: null,
          feedback_quality: null,
          num_respondents: null,
        },
        {
          semester: "Fall 2024",
          instructor: null,
          overall_quality: null,
          teaching_effectiveness: null,
          intellectual_challange: null,
          work_load: null,
          feedback_quality: null,
          num_respondents: null,
        },
      ]),
    ).toBe("Fall 2024 – Spring 2025");
  });

  it("computes the max allowed explicit term from calendar date", () => {
    expect(maxAllowedExplicitCourseMetricsTerm(new Date("2026-04-25T12:00:00Z"))).toBe("Fall 2025");
    expect(maxAllowedExplicitCourseMetricsTerm(new Date("2026-10-10T12:00:00Z"))).toBe("Spring 2026");
  });

  it("clamps current/future explicit terms to the latest allowed prior term", () => {
    const now = new Date("2026-04-25T12:00:00Z");
    expect(clampCourseMetricsTermToAllowedWindow("Spring 2026", now)).toBe("Fall 2025");
    expect(clampCourseMetricsTermToAllowedWindow("Fall 2026", now)).toBe("Fall 2025");
    expect(clampCourseMetricsTermToAllowedWindow("Fall 2025", now)).toBe("Fall 2025");
    expect(clampCourseMetricsTermToAllowedWindow(undefined, now)).toBeUndefined();
  });
});
