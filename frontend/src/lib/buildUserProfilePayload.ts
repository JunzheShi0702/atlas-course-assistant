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
  graduationMonth?: string;
  graduationYear?: string;
  degrees?: string;
  school?: string;
  goalsText?: string;
  workloadText?: string;
  preferencesText?: string;
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

  const degrees = degreeAndGraduation.programs
    .map((p) => `${p.name} (${p.kind})`)
    .join("; ");
  const primaryMajor = degreeAndGraduation.programs.find((p) => p.kind === "major");
  const school = getSchoolLabelForPrimaryMajor(primaryMajor?.name ?? null);

  let goalsText = "";
  if (careerGoal.stillExploring) {
    goalsText = "Still exploring";
  } else if (careerGoal.custom.trim()) {
    goalsText = careerGoal.custom.trim();
  } else if (careerGoal.selected.length > 0) {
    goalsText = careerGoal.selected.join(", ");
  }

  const workloadText = workloadTolerance
    ? describeWorkloadPreference(workloadTolerance)
    : undefined;

  let preferencesText = "";
  if (classTimePreference.noPreference) {
    preferencesText = "No preference";
  } else if (classTimePreference.customPreference.trim()) {
    preferencesText = classTimePreference.customPreference.trim();
  } else if (
    classTimePreference.selectedTimes.length >= 2 &&
    classTimePreference.selectedDays.length >= 2
  ) {
    preferencesText = `Times: ${classTimePreference.selectedTimes.join(", ")}; Days: ${classTimePreference.selectedDays.join(", ")}`;
  }

  return {
    graduationMonth: degreeAndGraduation.graduationMonth || undefined,
    graduationYear: degreeAndGraduation.graduationYear || undefined,
    degrees: degrees || undefined,
    school: school !== "N/A" ? school : undefined,
    goalsText: goalsText || undefined,
    workloadText,
    preferencesText: preferencesText || undefined,
  };
}
