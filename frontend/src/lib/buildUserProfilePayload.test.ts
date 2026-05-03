import { describe, expect, it } from "vitest";
import { testProgramListResponse } from "@/test/fixtures/programListResponse";
import { buildUserProfilePayloadFromSurvey } from "./buildUserProfilePayload";

const baseSurvey = {
  degreeAndGraduation: {
    graduationMonth: "May",
    graduationYear: "2026",
    programs: [{ name: "Computer Science", kind: "major" as const }],
  },
  careerGoal: {
    selected: ["Software Engineering"],
    custom: "",
    stillExploring: false,
  },
  workloadTolerance: { workload: 0.5, focusBreadth: 0.5 },
  classTimePreference: {
    selectedTimes: ["Morning (10am-12pm)", "Afternoon (3pm-6pm)"],
    selectedDays: ["Mon", "Wed"],
    customPreference: "",
    noPreference: false,
  },
};

describe("buildUserProfilePayloadFromSurvey", () => {
  it("maps complete survey state to the backend profile payload", () => {
    const payload = buildUserProfilePayloadFromSurvey(baseSurvey, testProgramListResponse);

    expect(payload).toMatchObject({
      graduation_month: 5,
      graduation_year: 2026,
      degrees: ["Computer Science (major)"],
      school: testProgramListResponse.whitingSchoolLabel,
      raw_goals_text: "Software Engineering",
      raw_preferences_text: "Times: Morning (10am-12pm), Afternoon (3pm-6pm); Days: Mon, Wed",
    });
    expect(payload.raw_workload_text).toEqual(expect.any(String));
  });

  it("prefers still-exploring and custom free text where applicable", () => {
    const payload = buildUserProfilePayloadFromSurvey(
      {
        ...baseSurvey,
        careerGoal: {
          selected: ["Software Engineering"],
          custom: "I want computational biology research",
          stillExploring: true,
        },
        classTimePreference: {
          selectedTimes: [],
          selectedDays: [],
          customPreference: "Avoid Friday afternoons",
          noPreference: false,
        },
      },
      testProgramListResponse,
    );

    expect(payload.raw_goals_text).toBe("Still exploring");
    expect(payload.raw_preferences_text).toBe("Avoid Friday afternoons");
  });

  it("omits school when the primary major cannot be mapped", () => {
    const payload = buildUserProfilePayloadFromSurvey(
      {
        ...baseSurvey,
        degreeAndGraduation: {
          graduationMonth: "12",
          graduationYear: "2027",
          programs: [{ name: "Unknown Program", kind: "major" as const }],
        },
      },
      testProgramListResponse,
    );

    expect(payload.graduation_month).toBe(12);
    expect(payload.school).toBeUndefined();
  });
});
