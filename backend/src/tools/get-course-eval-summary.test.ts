import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockCreate } = vi.hoisted(() => {
  const mockCreate = vi.fn().mockResolvedValue({
    choices: [{ message: { content: "A great course with moderate difficulty." } }],
  });
  return { mockCreate };
});

vi.mock("../db");
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(function () {
    return { chat: { completions: { create: mockCreate } } };
  }),
}));

import {
  getCourseEvalSummary,
  semesterSortKey,
  weightedAvg,
  EvalRow,
} from "./get-course-eval-summary";
import { pool } from "../db";
const mockQuery = vi.mocked(pool.query);

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
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    const result = await getCourseEvalSummary("AS.000.000");

    expect(result.hasData).toBe(false);
    if (!result.hasData) {
      expect(result.message).toBeTruthy();
    }
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns hasData: true with correct shape when rows exist", async () => {
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
    }
  });

  it("sets termRange correctly across multiple semesters", async () => {
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

  it("returns cached result on second call without hitting the DB", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] } as never);

    await getCourseEvalSummary("EN.601.231");
    await getCourseEvalSummary("EN.601.231");

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
