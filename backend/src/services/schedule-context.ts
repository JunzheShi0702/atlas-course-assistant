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
  credits: number | null;
};

export type ScheduleAgentProfile = {
  school: string | null;
  degrees: string[] | null;
  rawGoalsText: string | null;
  rawWorkloadText: string | null;
  rawPreferencesText: string | null;
  derivedMemories: unknown;
};

/** Row from canonical `user_memories` store (onboarding + chat + manual). */
export type CanonicalMemoryRow = {
  memory_text: string;
  memory_type: string;
  source: string;
};

export type ScheduleAgentContext = {
  scheduleName: string;
  scheduleTerm: string;
  courses: ScheduleCourseRow[];
  profile: ScheduleAgentProfile | null;
  /**
   * Canonical memory rows for this user. When non-empty, agent prompts prefer these over
   * legacy `user_profiles.derived_memories` JSON.
   */
  canonicalMemories: CanonicalMemoryRow[];
};

export type LoadScheduleContextError = "not_found" | "forbidden";

/** Profile + canonical memories only (for standalone agent prompt injection). */
export type UserMemoryPromptContext = {
  canonicalMemories: CanonicalMemoryRow[];
  profile: ScheduleAgentProfile | null;
};

const MAX_TEXT_SNIPPET = 2000;
const MAX_JSON_SNIPPET = 3000;

function truncateText(s: string): string {
  const t = s.trim();
  if (t.length <= MAX_TEXT_SNIPPET) return t;
  return `${t.slice(0, MAX_TEXT_SNIPPET)}…`;
}

async function loadUserProfileAndCanonicalMemories(
  dbUserId: string,
): Promise<UserMemoryPromptContext> {
  const [{ rows: profileRows }, { rows: memoryRows }] = await Promise.all([
    pool.query<{
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
    ),
    pool.query<CanonicalMemoryRow>(
      `SELECT memory_text, memory_type, source
       FROM user_memories
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [dbUserId],
    ),
  ]);

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

  return { profile, canonicalMemories: memoryRows };
}

/**
 * Loads the same canonical memories + profile slice used for schedule-aware prompts,
 * for injecting into non-schedule agent requests (home search chat).
 */
export async function loadUserMemoryContextForAgent(userId: string): Promise<UserMemoryPromptContext> {
  return loadUserProfileAndCanonicalMemories(toDatabaseUserId(userId));
}

function appendCanonicalMemoriesSection(
  lines: string[],
  canonicalMemories: CanonicalMemoryRow[],
  profile: ScheduleAgentProfile | null,
): void {
  if (canonicalMemories.length > 0) {
    lines.push("Structured memories (canonical store — user_memories):");
    for (const m of canonicalMemories) {
      lines.push(`- [${m.memory_type}] (${m.source}) ${m.memory_text}`);
    }
    return;
  }
  if (profile?.derivedMemories != null) {
    let mem: string;
    try {
      mem = JSON.stringify(profile.derivedMemories);
    } catch {
      mem = String(profile.derivedMemories);
    }
    lines.push(
      `Derived memories (legacy JSON from onboarding; migrate to user_memories): ${mem.length > MAX_JSON_SNIPPET ? `${mem.slice(0, MAX_JSON_SNIPPET)}…` : mem}`,
    );
  }
}

/**
 * Long-term memory lines for workload audit prompts — same precedence as schedule chat:
 * canonical `user_memories` first, else legacy `derived_memories` JSON.
 * When neither exists, returns an explicit empty-state line (audit always shows the section).
 */
export function formatAuditMemoryContext(
  canonicalMemories: CanonicalMemoryRow[] | undefined,
  profile: ScheduleAgentProfile | null,
): string {
  const lines: string[] = [];
  appendCanonicalMemoriesSection(lines, canonicalMemories ?? [], profile);
  if (lines.length === 0) {
    return "No structured long-term memories stored.";
  }
  return lines.join("\n");
}

/**
 * Standalone block for authenticated home chat: long-term memories only (no schedule rows).
 * Returns empty string when there are no canonical rows and no legacy derived JSON.
 */
export function buildUserMemoriesOnlyBlock(ctx: UserMemoryPromptContext): string {
  const inner: string[] = [];
  appendCanonicalMemoriesSection(inner, ctx.canonicalMemories, ctx.profile);
  if (inner.length === 0) return "";
  return [
    "",
    "---",
    "LONG-TERM USER CONTEXT (stored preferences and memories; personalize advice when relevant).",
    ...inner,
  ].join("\n");
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
    credits: string | null;
  }>(
    `SELECT sc.course_code, sc.sis_offering_name, sc.term, sc.title,
            COALESCE(sc.credits, ce.credits) AS credits
     FROM schedule_courses sc
     LEFT JOIN course_embeddings ce
       ON ce.sis_offering_name = sc.sis_offering_name AND ce.term = sc.term
     WHERE sc.schedule_id = $1
     ORDER BY sc.course_code`,
    [scheduleId],
  );

  const { profile, canonicalMemories } = await loadUserProfileAndCanonicalMemories(dbUserId);

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
        credits: c.credits !== null ? parseFloat(c.credits) : null,
      })),
      profile,
      canonicalMemories,
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
  }

  appendCanonicalMemoriesSection(lines, ctx.canonicalMemories, ctx.profile);

  lines.push(
    "You may reference the courses above when the question is about this schedule.",
    "For workload or difficulty of a specific course, use search tools if you need a courseId, then getCourseEvalSummary with that courseId from tool results.",
    "For meeting times, instructor, or room, use getSisCourseDetails after resolving courseId.",
  );

  return lines.join("\n");
}
