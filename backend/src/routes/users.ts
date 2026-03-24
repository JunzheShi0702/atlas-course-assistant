/**
 * User & profile endpoints
 *
 * POST /api/users                    — upsert a user on login (email + google_sub)
 * GET  /api/users/:id/profile        — fetch the user's profile
 * PUT  /api/users/:id/profile        — create or update the user's profile
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db";

const uuidSchema = z.string().uuid();

const upsertUserSchema = z.object({
  email: z.string().email(),
  google_sub: z.string().min(1),
});

const upsertProfileSchema = z.object({
  graduation_month: z.number().int().min(1).max(12).nullable().optional(),
  graduation_year: z.number().int().min(1900).max(2100).nullable().optional(),
  degrees: z.array(z.string().min(1)).nullable().optional(),
  school: z.string().max(255).nullable().optional(),
  raw_text: z.string().max(10000).nullable().optional(),
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
  const { id } = req.params;
  if (!uuidSchema.safeParse(id).success) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

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

export async function handleUpsertProfile(req: Request, res: Response) {
  const { id } = req.params;
  if (!uuidSchema.safeParse(id).success) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  const parsed = upsertProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { graduation_month, graduation_year, degrees, school, raw_text, derived_memories } =
    parsed.data;

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
