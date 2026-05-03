import { describe, expect, it } from "vitest";
import {
  isWorkloadOrMetricsQuestionAboutThisSchedule,
  userExplicitlyRequestedGraduateScope,
} from "./agent-user-intent";

describe("userExplicitlyRequestedGraduateScope", () => {
  it("returns false for undergrad elective planning that mentions grad school", () => {
    expect(
      userExplicitlyRequestedGraduateScope(
        "what are the most useful upper level electives for chemistry if i want to pursue grad school in the future?",
      ),
    ).toBe(false);
  });

  it("returns false when graduate program is a goal but the ask is clearly undergraduate", () => {
    expect(
      userExplicitlyRequestedGraduateScope(
        "which upper level bio electives help if I'm targeting a graduate program later?",
      ),
    ).toBe(false);
  });

  it("returns true for explicit graduate-level course search", () => {
    expect(userExplicitlyRequestedGraduateScope("show me graduate computer science courses")).toBe(true);
  });

  it("returns true for graduate school catalog phrasing", () => {
    expect(userExplicitlyRequestedGraduateScope("list graduate school courses in public health")).toBe(true);
  });

  it("returns true for PhD course search", () => {
    expect(userExplicitlyRequestedGraduateScope("phd level seminars in neuroscience")).toBe(true);
  });
});

describe("isWorkloadOrMetricsQuestionAboutThisSchedule", () => {
  it("returns true for workload framed around this/their schedule", () => {
    expect(
      isWorkloadOrMetricsQuestionAboutThisSchedule(
        "How heavy will my workload be with this schedule? Is it doable?",
      ),
    ).toBe(true);
  });

  it("returns true when comparing a course workload against the rest on my schedule", () => {
    expect(
      isWorkloadOrMetricsQuestionAboutThisSchedule(
        "How does EN.601.226 workload compare to the rest on my schedule?",
      ),
    ).toBe(true);
  });

  it("returns false for a bare metrics question with no schedule tie", () => {
    expect(isWorkloadOrMetricsQuestionAboutThisSchedule("how hard is EN.553.291")).toBe(false);
  });

  it("returns false for schedule wording without workload/difficulty angle", () => {
    expect(isWorkloadOrMetricsQuestionAboutThisSchedule("add linear algebra to my schedule")).toBe(false);
  });
});
