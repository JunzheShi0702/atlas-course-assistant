/**
 * Load schedule + user profile snippets for schedule-aware agent (issue #120).
 */

import { pool } from "../db";
import { toDatabaseUserId } from "../middleware/auth";

export type ScheduleCourseRow = {
  courseCode: string;
  sisOfferingName: string;
  term: string;
  courseTitle: string;
};

export type ScheduleAgentProfile = {
  school: string | null;
  degrees: string[] | null;
  rawGoalsText: string | null;
  rawWorkloadText: string | null;
  rawPreferencesText: string | null;
  derivedMemories: unknown;
};

export type ScheduleAgentContext = {
  scheduleName: string;
  scheduleTerm: string;
  courses: ScheduleCourseRow[];
  profile: ScheduleAgentProfile | null;
};

export type LoadScheduleContextError = "not_found" | "forbidden";

const MAX_TEXT_SNIPPET = 2000;
const MAX_JSON_SNIPPET = 3000;

function truncateText(s: string): string {
  const t = s.trim();
  if (t.length <= MAX_TEXT_SNIPPET) return t;
  return `${t.slice(0, MAX_TEXT_SNIPPET)}…`;
}

export async function loadScheduleContextForAgent(
  userId: string,
  scheduleId: string,
): Promise<{ ok: true; context: ScheduleAgentContext } | { ok: false; error: LoadScheduleContextError }> {
  const { rows: schedRows } = await pool.query<{
    id: string;
    name: string;
    term: string;
    user_id: string;
  }>(`SELECT id, name, term, user_id FROM schedules WHERE id = $1`, [scheduleId]);

  if (schedRows.length === 0) {
    return { ok: false, error: "not_found" };
  }
  const dbUserId = toDatabaseUserId(userId);
  const rowUserId = schedRows[0].user_id;
  // Match either canonical UUID (from PostgreSQL uuid column) or legacy/prefixed app id string.
  if (rowUserId !== dbUserId && rowUserId !== userId) {
    return { ok: false, error: "forbidden" };
  }

  const { rows: courseRows } = await pool.query<{
    course_code: string;
    sis_offering_name: string;
    term: string;
    title: string;
  }>(
    `SELECT course_code, sis_offering_name, term, title
     FROM schedule_courses
     WHERE schedule_id = $1
     ORDER BY course_code`,
    [scheduleId],
  );

  const { rows: profileRows } = await pool.query<{
    school: string | null;
    degrees: string[] | null;
    raw_goals_text: string | null;
    raw_workload_text: string | null;
    raw_preferences_text: string | null;
    derived_memories: unknown;
  }>(
    `SELECT school, degrees, raw_goals_text, raw_workload_text, raw_preferences_text, derived_memories
     FROM user_profiles
     WHERE user_id = $1`,
    [dbUserId],
  );

  const profile: ScheduleAgentProfile | null =
    profileRows.length === 0
      ? null
      : {
          school: profileRows[0].school,
          degrees: profileRows[0].degrees,
          rawGoalsText: profileRows[0].raw_goals_text,
          rawWorkloadText: profileRows[0].raw_workload_text,
          rawPreferencesText: profileRows[0].raw_preferences_text,
          derivedMemories: profileRows[0].derived_memories,
        };

  return {
    ok: true,
    context: {
      scheduleName: schedRows[0].name,
      scheduleTerm: schedRows[0].term,
      courses: courseRows.map((c) => ({
        courseCode: c.course_code,
        sisOfferingName: c.sis_offering_name,
        term: c.term,
        courseTitle: c.title ?? "",
      })),
      profile,
    },
  };
}

export function buildScheduleContextBlock(ctx: ScheduleAgentContext): string {
  const lines: string[] = [
    "",
    "---",
    "SCHEDULE-AWARE SESSION (the student opened chat on a saved schedule in the app).",
    `Schedule name: "${ctx.scheduleName}"`,
    `Schedule term: ${ctx.scheduleTerm}`,
  ];

  if (ctx.courses.length === 0) {
    lines.push(
      "Courses on this schedule: (none yet — suggest they add courses from search results in the UI.)",
    );
  } else {
    lines.push("Courses currently on this schedule:");
    for (const c of ctx.courses) {
      const label =
        c.courseTitle.trim() !== ""
          ? `${c.courseTitle.trim()} (${c.courseCode})`
          : c.courseCode;
      lines.push(`- ${label} | offering ${c.sisOfferingName} | ${c.term}`);
    }
  }

  lines.push("Student profile / preferences (from onboarding; use to personalize planning advice):");
  if (!ctx.profile) {
    lines.push("(No saved profile row.)");
  } else {
    const p = ctx.profile;
    if (p.school?.trim()) lines.push(`School: ${p.school.trim()}`);
    if (p.degrees?.length) lines.push(`Degrees / programs: ${p.degrees.join(", ")}`);
    if (p.rawGoalsText?.trim()) lines.push(`Goals (verbatim): ${truncateText(p.rawGoalsText)}`);
    if (p.rawWorkloadText?.trim()) {
      lines.push(`Workload preference (verbatim): ${truncateText(p.rawWorkloadText)}`);
    }
    if (p.rawPreferencesText?.trim()) {
      lines.push(`Other preferences (verbatim): ${truncateText(p.rawPreferencesText)}`);
    }
    if (p.derivedMemories != null) {
      let mem: string;
      try {
        mem = JSON.stringify(p.derivedMemories);
      } catch {
        mem = String(p.derivedMemories);
      }
      lines.push(
        `Derived memories (JSON): ${mem.length > MAX_JSON_SNIPPET ? `${mem.slice(0, MAX_JSON_SNIPPET)}…` : mem}`,
      );
    }
  }

  lines.push(
    "You may reference the courses above when the question is about this schedule.",
    "For workload or difficulty of a specific course, use search tools if you need a courseId, then getCourseEvalSummary with that courseId from tool results.",
    "For meeting times, instructor, or room, use fetchSisCourseDetails after resolving courseId.",
  );

  return lines.join("\n");
}
