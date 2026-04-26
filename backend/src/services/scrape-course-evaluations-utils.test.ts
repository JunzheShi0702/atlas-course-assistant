import { describe, expect, it } from "vitest";
import {
  emptyMetrics,
  getMetricCount,
  normalizeForMatch,
  parseFirstNonEmptyLine,
  parseNumRespondents,
  toCatalogCourseCode,
  toSectionNumber,
} from "./scrape-course-evaluations-utils";

describe("scrape-course-evaluations utils", () => {
  it("extracts the catalog course code from a full offering code", () => {
    expect(toCatalogCourseCode("EN.550.310.11.SU15")).toBe("EN.550.310");
    expect(toCatalogCourseCode(" AS.110.205.FA24 ")).toBe("AS.110.205");
  });

  it("returns the original trimmed text when a catalog code pattern is not found", () => {
    expect(toCatalogCourseCode("invalid code")).toBe("invalid code");
  });

  it("extracts a section number only when a clear section segment exists", () => {
    expect(toSectionNumber("EN.550.310.11.SU15")).toBe("11");
    expect(toSectionNumber("EN.550.310.FA15")).toBeNull();
  });

  it("parses the respondent count from EvaluationKit summary text", () => {
    expect(parseNumRespondents("18 of 19 responded (94.74%)")).toBe(18);
    expect(parseNumRespondents("No response data")).toBeNull();
  });

  it("returns the first non-empty trimmed line", () => {
    expect(parseFirstNonEmptyLine("\n  Spring 2025 \nInstructor Name")).toBe("Spring 2025");
    expect(parseFirstNonEmptyLine("   \n \n")).toBeNull();
    expect(parseFirstNonEmptyLine(null)).toBeNull();
  });

  it("normalizes whitespace and casing for comparisons", () => {
    expect(normalizeForMatch("  Data   Structures  ")).toBe("data structures");
  });

  it("builds an empty metrics object and counts only populated metrics", () => {
    expect(emptyMetrics()).toEqual({
      overall_quality: null,
      teaching_effectiveness: null,
      intellectual_challange: null,
      ta_quality: null,
      feedback_quality: null,
      work_load: null,
    });

    expect(
      getMetricCount({
        overall_quality: 4.2,
        teaching_effectiveness: null,
        intellectual_challange: 3.8,
        ta_quality: null,
        feedback_quality: null,
        work_load: 3.1,
      }),
    ).toBe(3);
  });
});
