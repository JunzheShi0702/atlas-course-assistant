import { describe, expect, it } from "vitest";
import { testProgramListResponse } from "@/test/fixtures/programListResponse";
import { hydrateSurveyFromUserProfile } from "./hydrateSurveyFromUserProfile";

describe("hydrateSurveyFromUserProfile", () => {
  it("hydrates saved profile text into survey state", () => {
    const state = hydrateSurveyFromUserProfile(
      {
        graduationMonth: "May",
        graduationYear: "2026",
        degrees: "Computer Science (major); Mathematics (minor)",
        goalsText: "Software Engineering",
        workloadText: "I prefer a balanced workload.",
        preferencesText: "Times: Morning (10am-12pm), Afternoon (3pm-6pm); Days: Mon, Wed",
      },
      testProgramListResponse.programs,
    );

    expect(state.degreeAndGraduation).toMatchObject({
      graduationMonth: "May",
      graduationYear: "2026",
      programs: [
        { name: "Computer Science", kind: "major" },
        { name: "Mathematics", kind: "minor" },
      ],
    });
    expect(state.careerGoal.selected).toContain("Software Engineering");
    expect(state.classTimePreference.selectedTimes).toEqual([
      "Morning (10am-12pm)",
      "Afternoon (3pm-6pm)",
    ]);
    expect(state.classTimePreference.selectedDays).toEqual(["Mon", "Wed"]);
  });

  it("keeps unknown degree text out of survey programs", () => {
    const state = hydrateSurveyFromUserProfile(
      {
        degrees: "Unknown Program (major)",
        goalsText: "Still exploring",
        preferencesText: "No preference",
      },
      testProgramListResponse.programs,
    );

    expect(state.degreeAndGraduation.programs).toEqual([]);
    expect(state.careerGoal.stillExploring).toBe(true);
    expect(state.classTimePreference.noPreference).toBe(true);
  });

  it("stores unrecognized preference text as custom text", () => {
    const state = hydrateSurveyFromUserProfile(
      {
        preferencesText: "Please avoid back-to-back labs",
      },
      testProgramListResponse.programs,
    );

    expect(state.classTimePreference.customPreference).toBe("Please avoid back-to-back labs");
  });
});
