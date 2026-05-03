import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockCreate } = vi.hoisted(() => {
  const mockCreate = vi.fn().mockResolvedValue({
    choices: [{ message: { content: "A great course with moderate difficulty." } }],
  });
  return { mockCreate };
});

// Mock the database functions
const { mockGetCachedCourseSummary, mockCacheCourseSummary, mockQuery } = vi.hoisted(() => {
  const mockGetCachedCourseSummary = vi.fn().mockResolvedValue(null);
  const mockCacheCourseSummary = vi.fn().mockResolvedValue(undefined);
  const mockQuery = vi.fn();
  return { mockGetCachedCourseSummary, mockCacheCourseSummary, mockQuery };
});

vi.mock("../db", () => ({
  pool: { query: mockQuery },
  getCachedCourseSummary: mockGetCachedCourseSummary,
  cacheCourseSummary: mockCacheCourseSummary,
}));
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(function () {
    return { chat: { completions: { create: mockCreate } } };
  }),
}));

import {
  getCourseEvalSummary,
  resolveEvalCourseCode,
  semesterSortKey,
  weightedAvg,
  EvalRow,
} from "./get-course-eval-summary";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeRow = (overrides: Partial<EvalRow> = {}): EvalRow => ({
  semester: "Fall 2023",
  instructor: "Dr. Smith",
  overall_quality: "4.5",
  teaching_effectiveness: "4.2",
  intellectual_challange: "3.1",
  work_load: "3.8",
  feedback_quality: "4.0",
  num_respondents: 20,
  ...overrides,
});

// ---------------------------------------------------------------------------
// semesterSortKey
// ---------------------------------------------------------------------------

describe("semesterSortKey", () => {
  it("orders seasons correctly within the same year", () => {
    const semesters = ["Fall 2023", "Summer 2 2023", "Intersession 2023", "Spring 2023", "Summer 2023"];
    const sorted = [...semesters].sort((a, b) =>
      semesterSortKey(a).localeCompare(semesterSortKey(b)),
    );
    expect(sorted).toEqual([
      "Spring 2023",
      "Summer 2023",
      "Summer 2 2023",
      "Fall 2023",
      "Intersession 2023",
    ]);
  });

  it("orders across years", () => {
    const sorted = ["Fall 2024", "Spring 2022", "Fall 2023"].sort((a, b) =>
      semesterSortKey(a).localeCompare(semesterSortKey(b)),
    );
    expect(sorted).toEqual(["Spring 2022", "Fall 2023", "Fall 2024"]);
  });

  it("distinguishes Summer and Summer 2", () => {
    expect(semesterSortKey("Summer 2023") < semesterSortKey("Summer 2 2023")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// weightedAvg
// ---------------------------------------------------------------------------

describe("weightedAvg", () => {
  it("computes a weighted average when all rows have respondent counts", () => {
    const rows: EvalRow[] = [
      makeRow({ overall_quality: "4.0", num_respondents: 10 }),
      makeRow({ overall_quality: "5.0", num_respondents: 10 }),
    ];
    expect(weightedAvg(rows, "overall_quality")).toBe(4.5);
  });

  it("weights larger sections more heavily", () => {
    const rows: EvalRow[] = [
      makeRow({ overall_quality: "2.0", num_respondents: 10 }),
      makeRow({ overall_quality: "4.0", num_respondents: 90 }),
    ];
    // (2*10 + 4*90) / 100 = 3.8
    expect(weightedAvg(rows, "overall_quality")).toBe(3.8);
  });

  it("falls back to unweighted mean when num_respondents is null", () => {
    const rows: EvalRow[] = [
      makeRow({ overall_quality: "3.0", num_respondents: null }),
      makeRow({ overall_quality: "5.0", num_respondents: null }),
    ];
    expect(weightedAvg(rows, "overall_quality")).toBe(4.0);
  });

  it("falls back to unweighted mean when any row is missing a respondent count", () => {
    const rows: EvalRow[] = [
      makeRow({ overall_quality: "3.0", num_respondents: 20 }),
      makeRow({ overall_quality: "5.0", num_respondents: null }),
    ];
    expect(weightedAvg(rows, "overall_quality")).toBe(4.0);
  });

  it("skips rows where the metric value is null", () => {
    const rows: EvalRow[] = [
      makeRow({ overall_quality: null, num_respondents: 10 }),
      makeRow({ overall_quality: "4.0", num_respondents: 10 }),
    ];
    expect(weightedAvg(rows, "overall_quality")).toBe(4.0);
  });

  it("returns 0 when all metric values are null", () => {
    const rows: EvalRow[] = [makeRow({ overall_quality: null })];
    expect(weightedAvg(rows, "overall_quality")).toBe(0);
  });

  it("returns 0 when total weight is zero", () => {
    const rows: EvalRow[] = [
      makeRow({ overall_quality: "4.0", num_respondents: 0 }),
    ];
    expect(weightedAvg(rows, "overall_quality")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getCourseEvalSummary
// ---------------------------------------------------------------------------

describe("getCourseEvalSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns hasData: false when no rows found", async () => {
    // Mock course evaluations query with no data
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    const result = await getCourseEvalSummary("AS.000.000");

    expect(result.hasData).toBe(false);
    if (!result.hasData) {
      expect(result.message).toBeTruthy();
      expect(result.sourceData).toEqual([]);
      expect(result.sourceDataMeta).toEqual({
        totalDataPoints: 0,
        returnedDataPoints: 0,
        truncated: false,
      });
    }
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCacheCourseSummary).toHaveBeenCalledWith("AS.000.000", "Unknown", result);
  });

  it("resolves courseId slugs to dotted course codes before querying eval rows", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] } as never);

    await getCourseEvalSummary("en-601-220-spring-2026");

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0]?.[1]).toEqual(["EN.601.220"]);
  });

  it("returns hasData: true with correct shape when rows exist", async () => {
    // Mock course evaluations query with data
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] } as never);

    const result = await getCourseEvalSummary("EN.601.226");

    expect(result.hasData).toBe(true);
    if (result.hasData) {
      expect(typeof result.summaryText).toBe("string");
      expect(result.summaryText.length).toBeGreaterThan(0);
      expect(result.metrics).toMatchObject({
        overallQuality: expect.any(Number),
        teachingEffectiveness: expect.any(Number),
        difficulty: expect.any(Number),
        workload: expect.any(Number),
        feedbackQuality: expect.any(Number),
      });
      expect(result.attribution.instructorNames).toContain("Dr. Smith");
      expect(result.attribution.termRange.startTerm).toBe("Fall 2023");
      expect(result.attribution.termRange.endTerm).toBe("Fall 2023");
      expect(result.attribution.sampleSize).toBe(20);
      expect(result.sourceData.length).toBeGreaterThan(0);
      expect(result.sourceData[0]).toMatchObject({
        metricName: expect.any(String),
        metricLabel: expect.any(String),
        metricValue: expect.any(Number),
      });
      expect(result.sourceDataMeta.totalDataPoints).toBe(result.sourceData.length);
      expect(result.sourceDataMeta.returnedDataPoints).toBe(result.sourceData.length);
      expect(result.sourceDataMeta.truncated).toBe(false);
    }
  });

  it("includes term and instructor context in sourceData entries", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeRow({ semester: "Spring 2025", instructor: "Dr. Ada", overall_quality: "4.6" }),
      ],
    } as never);

    const result = await getCourseEvalSummary("EN.601.240");

    expect(result.hasData).toBe(true);
    if (result.hasData) {
      const overall = result.sourceData.find((d) => d.metricName === "overall_quality");
      expect(overall).toMatchObject({
        term: "Spring 2025",
        instructor: "Dr. Ada",
        metricLabel: "Overall Quality",
        metricValue: 4.6,
      });
    }
  });

  it("caps sourceData size and marks truncation in sourceDataMeta", async () => {
    const manyRows = Array.from({ length: 120 }, (_, i) =>
      makeRow({
        semester: `Fall ${2025 - (i % 3)}`,
        instructor: `Dr. ${i}`,
        overall_quality: "4.0",
        teaching_effectiveness: "4.1",
        intellectual_challange: "3.9",
        work_load: "3.8",
        feedback_quality: "4.2",
        num_respondents: 10,
      }));

    mockQuery.mockResolvedValueOnce({ rows: manyRows } as never);

    const result = await getCourseEvalSummary("EN.601.241");

    expect(result.hasData).toBe(true);
    if (result.hasData) {
      expect(result.sourceDataMeta.totalDataPoints).toBe(600); // 120 rows * 5 metrics
      expect(result.sourceDataMeta.returnedDataPoints).toBe(500);
      expect(result.sourceDataMeta.truncated).toBe(true);
      expect(result.sourceData).toHaveLength(500);
    }
  });

  it("sets termRange correctly across multiple semesters", async () => {
    // Mock course evaluations query with multiple semesters
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeRow({ semester: "Fall 2022" }),
        makeRow({ semester: "Spring 2024" }),
        makeRow({ semester: "Summer 2023" }),
      ],
    } as never);

    const result = await getCourseEvalSummary("EN.601.227");

    expect(result.hasData).toBe(true);
    if (result.hasData) {
      expect(result.attribution.termRange.startTerm).toBe("Fall 2022");
      expect(result.attribution.termRange.endTerm).toBe("Spring 2024");
    }
  });

  it("deduplicates instructors across sections", async () => {
    // Mock course evaluations query with duplicate instructors
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeRow({ instructor: "Dr. Smith" }),
        makeRow({ instructor: "Dr. Smith" }),
        makeRow({ instructor: "Dr. Lee" }),
      ],
    } as never);

    const result = await getCourseEvalSummary("EN.601.228");

    expect(result.hasData).toBe(true);
    if (result.hasData) {
      expect(result.attribution.instructorNames).toEqual(["Dr. Smith", "Dr. Lee"]);
    }
  });

  it("uses total num_respondents as sampleSize", async () => {
    // Mock course evaluations query with multiple respondent counts
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeRow({ num_respondents: 15 }),
        makeRow({ num_respondents: 25 }),
      ],
    } as never);

    const result = await getCourseEvalSummary("EN.601.229");

    expect(result.hasData).toBe(true);
    if (result.hasData) {
      expect(result.attribution.sampleSize).toBe(40);
    }
  });

  it("falls back to row count when all num_respondents are null", async () => {
    // Mock course evaluations query with null respondent counts
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeRow({ num_respondents: null }),
        makeRow({ num_respondents: null }),
      ],
    } as never);

    const result = await getCourseEvalSummary("EN.601.230");

    expect(result.hasData).toBe(true);
    if (result.hasData) {
      expect(result.attribution.sampleSize).toBe(2);
    }
  });

  it("resolves bare ###.### to a catalog course_code before loading eval rows", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ course_code: "AS.110.304" }],
      } as never)
      .mockResolvedValueOnce({ rows: [makeRow()] } as never);

    const result = await getCourseEvalSummary("110.304");

    expect(result.hasData).toBe(true);
    expect(mockCacheCourseSummary).toHaveBeenCalledWith("AS.110.304", "Fall 2023", expect.anything());
  });

  it("returns cached result when cache hit, skips evaluation queries", async () => {
    const cachedResult = {
      hasData: true as const,
      summaryText: "Cached summary",
      metrics: {
        overallQuality: 4.5,
        teachingEffectiveness: 4.2,
        difficulty: 3.1,
        workload: 3.8,
        feedbackQuality: 4.0,
      },
      attribution: {
        instructorNames: ["Dr. Cached"],
        termRange: { startTerm: "Fall 2023", endTerm: "Fall 2023" },
        sampleSize: 20,
      },
    };

    // Mock cache hit - return cached data  
    mockGetCachedCourseSummary.mockResolvedValueOnce(cachedResult);

    const result = await getCourseEvalSummary("EN.601.231");

    expect(result).toEqual(cachedResult);
    expect(mockGetCachedCourseSummary).toHaveBeenCalledWith("EN.601.231");
    expect(mockQuery).toHaveBeenCalledTimes(0); // No queries at all when cache hit
  });

  it("caches result after successful generation", async () => {
    // Mock course evaluations query
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] } as never);

    const result = await getCourseEvalSummary("EN.601.232");

    expect(mockCacheCourseSummary).toHaveBeenCalledWith("EN.601.232", "Fall 2023", result);
  });
});

describe("resolveEvalCourseCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes courseId slug format to dotted course code", async () => {
    await expect(resolveEvalCourseCode("en-601-220-spring-2026")).resolves.toBe(
      "EN.601.220",
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("normalizes section-scoped courseId slug format to dotted course code", async () => {
    await expect(resolveEvalCourseCode("en-601-220-01-spring-2026")).resolves.toBe(
      "EN.601.220",
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
