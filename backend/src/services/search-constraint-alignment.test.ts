import { describe, expect, it } from "vitest";
import { applyDeterministicConstraintAlignment } from "./search-constraint-alignment";

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    courseId: "en-601-226-spring-2026",
    code: "EN.601.226",
    title: "Data Structures",
    description: "",
    sisOfferingName: "EN.601.226",
    term: "Spring 2026",
    daysOfWeek: "Mon/Wed",
    timeOfDay: "morning",
    schoolName: "Whiting School of Engineering",
    level: "Upper Level Undergraduate",
    instructors: ["Ali Madooei"],
    ...overrides,
  };
}

function runAlignment(
  row: Record<string, unknown>,
  message: string,
  toolInput: Record<string, unknown>,
) {
  return applyDeterministicConstraintAlignment(
    [row],
    message,
    [{ toolCalls: [{ toolName: "searchCourses", input: toolInput }] }],
  )[0] as Record<string, unknown>;
}

describe("applyDeterministicConstraintAlignment", () => {
  it("sets mismatch reason days when SIS day filter conflicts", () => {
    const result = runAlignment(makeRow(), "find Tuesday classes", { DaysOfWeek: "any|2" });
    expect(result.constraintAlignment).toBe("mismatch");
    expect(result.constraintMismatchReasons).toEqual(["days"]);
  });

  it("requires all requested days when SIS DaysOfWeek uses all| mask", () => {
    const result = runAlignment(
      makeRow({ daysOfWeek: "Wed" }),
      "find classes on Wednesday and Thursday",
      { DaysOfWeek: "all|12" },
    );
    expect(result.constraintAlignment).toBe("mismatch");
    expect(result.constraintMismatchReasons).toEqual(["days"]);
  });

  it("requires exact day set for phrases like 'no other days'", () => {
    const result = runAlignment(
      makeRow({ daysOfWeek: "Wed/Fri" }),
      "science classes that meet on both Wednesdays and Thursdays and no other days",
      {},
    );
    expect(result.constraintAlignment).toBe("mismatch");
    expect(result.constraintMismatchReasons).toEqual(["days"]);
  });

  it("sets mismatch reason time_window when TimeOfDay conflicts", () => {
    const result = runAlignment(makeRow(), "find evening classes", { TimeOfDay: "evening" });
    expect(result.constraintAlignment).toBe("mismatch");
    expect(result.constraintMismatchReasons).toEqual(["time_window"]);
  });

  it("sets mismatch reason school when School filter conflicts", () => {
    const result = runAlignment(
      makeRow({ schoolName: "Krieger School of Arts and Sciences" }),
      "find WSE classes",
      { School: "Whiting School of Engineering" },
    );
    expect(result.constraintAlignment).toBe("mismatch");
    expect(result.constraintMismatchReasons).toEqual(["school"]);
  });

  it("sets mismatch reason level when Level filter conflicts", () => {
    const result = runAlignment(
      makeRow({ level: "Upper Level Undergraduate" }),
      "find lower level classes",
      { Level: "Lower Level Undergraduate" },
    );
    expect(result.constraintAlignment).toBe("mismatch");
    expect(result.constraintMismatchReasons).toEqual(["level"]);
  });

  it("sets mismatch reason course_number when CourseNumber filter conflicts", () => {
    const result = runAlignment(makeRow(), "find EN.553.171", {
      CourseNumber: "EN.553.171",
    });
    expect(result.constraintAlignment).toBe("mismatch");
    expect(result.constraintMismatchReasons).toEqual(["course_number"]);
  });

  it("does not apply inferred CourseNumber mismatch when user did not specify a course", () => {
    const result = runAlignment(
      makeRow({ daysOfWeek: "Wed/Thu" }),
      "find science classes on wednesday and thursday",
      { DaysOfWeek: "all|12", CourseNumber: "EN.553.171" },
    );
    expect(result.constraintAlignment).toBe("aligned");
    expect(result.constraintMismatchReasons).toBeUndefined();
  });

  it("flags day mismatch for compact day strings like T/F", () => {
    const result = runAlignment(
      makeRow({ daysOfWeek: "T/F" }),
      "find science classes on wednesday and thursday",
      { DaysOfWeek: "all|12" },
    );
    expect(result.constraintAlignment).toBe("mismatch");
    expect(result.constraintMismatchReasons).toEqual(["days"]);
  });

  it("sets mismatch reason instructor when Instructor filter conflicts", () => {
    const result = runAlignment(makeRow(), "find classes taught by Hopper", {
      Instructor: "Hopper",
    });
    expect(result.constraintAlignment).toBe("mismatch");
    expect(result.constraintMismatchReasons).toEqual(["instructor"]);
  });

  it("sets mismatch reason department when Department filter conflicts", () => {
    const result = runAlignment(
      makeRow({ department: "EN Computer Science" }),
      "find applied math courses",
      { Department: "EN Applied Mathematics and Statistics" },
    );
    expect(result.constraintAlignment).toBe("mismatch");
    expect(result.constraintMismatchReasons).toEqual(["department"]);
  });

  it("sets mismatch reason credits when Credits filter conflicts", () => {
    const result = runAlignment(makeRow({ credits: 3 }), "find 4 credit classes", {
      Credits: "4.00",
    });
    expect(result.constraintAlignment).toBe("mismatch");
    expect(result.constraintMismatchReasons).toEqual(["credits"]);
  });

  it("sets mismatch reason writing_intensive when WritingIntensive filter conflicts", () => {
    const result = runAlignment(
      makeRow({ writingIntensive: "No" }),
      "find writing intensive classes",
      { WritingIntensive: "Yes" },
    );
    expect(result.constraintAlignment).toBe("mismatch");
    expect(result.constraintMismatchReasons).toEqual(["writing_intensive"]);
  });

  it("sets unknown for credits when row credits are missing", () => {
    const result = runAlignment(makeRow({ credits: undefined }), "find 3 credit classes", {
      Credits: "3.00",
    });
    expect(result.constraintAlignment).toBe("unknown");
    expect(result.constraintMismatchReasons).toBeUndefined();
  });

  it("sets unknown for writing intensive when row field is missing", () => {
    const result = runAlignment(
      makeRow({ writingIntensive: undefined, isWritingIntensive: undefined }),
      "find writing intensive classes",
      { WritingIntensive: "Yes" },
    );
    expect(result.constraintAlignment).toBe("unknown");
    expect(result.constraintMismatchReasons).toBeUndefined();
  });

  it("sets unknown when required row fields are missing", () => {
    const sparseRow = makeRow({
      schoolName: undefined,
      daysOfWeek: undefined,
      timeOfDay: undefined,
      level: undefined,
      instructors: undefined,
    });
    const result = runAlignment(sparseRow, "find WSE classes", {
      School: "Whiting School of Engineering",
    });
    expect(result.constraintAlignment).toBe("unknown");
    expect(result.constraintMismatchReasons).toBeUndefined();
  });
});
