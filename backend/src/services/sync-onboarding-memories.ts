import type { Pool } from "pg";
import {
  coerceDerivedMemoriesFromUnknown,
  type DerivedMemoryItem,
} from "./parse-onboarding-responses";

type Queryable = Pick<Pool, "query">;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function formatGraduationLine(
  month: number | null | undefined,
  year: number | null | undefined,
): string | null {
  if (month == null || year == null) return null;
  if (month < 1 || month > 12) return null;
  return `Graduation: ${MONTH_NAMES[month - 1]} ${year}`;
}

export interface UserProfileRowForMemorySync {
  graduation_month: number | null | undefined;
  graduation_year: number | null | undefined;
  degrees: string[] | null | undefined;
  school: string | null | undefined;
  raw_goals_text: string | null | undefined;
  raw_workload_text: string | null | undefined;
  raw_preferences_text: string | null | undefined;
  derived_memories: unknown;
}

function effectiveItemConfidence(item: DerivedMemoryItem): number {
  return item.fromSelectedChoice ? 1 : Math.min(1, Math.max(0, item.confidence));
}

function collectDerivedMemoryRows(
  rawDerived: unknown,
): Array<{ text: string; type: "goal" | "preference" | "constraint"; confidence: number }> {
  const out: Array<{ text: string; type: "goal" | "preference" | "constraint"; confidence: number }> =
    [];
  const d = coerceDerivedMemoriesFromUnknown(rawDerived);
  if (!d) {
    if (rawDerived != null) {
      console.warn("[sync-onboarding-memories] could not coerce derived_memories JSON");
    }
    return out;
  }

  for (const g of d.goals) {
    out.push({ text: g.value, type: "goal", confidence: effectiveItemConfidence(g) });
  }
  if (d.workloadTolerance !== "unspecified") {
    const workloadConf = d.workloadFromSelectedChoiceOnly
      ? 1
      : Math.min(1, Math.max(0, d.workloadConfidence));
    out.push({
      text: `workload_tolerance: ${d.workloadTolerance}`,
      type: "preference",
      confidence: workloadConf,
    });
  }
  for (const t of d.timePreferences) {
    out.push({ text: t.value, type: "constraint", confidence: effectiveItemConfidence(t) });
  }
  for (const n of d.notes) {
    out.push({ text: n.value, type: "preference", confidence: effectiveItemConfidence(n) });
  }
  return out;
}

/**
 * Replaces all `source = 'onboarding'` rows in `user_memories` from the saved
 * `user_profiles` row: structured profile facts (school, graduation, degrees) plus
 * LLM-extracted `derived_memories` only. Verbatim survey prose (`raw_*_text` goals,
 * workload, preferences) stays in `user_profiles` only — not duplicated here.
 */
export async function replaceOnboardingMemoriesFromProfile(
  db: Queryable,
  userId: string,
  profile: UserProfileRowForMemorySync,
): Promise<void> {
  await db.query(`DELETE FROM user_memories WHERE user_id = $1 AND source = 'onboarding'`, [
    userId,
  ]);

  const rows: Array<{ text: string; type: "goal" | "preference" | "constraint"; confidence: number }> =
    [];

  const school = profile.school?.trim();
  if (school) {
    rows.push({ text: school, type: "preference", confidence: 1 });
  }

  const gradLine = formatGraduationLine(profile.graduation_month, profile.graduation_year);
  if (gradLine) {
    rows.push({ text: gradLine, type: "preference", confidence: 1 });
  }

  const degreeList = profile.degrees ?? [];
  degreeList.forEach((d, index) => {
    const t = typeof d === "string" ? d.trim() : "";
    if (!t) return;
    let text = t;
    if (index === 0 && !/\bprimary\s+major\b/i.test(t) && /\(major\)/i.test(t)) {
      text = t.replace(/\(major\)/i, "(primary major)");
    }
    rows.push({ text, type: "goal", confidence: 1 });
  });

  rows.push(...collectDerivedMemoryRows(profile.derived_memories));

  for (const r of rows) {
    await db.query(
      `INSERT INTO user_memories (user_id, memory_text, memory_type, source, confidence)
       VALUES ($1, $2, $3, 'onboarding', $4)`,
      [userId, r.text, r.type, r.confidence],
    );
  }
}
