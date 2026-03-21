import type { DegreeAndGraduationValue } from "@/components/surveys/DegreeAndGraduation";
import { CAREER_GOAL_OPTIONS } from "@/components/surveys/CareerGoal";
import { CLASS_DAY_OPTIONS, CLASS_TIME_RANGE_OPTIONS } from "@/components/surveys/ClassTimePreference";
import { approximateWorkloadFromDescription } from "@/components/surveys/WorkloadTolerance";
import type { UserProfile } from "@/hooks/useApi";
import {
  GOALS_STILL_EXPLORING_TEXT,
  OnboardingSurveySnapshot,
  PREFERENCES_NO_PREFERENCE_TEXT,
} from "@/lib/buildUserProfilePayload";

const GOAL_SET = new Set<string>(CAREER_GOAL_OPTIONS);

function parseDegreesString(raw: string | null | undefined): DegreeAndGraduationValue["programs"] {
  if (!raw?.trim()) return [];
  const programs: DegreeAndGraduationValue["programs"] = [];
  const parts = raw.split(/;\s*/);
  const suffix = /^(.*)\s+\((major|minor)\)$/i;
  for (const part of parts) {
    const trimmed = part.trim();
    const m = trimmed.match(suffix);
    if (m) {
      const kind = m[2].toLowerCase();
      if (kind === "major" || kind === "minor") {
        programs.push({ name: m[1].trim(), kind });
      }
    }
  }
  return programs;
}

function parseGoalsText(goalsText: string | null | undefined): OnboardingSurveySnapshot["careerGoal"] {
  const empty = { selected: [] as string[], custom: "", stillExploring: false };
  if (goalsText == null || !goalsText.trim()) return empty;

  const trimmed = goalsText.trim();
  if (trimmed === GOALS_STILL_EXPLORING_TEXT) {
    return { selected: [], custom: "", stillExploring: true };
  }

  const parts = trimmed.split(", ").map((p) => p.trim()).filter(Boolean);
  if (parts.length > 0 && parts.every((p) => GOAL_SET.has(p))) {
    return { selected: parts, custom: "", stillExploring: false };
  }

  return { selected: [], custom: trimmed, stillExploring: false };
}

const STRUCTURED_PREFS =
  /^Preferred meeting times:\s*(.+?)\.\s*Preferred weekdays:\s*(.+?)\.?\s*$/is;

function parsePreferencesText(
  preferencesText: string | null | undefined,
): OnboardingSurveySnapshot["classTimePreference"] {
  const defaultCtp: OnboardingSurveySnapshot["classTimePreference"] = {
    selectedTimes: [],
    selectedDays: [],
    customPreference: "",
    noPreference: false,
  };

  if (preferencesText == null || !preferencesText.trim()) return defaultCtp;

  const trimmed = preferencesText.trim();
  if (trimmed === PREFERENCES_NO_PREFERENCE_TEXT) {
    return { ...defaultCtp, noPreference: true };
  }

  const structured = trimmed.match(STRUCTURED_PREFS);
  if (structured) {
    const timePart = structured[1].trim();
    const dayPart = structured[2].trim();

    const timeTokens = timePart
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "(none selected)");
    const dayTokens = dayPart
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "(none selected)");

    const selectedTimes = CLASS_TIME_RANGE_OPTIONS.filter((opt) => timeTokens.includes(opt));
    const selectedDays = CLASS_DAY_OPTIONS.filter((opt) => dayTokens.includes(opt));

    return {
      selectedTimes: [...selectedTimes],
      selectedDays: [...selectedDays],
      customPreference: "",
      noPreference: false,
    };
  }

  return {
    ...defaultCtp,
    customPreference: trimmed,
  };
}

const EMPTY_SURVEY: OnboardingSurveySnapshot = {
  degreeAndGraduation: {
    graduationMonth: "",
    graduationYear: "",
    programs: [],
  },
  careerGoal: {
    selected: [],
    custom: "",
    stillExploring: false,
  },
  workloadTolerance: null,
  classTimePreference: {
    selectedTimes: [],
    selectedDays: [],
    customPreference: "",
    noPreference: false,
  },
};

/**
 * Maps GET /api/user/profile JSON into onboarding survey state for edit.
 */
export function hydrateSurveyFromUserProfile(profile: UserProfile): OnboardingSurveySnapshot {
  const programs = parseDegreesString(profile.degrees ?? undefined);

  const degreeAndGraduation: DegreeAndGraduationValue = {
    graduationMonth: profile.graduationMonth?.trim() ?? "",
    graduationYear: profile.graduationYear?.trim() ?? "",
    programs,
  };

  const careerGoal = parseGoalsText(profile.goalsText ?? undefined);
  const classTimePreference = parsePreferencesText(profile.preferencesText ?? undefined);
  const workloadTolerance = approximateWorkloadFromDescription(profile.workloadText ?? undefined);

  return {
    ...EMPTY_SURVEY,
    degreeAndGraduation,
    careerGoal,
    classTimePreference,
    workloadTolerance,
  };
}
