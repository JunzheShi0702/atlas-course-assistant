import { describe, it, expect } from "vitest";
import {
  generateDaysOfWeek,
  parseDaysOfWeek,
  courseSearchParamsSchema,
  generateDaysOfWeekParamsSchema,
  DAYS_OF_WEEK_CODE,
  CODE_TO_DAY,
  isUndergraduateCourse,
  parseCourseNumber,
} from "./sis";

describe("generateDaysOfWeek", () => {
  it("encodes a single day with 'all' match type", () => {
    expect(generateDaysOfWeek({ days: ["Monday"], matchType: "all" })).toBe(
      "all|1",
    );
  });

  it("encodes a single day with 'any' match type", () => {
    expect(generateDaysOfWeek({ days: ["Friday"], matchType: "any" })).toBe(
      "any|16",
    );
  });

  it("encodes Mon/Wed/Fri as sum 21", () => {
    expect(
      generateDaysOfWeek({
        days: ["Monday", "Wednesday", "Friday"],
        matchType: "all",
      }),
    ).toBe("all|21");
  });

  it("encodes Tue/Thu as sum 10", () => {
    expect(
      generateDaysOfWeek({
        days: ["Tuesday", "Thursday"],
        matchType: "any",
      }),
    ).toBe("any|10");
  });

  it("encodes all seven days as sum 127", () => {
    expect(
      generateDaysOfWeek({
        days: [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday",
        ],
        matchType: "all",
      }),
    ).toBe("all|127");
  });

  it("encodes empty days array as sum 0", () => {
    expect(generateDaysOfWeek({ days: [], matchType: "all" })).toBe("all|0");
  });
});

describe("parseDaysOfWeek", () => {
  it("parses single day code 1 to Mon", () => {
    expect(parseDaysOfWeek("1")).toBe("Mon");
  });

  it("parses code 21 to Mon/Wed/Fri", () => {
    expect(parseDaysOfWeek("21")).toBe("Mon/Wed/Fri");
  });

  it("parses code 10 to Tue/Thu", () => {
    expect(parseDaysOfWeek("10")).toBe("Tue/Thu");
  });

  it("parses code 127 to all days", () => {
    expect(parseDaysOfWeek("127")).toBe("Mon/Tue/Wed/Thu/Fri/Sat/Sun");
  });

  it("returns N/A for code 0", () => {
    expect(parseDaysOfWeek("0")).toBe("N/A");
  });

  it("returns the original string for non-numeric input", () => {
    expect(parseDaysOfWeek("TBD")).toBe("TBD");
  });

  it("returns the original string for empty string", () => {
    expect(parseDaysOfWeek("")).toBe("");
  });
});

describe("DAYS_OF_WEEK_CODE", () => {
  it("has correct power-of-2 values for each day", () => {
    expect(DAYS_OF_WEEK_CODE["Monday"]).toBe(1);
    expect(DAYS_OF_WEEK_CODE["Tuesday"]).toBe(2);
    expect(DAYS_OF_WEEK_CODE["Wednesday"]).toBe(4);
    expect(DAYS_OF_WEEK_CODE["Thursday"]).toBe(8);
    expect(DAYS_OF_WEEK_CODE["Friday"]).toBe(16);
    expect(DAYS_OF_WEEK_CODE["Saturday"]).toBe(32);
    expect(DAYS_OF_WEEK_CODE["Sunday"]).toBe(64);
  });
});

describe("CODE_TO_DAY", () => {
  it("maps each power-of-2 code to its short day name", () => {
    expect(CODE_TO_DAY[1]).toBe("Mon");
    expect(CODE_TO_DAY[2]).toBe("Tue");
    expect(CODE_TO_DAY[4]).toBe("Wed");
    expect(CODE_TO_DAY[8]).toBe("Thu");
    expect(CODE_TO_DAY[16]).toBe("Fri");
    expect(CODE_TO_DAY[32]).toBe("Sat");
    expect(CODE_TO_DAY[64]).toBe("Sun");
  });
});

describe("courseSearchParamsSchema", () => {
  it("accepts valid params", () => {
    const result = courseSearchParamsSchema.safeParse({
      Term: "Fall 2025",
      School: "Whiting School of Engineering",
      Department: "Computer Science",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty object (all fields optional)", () => {
    const result = courseSearchParamsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects invalid School name", () => {
    const result = courseSearchParamsSchema.safeParse({
      School: "Fake School",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid WritingIntensive value", () => {
    const result = courseSearchParamsSchema.safeParse({
      WritingIntensive: "Maybe",
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid WritingIntensive values", () => {
    expect(
      courseSearchParamsSchema.safeParse({ WritingIntensive: "Yes" }).success,
    ).toBe(true);
    expect(
      courseSearchParamsSchema.safeParse({ WritingIntensive: "No" }).success,
    ).toBe(true);
  });
});

describe("parseCourseNumber", () => {
  it("extracts the third segment as a number", () => {
    expect(parseCourseNumber("EN.553.171")).toBe(171);
    expect(parseCourseNumber("AS.110.302")).toBe(302);
    expect(parseCourseNumber("EN.601.226")).toBe(226);
  });

  it("returns NaN for a code with fewer than 3 segments", () => {
    expect(parseCourseNumber("EN.553")).toBeNaN();
    expect(parseCourseNumber("EN")).toBeNaN();
    expect(parseCourseNumber("")).toBeNaN();
  });

  it("returns NaN when the third segment is not numeric", () => {
    expect(parseCourseNumber("AS.XXX.abc")).toBeNaN();
  });
});

describe("isUndergraduateCourse", () => {
  it("returns true for a 100-level course", () => {
    expect(isUndergraduateCourse({ OfferingName: "AS.110.108" })).toBe(true);
  });

  it("returns true for a 200-level course", () => {
    expect(isUndergraduateCourse({ OfferingName: "EN.553.211" })).toBe(true);
  });

  it("returns true for a 300-level course", () => {
    expect(isUndergraduateCourse({ OfferingName: "AS.110.302" })).toBe(true);
  });

  it("returns true for a 400-level course", () => {
    expect(isUndergraduateCourse({ OfferingName: "EN.601.421" })).toBe(true);
  });

  it("returns false for a 500-level course (graduate)", () => {
    expect(isUndergraduateCourse({ OfferingName: "EN.601.500" })).toBe(false);
  });

  it("returns false for a 600-level course", () => {
    expect(isUndergraduateCourse({ OfferingName: "EN.553.600" })).toBe(false);
  });

  it("returns false for a 700-level course", () => {
    expect(isUndergraduateCourse({ OfferingName: "AS.110.740" })).toBe(false);
  });

  it("returns false for an 800-level course", () => {
    expect(isUndergraduateCourse({ OfferingName: "EN.601.810" })).toBe(false);
  });

  it("returns false when offering name cannot be parsed", () => {
    expect(isUndergraduateCourse({ OfferingName: "INVALID" })).toBe(false);
    expect(isUndergraduateCourse({ OfferingName: "" })).toBe(false);
  });
});

describe("generateDaysOfWeekParamsSchema", () => {
  it("accepts valid input", () => {
    const result = generateDaysOfWeekParamsSchema.safeParse({
      days: ["Monday", "Wednesday"],
      matchType: "all",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid day name", () => {
    const result = generateDaysOfWeekParamsSchema.safeParse({
      days: ["Funday"],
      matchType: "all",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid matchType", () => {
    const result = generateDaysOfWeekParamsSchema.safeParse({
      days: ["Monday"],
      matchType: "exactly",
    });
    expect(result.success).toBe(false);
  });
});
