import { describe, expect, it } from "vitest";
import { userExplicitlyRequestedGraduateScope } from "./agent-user-intent";

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
