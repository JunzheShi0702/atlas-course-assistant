import { describe, expect, it } from "vitest";
import { courseIdFromOfferingAndTerm, resolveCourseId } from "./courseId";

describe("courseId helpers", () => {
  it("builds stable ids from SIS offering and term", () => {
    expect(courseIdFromOfferingAndTerm("EN.601.226.01", "Spring 2026")).toBe(
      "en-601-226-01-spring-2026",
    );
  });

  it("returns null when offering or term is missing", () => {
    expect(courseIdFromOfferingAndTerm("EN.601.226", " ")).toBeNull();
    expect(courseIdFromOfferingAndTerm(null, "Spring 2026")).toBeNull();
  });

  it("prefers direct courseId before deriving a fallback", () => {
    expect(
      resolveCourseId({
        courseId: "direct-id",
        sisOfferingName: "EN.601.226",
        term: "Spring 2026",
      }),
    ).toBe("direct-id");
  });
});
