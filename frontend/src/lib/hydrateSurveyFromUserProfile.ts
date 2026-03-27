/**
 * Hydrate survey state from saved user profile (API response).
 */

import type { ClassTimePreferenceValue } from "@/components/surveys/ClassTimePreference";
import { CLASS_DAY_OPTIONS, CLASS_TIME_RANGE_OPTIONS } from "@/components/surveys/ClassTimePreference";
import type { DegreeAndGraduationValue } from "@/components/surveys/DegreeAndGraduation";
import { CAREER_GOAL_OPTIONS } from "@/components/surveys/CareerGoal";
import {
  approximateWorkloadFromDescription,
  type WorkloadPreference,
} from "@/components/surveys/WorkloadTolerance";
import { PROGRAM_LIST } from "@/components/surveys/program_list";

export interface UserProfile {
  graduationMonth?: string | null;
  graduationYear?: string | null;
  degrees?: string | null;
  school?: string | null;
  goalsText?: string | null;
  workloadText?: string | null;
  preferencesText?: string | null;
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

function parsePrograms(degreesText: string | null | undefined): Array<{ name: string; kind: "major" | "minor" }> {
  if (!degreesText?.trim()) return [];
  const programs: Array<{ name: string; kind: "major" | "minor" }> = [];
  const parts = degreesText.split(/;\s*/).filter(Boolean);

  for (const part of parts) {
    const match = part.match(/^(.+?)\s*\((major|minor)\)$/i);
    if (match) {
      const name = match[1].trim();
      const kind = match[2].toLowerCase() as "major" | "minor";
      const exists = PROGRAM_LIST.some(
        (p) => p.name === name && ((kind === "major" && p.hasMajor) || (kind === "minor" && p.hasMinor))
      );
      if (exists) {
        programs.push({ name, kind });
      }
    }
  }
  return programs;
}

function parseClassTimePreference(
  text: string | null | undefined
): ClassTimePreferenceValue {
  const result: ClassTimePreferenceValue = {
    selectedTimes: [],
    selectedDays: [],
    customPreference: "",
    noPreference: false,
  };

  if (!text?.trim()) return result;

  const t = text.toLowerCase();
  if (/no preference/i.test(t)) {
    result.noPreference = true;
    return result;
  }

  for (const opt of CLASS_TIME_RANGE_OPTIONS) {
    if (t.includes(opt.toLowerCase())) {
      result.selectedTimes.push(opt);
    }
  }
  for (const day of CLASS_DAY_OPTIONS) {
    const dayLower = day.toLowerCase();
    if (t.includes(dayLower) || t.includes(dayLower + " ")) {
      result.selectedDays.push(day);
    }
  }

  if (result.selectedTimes.length < 2 || result.selectedDays.length < 2) {
    result.customPreference = text.trim();
  }

  return result;
}

export function hydrateSurveyFromUserProfile(profile: UserProfile): SurveyState {
  const goalsText = profile.goalsText?.trim() ?? "";
  const stillExploring = /still exploring/i.test(goalsText);
  const selectedGoals = stillExploring
    ? []
    : CAREER_GOAL_OPTIONS.filter((opt) =>
        goalsText.toLowerCase().includes(opt.toLowerCase())
      );
  const customGoal =
    stillExploring || selectedGoals.length > 0 ? "" : goalsText;

  return {
    degreeAndGraduation: {
      graduationMonth: profile.graduationMonth ?? "",
      graduationYear: profile.graduationYear ?? "",
      programs: parsePrograms(profile.degrees),
    },
    careerGoal: {
      selected: selectedGoals,
      custom: customGoal,
      stillExploring,
    },
    workloadTolerance: approximateWorkloadFromDescription(profile.workloadText),
    classTimePreference: parseClassTimePreference(profile.preferencesText),
  };
}
