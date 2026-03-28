/**
 * Build API payload from onboarding survey state.
 * Matches PUT /api/user/profile body shape per iteration-2 plan.
 */

import { getSchoolLabelForPrimaryMajor } from "@/components/surveys/program_list";
import type { ClassTimePreferenceValue } from "@/components/surveys/ClassTimePreference";
import type { DegreeAndGraduationValue } from "@/components/surveys/DegreeAndGraduation";
import type { WorkloadPreference } from "@/components/surveys/WorkloadTolerance";
import { describeWorkloadPreference } from "@/components/surveys/WorkloadTolerance";

export interface UserProfilePayload {
  graduation_month?: number;
  graduation_year?: number;
  degrees?: string[];
  school?: string;
  raw_goals_text?: string;
  raw_workload_text?: string;
  raw_preferences_text?: string;
}

interface SurveyState {
  degreeAndGraduation: DegreeAndGraduationValue;
  careerGoal: {
    selected: string[];
    custom: string;
    stillExploring: boolean;
  };
  workloadTolerance: WorkloadPreference | null;
  classTimePreference: ClassTimePreferenceValue;
}

export function buildUserProfilePayloadFromSurvey(survey: SurveyState): UserProfilePayload {
  const { degreeAndGraduation, careerGoal, workloadTolerance, classTimePreference } = survey;

  const degrees = degreeAndGraduation.programs.map((p) => `${p.name} (${p.kind})`);
  const primaryMajor = degreeAndGraduation.programs.find((p) => p.kind === "major");
  const school = getSchoolLabelForPrimaryMajor(primaryMajor?.name ?? null);

  let raw_goals_text = "";
  if (careerGoal.stillExploring) {
    raw_goals_text = "Still exploring";
  } else if (careerGoal.custom.trim()) {
    raw_goals_text = careerGoal.custom.trim();
  } else if (careerGoal.selected.length > 0) {
    raw_goals_text = careerGoal.selected.join(", ");
  }

  const raw_workload_text = workloadTolerance
    ? describeWorkloadPreference(workloadTolerance)
    : undefined;

  let raw_preferences_text = "";
  if (classTimePreference.noPreference) {
    raw_preferences_text = "No preference";
  } else if (classTimePreference.customPreference.trim()) {
    raw_preferences_text = classTimePreference.customPreference.trim();
  } else if (
    classTimePreference.selectedTimes.length >= 2 &&
    classTimePreference.selectedDays.length >= 2
  ) {
    raw_preferences_text = `Times: ${classTimePreference.selectedTimes.join(", ")}; Days: ${classTimePreference.selectedDays.join(", ")}`;
  }

  const MONTH_NAME_TO_NUMBER: Record<string, number> = {
    January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
    July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
  };
  const graduation_month = degreeAndGraduation.graduationMonth
    ? (MONTH_NAME_TO_NUMBER[degreeAndGraduation.graduationMonth] ?? parseInt(degreeAndGraduation.graduationMonth, 10) || undefined)
    : undefined;
  const graduation_year = degreeAndGraduation.graduationYear
    ? parseInt(degreeAndGraduation.graduationYear, 10)
    : undefined;

  return {
    graduation_month: graduation_month || undefined,
    graduation_year: graduation_year || undefined,
    degrees: degrees.length > 0 ? degrees : undefined,
    school: school !== "N/A" ? school : undefined,
    raw_goals_text: raw_goals_text || undefined,
    raw_workload_text,
    raw_preferences_text: raw_preferences_text || undefined,
  };
}
