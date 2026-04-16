/**
 * User & profile endpoints
 *
 * POST /api/user         — upsert a user on login (email + google_sub)
 * GET  /api/user/profile — fetch the authenticated user's profile (camelCase JSON)
 * PUT  /api/user/profile — create or update profile (camelCase body from onboarding; camelCase response)
 * GET  /api/user/memories — list all stored memories for the current user `{ memories: MemoryItem[] }`
 * POST /api/user/memories/clear-conversations — delete all chat + manual memories for the user
 * POST /api/user/memories/manual — add a manual memory (confidence 1.0)
 * DELETE /api/user/memories/:id — delete chat/manual/course_history or 409 for onboarding-derived
 * DELETE /api/user       — delete the authenticated user, all related data (CASCADE), and server sessions
 */

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { pool } from "../db";
import { toDatabaseUserId } from "../middleware/auth";
import {
  parseOnboardingResponses,
  shouldRecomputeDerivedMemories,
  mergeProfileTextsForDerivation,
  allOnboardingTextKeysInBody,
} from "../services/parse-onboarding-responses";
import { replaceOnboardingMemoriesFromProfile } from "../services/sync-onboarding-memories";

declare module "express-serve-static-core" {
  interface Request {
    user?: { id: string; email: string; name?: string };
  }
}

/** API shape expected by the frontend (useApi / hydrateSurveyFromUserProfile). */
export interface ClientUserProfile {
  graduationMonth?: string | null;
  graduationYear?: string | null;
  degrees?: string | null;
  school?: string | null;
  goalsText?: string | null;
  workloadText?: string | null;
  preferencesText?: string | null;
}

/** API shape for `GET /api/user/memories`. */
export interface MemoryItem {
  id: string;
  text: string;
  type: string;
  source: string;
  confidence: number;
  createdAt: string;
}

function memoryRowToItem(row: {
  id: string;
  memory_text: string;
  memory_type: string;
  source: string;
  confidence: string | number;
  created_at: Date | string;
}): MemoryItem {
  const created = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
  return {
    id: row.id,
    text: row.memory_text,
    type: row.memory_type,
    source: row.source,
    confidence: Number(row.confidence),
    createdAt: created.toISOString(),
  };
}

const MONTH_NAME_TO_NUM: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

/** Labels for 1–12; derived from `MONTH_NAME_TO_NUM` so PUT name → DB int → GET name round-trips. */
const MONTH_NUM_TO_FRONTEND: Record<number, string> = Object.fromEntries(
  Object.entries(MONTH_NAME_TO_NUM).map(([name, num]) => [
    num,
    name.charAt(0).toUpperCase() + name.slice(1),
  ]),
) as Record<number, string>;

export function dbRowToClientProfile(row: Record<string, unknown>): ClientUserProfile {
  const gm = row.graduation_month as number | null | undefined;
  const gy = row.graduation_year as number | null | undefined;
  const deg = row.degrees as string[] | null | undefined;

  return {
    graduationMonth:
      gm != null && gm >= 1 && gm <= 12
        ? (MONTH_NUM_TO_FRONTEND[gm] ?? String(gm))
        : null,
    graduationYear: gy != null ? String(gy) : null,
    degrees:
      deg != null && Array.isArray(deg) ? deg.join("; ") : null,
    school: (row.school as string | null) ?? null,
    goalsText: (row.raw_goals_text as string | null) ?? null,
    workloadText: (row.raw_workload_text as string | null) ?? null,
    preferencesText: (row.raw_preferences_text as string | null) ?? null,
  };
}

function parseFrontendGraduationMonth(raw: string | null | undefined): number | null {
  if (!raw?.trim()) return null;
  const n = parseInt(raw, 10);
  if (!Number.isNaN(n) && n >= 1 && n <= 12) return n;
  const key = raw.trim().toLowerCase();
  return MONTH_NAME_TO_NUM[key] ?? null;
}

function parseFrontendGraduationYear(raw: string | null | undefined): number | null {
  if (!raw?.trim()) return null;
  const m = raw.match(/^(\d{4})/);
  if (m) return parseInt(m[1], 10);
  return null;
}

function degreesStringToArray(s: string | null | undefined): string[] | null {
  if (s == null) return null;
  const t = s.trim();
  if (!t) return [];
  return t.split(";").map((x) => x.trim()).filter(Boolean);
}

/** Matches previous int bounds: month 1–12 (here via string month name or "1"–"12"). */
function isValidProfileGraduationMonth(value: string | null | undefined): boolean {
  if (value == null) return true;
  if (!value.trim()) return true;
  return parseFrontendGraduationMonth(value) !== null;
}

const MIN_GRADUATION_YEAR = 2026;
const MAX_GRADUATION_YEAR = 2100;

/** Stricter than legacy 1900 floor: undergraduate schedules are forward-looking. */
function isValidProfileGraduationYear(value: string | null | undefined): boolean {
  if (value == null) return true;
  if (!value.trim()) return true;
  const y = parseFrontendGraduationYear(value);
  return y !== null && y >= MIN_GRADUATION_YEAR && y <= MAX_GRADUATION_YEAR;
}

function isValidDegreesSemicolonString(value: string | null | undefined): boolean {
  if (value == null) return true;
  const t = value.trim();
  if (!t) return true;
  const parts = value.split(";").map((x) => x.trim());
  return parts.every((p) => p.length > 0);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

const upsertUserSchema = z.object({
  email: z.string().email(),
  google_sub: z.string().min(1),
});

/** Body for DELETE /api/user — explicit confirmation prevents accidental deletion. */
const deleteUserBodySchema = z.object({
  confirm: z.literal(true),
});

const upsertCourseHistoryMemorySchema = z.object({
  courseCode: z.string().trim().min(1).max(64),
});

const manualMemoryTypeSchema = z.enum(["goal", "preference", "constraint", "learning_style"]);

const addManualMemorySchema = z.object({
  text: z.string().trim().min(1).max(2000),
  memoryType: manualMemoryTypeSchema.optional().default("preference"),
});

/**
 * PUT body — accepts both formats:
 *   - snake_case with native types (from buildUserProfilePayload.ts)
 *   - camelCase strings (legacy hydrateSurveyFromUserProfile round-trip)
 * All fields are optional so partial updates work.
 * `derived_memories` is not accepted from clients; the server sets it via parseOnboardingResponses.
 */
const upsertProfileSchema = z.object({
  // ── snake_case (buildUserProfilePayload.ts) ──────────────────────────────
  graduation_month: z.number().int().min(1).max(12).optional().nullable(),
  graduation_year: z.number().int().optional().nullable(),
  raw_goals_text: z.string().max(10000).optional().nullable(),
  raw_workload_text: z.string().max(10000).optional().nullable(),
  raw_preferences_text: z.string().max(10000).optional().nullable(),
  // ── shared ───────────────────────────────────────────────────────────────
  degrees: z
    .union([
      z.string().max(10000).refine(isValidDegreesSemicolonString, {
        message: "degrees segments must be non-empty (use ';' only between entries)",
      }),
      z.array(z.string()),
    ])
    .optional()
    .nullable(),
  school: z.string().max(255).optional().nullable(),
  // ── camelCase (legacy / hydrateSurveyFromUserProfile round-trip) ─────────
  graduationMonth: z.string().max(12).nullish().refine(isValidProfileGraduationMonth, {
    message: "graduationMonth must be 1–12 or a full English month name (e.g. May)",
  }),
  graduationYear: z.string().max(32).nullish().refine(isValidProfileGraduationYear, {
    message: `graduationYear must be a year from ${MIN_GRADUATION_YEAR} through ${MAX_GRADUATION_YEAR}`,
  }),
  goalsText: z.string().max(10000).nullish(),
  workloadText: z.string().max(10000).nullish(),
  preferencesText: z.string().max(10000).nullish(),
  goalPresets: z.array(z.string()).max(50).optional().nullable(),
  workloadPresets: z.array(z.string()).max(50).optional().nullable(),
  preferencePresets: z.array(z.string()).max(50).optional().nullable(),
});

const router = Router();

export async function upsertUserByGoogleSub(
  email: string,
  google_sub: string,
): Promise<{ id: string; email: string }> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, google_sub)
     VALUES ($1, $2)
     ON CONFLICT (google_sub)
       DO UPDATE SET email = EXCLUDED.email, updated_at = now()
     RETURNING id, email`,
    [email, google_sub],
  );
  return rows[0];
}

export async function handleUpsertUser(req: Request, res: Response) {
  const parsed = upsertUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { email, google_sub } = parsed.data;

  try {
    const user = await upsertUserByGoogleSub(email, google_sub);
    res.json(user);
  } catch (err) {
    console.error("upsertUser error:", err);
    res.status(500).json({ error: "Failed to upsert user" });
  }
}

export async function handleGetProfile(req: Request, res: Response) {
  const userId = req.user!.id;

  try {
    const { rows } = await pool.query(
      `SELECT * FROM user_profiles WHERE user_id = $1`,
      [userId],
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    res.json(dbRowToClientProfile(rows[0] as Record<string, unknown>));
  } catch (err) {
    console.error("getProfile error:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
}

async function upsertProfileRow(
  userId: string,
  graduation_month: number | null,
  graduation_year: number | null,
  degrees: string[] | null,
  school: string | null,
  raw_goals_text: string | null,
  raw_workload_text: string | null,
  raw_preferences_text: string | null,
  derived_memoriesJson: string | null,
): Promise<Record<string, unknown>> {
  const { rows } = await pool.query(
    `INSERT INTO user_profiles (user_id, graduation_month, graduation_year, degrees, school, raw_goals_text, raw_workload_text, raw_preferences_text, derived_memories)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::jsonb, '[]'::jsonb))
       ON CONFLICT (user_id)
         DO UPDATE SET
           graduation_month     = COALESCE($2, user_profiles.graduation_month),
           graduation_year      = COALESCE($3, user_profiles.graduation_year),
           degrees              = COALESCE($4, user_profiles.degrees),
           school               = COALESCE($5, user_profiles.school),
           raw_goals_text       = COALESCE($6, user_profiles.raw_goals_text),
           raw_workload_text    = COALESCE($7, user_profiles.raw_workload_text),
           raw_preferences_text = COALESCE($8, user_profiles.raw_preferences_text),
           derived_memories     = COALESCE($9::jsonb, user_profiles.derived_memories),
           updated_at           = now()
       RETURNING *`,
    [
      userId,
      graduation_month,
      graduation_year,
      degrees,
      school,
      raw_goals_text,
      raw_workload_text,
      raw_preferences_text,
      derived_memoriesJson,
    ],
  );
  return rows[0] as Record<string, unknown>;
}

export async function handleUpsertProfile(req: Request, res: Response) {
  const userId = req.user!.id;

  const parsed = upsertProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    const messages = parsed.error.errors.map((e) => e.message).join("; ");
    res.status(400).json({ error: messages || "Invalid profile data" });
    return;
  }

  const b = parsed.data;

  // Accept snake_case numeric types (buildUserProfilePayload.ts) or legacy camelCase strings.
  const graduation_month =
    b.graduation_month !== undefined && b.graduation_month !== null
      ? b.graduation_month
      : parseFrontendGraduationMonth(b.graduationMonth);
  const graduation_year =
    b.graduation_year !== undefined && b.graduation_year !== null
      ? b.graduation_year
      : parseFrontendGraduationYear(b.graduationYear);
  const degrees = Array.isArray(b.degrees)
    ? (b.degrees as string[]).filter(Boolean)
    : degreesStringToArray(b.degrees as string | null | undefined);
  const school = b.school ?? null;
  const raw_goals_text = b.raw_goals_text !== undefined ? b.raw_goals_text : (b.goalsText ?? null);
  const raw_workload_text = b.raw_workload_text !== undefined ? b.raw_workload_text : (b.workloadText ?? null);
  const raw_preferences_text = b.raw_preferences_text !== undefined ? b.raw_preferences_text : (b.preferencesText ?? null);

  const body = req.body as Record<string, unknown>;

  try {
    let derived_memoriesJson: string | null = null;
    if (shouldRecomputeDerivedMemories(body)) {
      let existingTexts: {
        raw_goals_text: string | null;
        raw_workload_text: string | null;
        raw_preferences_text: string | null;
      } | null = null;
      if (!allOnboardingTextKeysInBody(body)) {
        const { rows: existingRows } = await pool.query(
          `SELECT raw_goals_text, raw_workload_text, raw_preferences_text
           FROM user_profiles WHERE user_id = $1`,
          [userId],
        );
        const row0 = existingRows[0] as
          | {
              raw_goals_text: string | null;
              raw_workload_text: string | null;
              raw_preferences_text: string | null;
            }
          | undefined;
        existingTexts = row0 ?? null;
      }
      const merged = mergeProfileTextsForDerivation(
        body,
        { raw_goals_text, raw_workload_text, raw_preferences_text },
        existingTexts,
      );
      const derived = await parseOnboardingResponses({
        goals: merged.goals,
        workload: merged.workload,
        preferences: merged.preferences,
        goalPresets: "goalPresets" in body ? (b.goalPresets?.filter(Boolean) ?? []) : undefined,
        workloadPresets: "workloadPresets" in body ? (b.workloadPresets?.filter(Boolean) ?? []) : undefined,
        preferencePresets:
          "preferencePresets" in body ? (b.preferencePresets?.filter(Boolean) ?? []) : undefined,
      });
      derived_memoriesJson = derived !== null ? JSON.stringify(derived) : null;
    }

    const row = await upsertProfileRow(
      userId,
      graduation_month,
      graduation_year,
      degrees,
      school,
      raw_goals_text,
      raw_workload_text,
      raw_preferences_text,
      derived_memoriesJson,
    );
    const r = row as Record<string, unknown>;
    await replaceOnboardingMemoriesFromProfile(pool, userId, {
      graduation_month: r.graduation_month as number | null | undefined,
      graduation_year: r.graduation_year as number | null | undefined,
      degrees: r.degrees as string[] | null | undefined,
      school: r.school as string | null | undefined,
      raw_goals_text: r.raw_goals_text as string | null | undefined,
      raw_workload_text: r.raw_workload_text as string | null | undefined,
      raw_preferences_text: r.raw_preferences_text as string | null | undefined,
      derived_memories: r.derived_memories,
    });
    res.json(dbRowToClientProfile(row));
  } catch (err) {
    console.error("upsertProfile error:", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
}

export async function handleListMemories(req: Request, res: Response) {
  const dbUserId = toDatabaseUserId(req.user!.id);

  try {
    const { rows } = await pool.query(
      `SELECT id, memory_text, memory_type, source, confidence, created_at
       FROM user_memories
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [dbUserId],
    );
    const memories: MemoryItem[] = rows.map((r) =>
      memoryRowToItem(
        r as {
          id: string;
          memory_text: string;
          memory_type: string;
          source: string;
          confidence: string | number;
          created_at: Date | string;
        },
      ),
    );
    res.json({ memories });
  } catch (err) {
    console.error("listMemories error:", err);
    res.status(500).json({ error: "Failed to fetch memories" });
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Permanently deletes the authenticated user row (`users.id`). PostgreSQL CASCADE removes
 * profiles, schedules, chat state/messages, memories, etc. Also removes `session` rows
 * for this user (connect-pg-simple does not FK to `users`).
 */
export async function handleDeleteUser(req: Request, res: Response) {
  const parsed = deleteUserBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid body: send JSON { "confirm": true } to delete your account.',
    });
    return;
  }

  const appUserId = req.user!.id;
  const dbUserId = toDatabaseUserId(appUserId);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM session
       WHERE sess->>'userId' = $1 OR sess->>'userId' = $2`,
      [dbUserId, appUserId],
    );
    const del = await client.query<{ id: string }>(
      `DELETE FROM users WHERE id = $1 RETURNING id`,
      [dbUserId],
    );
    if (del.rowCount === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "User not found" });
      return;
    }
    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    console.error("deleteUser error:", err);
    res.status(500).json({ error: "Failed to delete account" });
    return;
  } finally {
    client.release();
  }

  req.session.destroy((destroyErr) => {
    if (destroyErr) {
      console.error("session destroy after account delete:", destroyErr);
    }
    res.status(204).send();
  });
}

export async function handleDeleteMemory(req: Request, res: Response) {
  const dbUserId = toDatabaseUserId(req.user!.id);
  const id = req.params.id;

  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid memory id" });
    return;
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, source FROM user_memories WHERE id = $1 AND user_id = $2`,
      [id, dbUserId],
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "Memory not found" });
      return;
    }
    const source = rows[0].source as string;
    if (source === "onboarding") {
      res.status(409).json({ message: "Edit profile preferences to change this memory." });
      return;
    }
    await pool.query(
      `DELETE FROM user_memories WHERE id = $1 AND user_id = $2 AND source IN ('chat','manual','course_history')`,
      [id, dbUserId],
    );
    res.status(204).send();
  } catch (err) {
    console.error("deleteMemory error:", err);
    res.status(500).json({ error: "Failed to delete memory" });
  }
}

export async function handleClearConversationMemories(req: Request, res: Response) {
  const dbUserId = toDatabaseUserId(req.user!.id);
  try {
    const result = await pool.query(
      `DELETE FROM user_memories WHERE user_id = $1 AND source IN ('chat', 'manual')`,
      [dbUserId],
    );
    res.json({ deleted: result.rowCount ?? 0 });
  } catch (err) {
    console.error("clearConversationMemories error:", err);
    res.status(500).json({ error: "Failed to clear conversation memories" });
  }
}

export async function handleAddManualMemory(req: Request, res: Response) {
  const dbUserId = toDatabaseUserId(req.user!.id);
  const parsed = addManualMemorySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body: text (1–2000 chars) and optional memoryType." });
    return;
  }
  const { text, memoryType } = parsed.data;

  try {
    const inserted = await pool.query<{
      id: string;
      memory_text: string;
      memory_type: string;
      source: string;
      confidence: string | number;
      created_at: Date | string;
    }>(
      `INSERT INTO user_memories (user_id, memory_text, memory_type, source, confidence)
       VALUES ($1, $2, $3, 'manual', 1.00)
       RETURNING id, memory_text, memory_type, source, confidence, created_at`,
      [dbUserId, text, memoryType],
    );
    const row = inserted.rows[0];
    if (!row) {
      res.status(500).json({ error: "Failed to add memory" });
      return;
    }
    res.status(201).json(memoryRowToItem(row));
  } catch (err) {
    console.error("addManualMemory error:", err);
    res.status(500).json({ error: "Failed to add memory" });
  }
}

export async function handleAddCourseHistoryMemory(req: Request, res: Response) {
  const dbUserId = toDatabaseUserId(req.user!.id);
  const parsed = upsertCourseHistoryMemorySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "courseCode is required" });
    return;
  }
  const normalizedCourseCode = parsed.data.courseCode.trim().toUpperCase();

  try {
    const existing = await pool.query<{ id: string }>(
      `SELECT id
       FROM user_memories
       WHERE user_id = $1
         AND memory_type = 'course_history'
         AND memory_text = $2
       LIMIT 1`,
      [dbUserId, normalizedCourseCode],
    );

    if (existing.rowCount && existing.rows[0]) {
      res.status(200).json({ id: existing.rows[0].id, courseCode: normalizedCourseCode });
      return;
    }

    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO user_memories (user_id, memory_text, memory_type, source, confidence)
       VALUES ($1, $2, 'course_history', 'course_history', 1.00)
       RETURNING id`,
      [dbUserId, normalizedCourseCode],
    );
    res.status(201).json({ id: inserted.rows[0].id, courseCode: normalizedCourseCode });
  } catch (err) {
    console.error("addCourseHistoryMemory error:", err);
    res.status(500).json({ error: "Failed to add course history memory" });
  }
}

router.post("/", handleUpsertUser);
router.delete("/", requireAuth, handleDeleteUser);
router.get("/profile", requireAuth, handleGetProfile);
router.put("/profile", requireAuth, handleUpsertProfile);
router.get("/memories", requireAuth, handleListMemories);
router.post("/memories/clear-conversations", requireAuth, handleClearConversationMemories);
router.post("/memories/manual", requireAuth, handleAddManualMemory);
router.post("/memories/course-history", requireAuth, handleAddCourseHistoryMemory);
router.delete("/memories/:id", requireAuth, handleDeleteMemory);

export default router;
