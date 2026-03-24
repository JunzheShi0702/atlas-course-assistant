/**
 * User & profile endpoints
 *
 * POST /api/users                    — upsert a user on login (email + google_sub)
 * GET  /api/users/:id/profile        — fetch the user's profile
 * PUT  /api/users/:id/profile        — create or update the user's profile
 */

import { Router, Request, Response } from "express";
import { pool } from "../db";

const router = Router();

// Inserts a new user or updates their email if the google_sub already exists.
export async function handleUpsertUser(req: Request, res: Response) {
  const { email, google_sub } = req.body as { email?: string; google_sub?: string };

  if (!email || !google_sub) {
    res.status(400).json({ error: "email and google_sub are required" });
    return;
  }

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

// Returns the user_profiles row for the given user id, or 404 if none exists.
export async function handleGetProfile(req: Request, res: Response) {
  const { id } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT * FROM user_profiles WHERE user_id = $1`,
      [id],
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("getProfile error:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
}

// Creates or updates the profile for a user. Only non-null fields overwrite existing values.
export async function handleUpsertProfile(req: Request, res: Response) {
  const { id } = req.params;
  const { graduation_month, graduation_year, degrees, school, raw_text, derived_memories } =
    req.body as {
      graduation_month?: number | null;
      graduation_year?: number | null;
      degrees?: string[] | null;
      school?: string | null;
      raw_text?: string | null;
      derived_memories?: unknown[];
    };

  try {
    const { rows } = await pool.query(
      `INSERT INTO user_profiles (user_id, graduation_month, graduation_year, degrees, school, raw_text, derived_memories)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id)
         DO UPDATE SET
           graduation_month = COALESCE($2, user_profiles.graduation_month),
           graduation_year  = COALESCE($3, user_profiles.graduation_year),
           degrees          = COALESCE($4, user_profiles.degrees),
           school           = COALESCE($5, user_profiles.school),
           raw_text         = COALESCE($6, user_profiles.raw_text),
           derived_memories = COALESCE($7, user_profiles.derived_memories),
           updated_at       = now()
       RETURNING *`,
      [
        id,
        graduation_month ?? null,
        graduation_year ?? null,
        degrees ?? null,
        school ?? null,
        raw_text ?? null,
        derived_memories != null ? JSON.stringify(derived_memories) : null,
      ],
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("upsertProfile error:", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
}

router.post("/", handleUpsertUser);
router.get("/:id/profile", handleGetProfile);
router.put("/:id/profile", handleUpsertProfile);

export default router;
