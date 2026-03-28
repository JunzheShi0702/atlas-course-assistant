/**
 * User & profile endpoints
 *
 * POST /api/user         — upsert a user on login (email + google_sub)
 * GET  /api/user/profile — fetch the authenticated user's profile (camelCase JSON)
 * PUT  /api/user/profile — create or update profile (camelCase body from onboarding; camelCase response)
 */

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { pool } from "../db";

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

function parseFrontendGraduationMonth(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const n = parseInt(raw, 10);
  if (!Number.isNaN(n) && n >= 1 && n <= 12) return n;
  const key = raw.trim().toLowerCase();
  return MONTH_NAME_TO_NUM[key] ?? null;
}

function parseFrontendGraduationYear(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const m = raw.match(/^(\d{4})/);
  if (m) return parseInt(m[1], 10);
  return null;
}

function degreesStringToArray(s: string | undefined): string[] | null {
  if (s === undefined) return null;
  const t = s.trim();
  if (!t) return [];
  return t.split(";").map((x) => x.trim()).filter(Boolean);
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

/** PUT body: camelCase from buildUserProfilePayload / useApi; optional derived_memories for future AI. */
const upsertProfileSchema = z.object({
  graduationMonth: z.string().max(32).optional(),
  graduationYear: z.string().max(32).optional(),
  degrees: z.string().max(10000).optional(),
  school: z.string().max(255).optional(),
  goalsText: z.string().max(10000).optional(),
  workloadText: z.string().max(10000).optional(),
  preferencesText: z.string().max(10000).optional(),
  derived_memories: z.array(z.unknown()).optional(),
});

const router = Router();

export async function handleUpsertUser(req: Request, res: Response) {
  const parsed = upsertUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { email, google_sub } = parsed.data;

  try {
    const { rows } = await pool.query(
      `INSERT INTO users (email, google_sub)
       VALUES ($1, $2)
       ON CONFLICT (google_sub)
         DO UPDATE SET email = EXCLUDED.email, updated_at = now()
       RETURNING *`,
      [email, google_sub],
    );
    res.json(rows[0]);
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
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const b = parsed.data;
  const graduation_month = parseFrontendGraduationMonth(b.graduationMonth);
  const graduation_year = parseFrontendGraduationYear(b.graduationYear);
  const degrees = degreesStringToArray(b.degrees);
  const school = b.school !== undefined ? b.school || null : null;
  const raw_goals_text = b.goalsText !== undefined ? b.goalsText ?? null : null;
  const raw_workload_text =
    b.workloadText !== undefined ? b.workloadText ?? null : null;
  const raw_preferences_text =
    b.preferencesText !== undefined ? b.preferencesText ?? null : null;
  const derived_memoriesJson =
    b.derived_memories != null
      ? JSON.stringify(b.derived_memories)
      : null;

  try {
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
    res.json(dbRowToClientProfile(row));
  } catch (err) {
    console.error("upsertProfile error:", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
}

router.post("/", handleUpsertUser);
router.get("/profile", requireAuth, handleGetProfile);
router.put("/profile", requireAuth, handleUpsertProfile);

export default router;
