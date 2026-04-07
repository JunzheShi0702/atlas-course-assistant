import type { Pool } from "pg";
import { derivedMemoriesSchema } from "./parse-onboarding-responses";

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

function collectDerivedMemoryRows(
  rawDerived: unknown,
): Array<{ text: string; type: "goal" | "preference" | "constraint" }> {
  const out: Array<{ text: string; type: "goal" | "preference" | "constraint" }> = [];
  if (rawDerived == null) return out;
  if (Array.isArray(rawDerived) && rawDerived.length === 0) return out;

  const parsed = derivedMemoriesSchema.safeParse(rawDerived);
  if (!parsed.success) {
    console.warn(
      "[sync-onboarding-memories] invalid derived_memories shape",
      parsed.error.flatten(),
    );
    return out;
  }

  const d = parsed.data;
  for (const g of d.goals) {
    out.push({ text: g, type: "goal" });
  }
  if (d.workloadTolerance !== "unspecified") {
    out.push({
      text: `workload_tolerance: ${d.workloadTolerance}`,
      type: "preference",
    });
  }
  for (const t of d.timePreferences) {
    out.push({ text: t, type: "constraint" });
  }
  for (const n of d.notes) {
    out.push({ text: n, type: "preference" });
  }
  return out;
}

/**
 * Replaces all `source = 'onboarding'` rows in `user_memories` from the saved
 * `user_profiles` row: exact raw texts, degrees, school, graduation, plus structured
 * `derived_memories`. Leaves chat/manual rows unchanged.
 */
export async function replaceOnboardingMemoriesFromProfile(
  db: Queryable,
  userId: string,
  profile: UserProfileRowForMemorySync,
): Promise<void> {
  await db.query(`DELETE FROM user_memories WHERE user_id = $1 AND source = 'onboarding'`, [
    userId,
  ]);

  const rows: Array<{ text: string; type: "goal" | "preference" | "constraint" }> = [];

  const school = profile.school?.trim();
  if (school) {
    rows.push({ text: school, type: "preference" });
  }

  const gradLine = formatGraduationLine(profile.graduation_month, profile.graduation_year);
  if (gradLine) {
    rows.push({ text: gradLine, type: "preference" });
  }

  for (const d of profile.degrees ?? []) {
    const t = typeof d === "string" ? d.trim() : "";
    if (t) {
      rows.push({ text: t, type: "goal" });
    }
  }

  const goalsText = profile.raw_goals_text?.trim();
  if (goalsText) {
    rows.push({ text: goalsText, type: "goal" });
  }

  const workloadText = profile.raw_workload_text?.trim();
  if (workloadText) {
    rows.push({ text: workloadText, type: "preference" });
  }

  const prefsText = profile.raw_preferences_text?.trim();
  if (prefsText) {
    rows.push({ text: prefsText, type: "constraint" });
  }

  rows.push(...collectDerivedMemoryRows(profile.derived_memories));

  for (const r of rows) {
    await db.query(
      `INSERT INTO user_memories (user_id, memory_text, memory_type, source, confidence)
       VALUES ($1, $2, $3, 'onboarding', 0.70)`,
      [userId, r.text, r.type],
    );
  }
}
