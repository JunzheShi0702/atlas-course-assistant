import type { ClassTimePreferenceValue } from "@/components/surveys/ClassTimePreference";
import type { DegreeAndGraduationValue } from "@/components/surveys/DegreeAndGraduation";
import { getSchoolLabelForPrimaryMajor } from "@/components/surveys/program_list";
import { describeWorkloadPreference, type WorkloadPreference } from "@/components/surveys/WorkloadTolerance";
import type { UserProfilePayload } from "@/hooks/useApi";

export interface OnboardingSurveySnapshot {
  degreeAndGraduation: DegreeAndGraduationValue;
  careerGoal: {
    selected: string[];
    custom: string;
    stillExploring: boolean;
  };
  workloadTolerance: WorkloadPreference | null;
  classTimePreference: ClassTimePreferenceValue;
}

function formatDegrees(degree: DegreeAndGraduationValue): string {
  const majors = degree.programs.filter((p) => p.kind === "major");
  const minors = degree.programs.filter((p) => p.kind === "minor");
  const parts = [
    ...majors.map((p) => `${p.name} (major)`),
    ...minors.map((p) => `${p.name} (minor)`),
  ];
  return parts.join("; ");
}

function formatGoals(career: OnboardingSurveySnapshot["careerGoal"]): string {
  if (career.stillExploring) return "Still exploring career goals.";
  const custom = career.custom.trim();
  if (custom) return custom;
  if (career.selected.length > 0) return career.selected.join(", ");
  return "";
}

function formatClassTimePreferences(ctp: ClassTimePreferenceValue): string {
  if (ctp.noPreference) {
    return "No preference for class meeting times or days.";
  }
  const custom = ctp.customPreference.trim();
  if (custom) return custom;
  const times = ctp.selectedTimes.length ? ctp.selectedTimes.join(", ") : "(none selected)";
  const days = ctp.selectedDays.length ? ctp.selectedDays.join(", ") : "(none selected)";
  return `Preferred meeting times: ${times}. Preferred weekdays: ${days}.`;
}

/**
 * Maps full onboarding survey state to the POST /api/user/profile body.
 */
export function buildUserProfilePayloadFromSurvey(survey: OnboardingSurveySnapshot): UserProfilePayload {
  const { degreeAndGraduation, careerGoal, workloadTolerance, classTimePreference } = survey;
  const majors = degreeAndGraduation.programs.filter((p) => p.kind === "major");
  const primaryMajorName = majors[0]?.name ?? null;

  const goalsText = formatGoals(careerGoal);
  const workloadText = workloadTolerance ? describeWorkloadPreference(workloadTolerance) : "";

  return {
    graduationMonth: degreeAndGraduation.graduationMonth || undefined,
    graduationYear: degreeAndGraduation.graduationYear || undefined,
    degrees: formatDegrees(degreeAndGraduation),
    school: getSchoolLabelForPrimaryMajor(primaryMajorName),
    goalsText: goalsText || undefined,
    workloadText: workloadText || undefined,
    preferencesText: formatClassTimePreferences(classTimePreference),
  };
}
