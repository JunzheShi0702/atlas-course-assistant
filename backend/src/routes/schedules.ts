/**
 * Schedules routes — Issue #116
 *
 * All routes require authentication (req.user set by OAuth or dev stub).
 * Ownership checks return 403; missing resources return 404.
 * schedule_courses and schedule_audits cascade-delete with the parent schedule
 * (ON DELETE CASCADE defined in database/init.sql).
 *
 * Routes:
 *   GET    /api/schedules            List schedules for current user
 *   POST   /api/schedules            Create a schedule
 *   GET    /api/schedules/:id        Get schedule + courses + latestAudit
 *   DELETE /api/schedules/:id        Delete schedule (cascades dependents)
 *   POST   /api/schedules/:id/courses    Add course to schedule
 *   DELETE /api/schedules/:id/courses   Remove course from schedule
 */

import { Router, Request, Response } from "express";
import { pool } from "../db";
import { requireAuth } from "../middleware/auth";
import {
  createScheduleRequestSchema,
  addCourseToScheduleRequestSchema,
  removeCourseFromScheduleRequestSchema,
} from "../types/database";

const router = Router();

// ── GET /api/schedules ────────────────────────────────────────────────────────

router.get("/", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { rows } = await pool.query<{
    id: string;
    name: string;
    term: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, name, term, created_at, updated_at
     FROM schedules
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );
  res.json({
    schedules: rows.map((r) => ({
      id: r.id,
      name: r.name,
      term: r.term,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  });
});

// ── POST /api/schedules ───────────────────────────────────────────────────────

router.post("/", requireAuth, async (req: Request, res: Response) => {
  const parsed = createScheduleRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "name and term are required" });
    return;
  }
  const { name, term } = parsed.data;
  const userId = req.user!.id;

  const { rows } = await pool.query<{
    id: string;
    name: string;
    term: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `INSERT INTO schedules (user_id, name, term)
     VALUES ($1, $2, $3)
     RETURNING id, name, term, created_at, updated_at`,
    [userId, name, term],
  );
  const r = rows[0];
  res.status(201).json({
    id: r.id,
    name: r.name,
    term: r.term,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
});

// ── GET /api/schedules/:id ────────────────────────────────────────────────────

router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const { rows: schedRows } = await pool.query<{
    id: string;
    name: string;
    term: string;
    user_id: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, name, term, user_id, created_at, updated_at FROM schedules WHERE id = $1`,
    [id],
  );

  if (schedRows.length === 0) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }
  const sched = schedRows[0];
  if (sched.user_id !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { rows: courseRows } = await pool.query<{
    course_code: string;
    sis_offering_name: string;
    term: string;
  }>(
    `SELECT course_code, sis_offering_name, term
     FROM schedule_courses
     WHERE schedule_id = $1`,
    [id],
  );

  const { rows: auditRows } = await pool.query<{
    id: string;
    created_at: Date;
    result: unknown;
  }>(
    `SELECT id, created_at, result
     FROM schedule_audits
     WHERE schedule_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [id],
  );

  res.json({
    id: sched.id,
    name: sched.name,
    term: sched.term,
    createdAt: sched.created_at,
    updatedAt: sched.updated_at,
    courses: courseRows.map((c) => ({
      courseCode: c.course_code,
      sisOfferingName: c.sis_offering_name,
      term: c.term,
    })),
    latestAudit: auditRows.length > 0
      ? { id: auditRows[0].id, createdAt: auditRows[0].created_at, result: auditRows[0].result }
      : null,
  });
});

// ── DELETE /api/schedules/:id ─────────────────────────────────────────────────

router.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM schedules WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }
  if (rows[0].user_id !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // ON DELETE CASCADE handles schedule_courses and schedule_audits
  await pool.query(`DELETE FROM schedules WHERE id = $1`, [id]);
  res.status(204).send();
});

// ── POST /api/schedules/:id/courses ──────────────────────────────────────────

router.post("/:id/courses", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM schedules WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }
  if (rows[0].user_id !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const parsed = addCourseToScheduleRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "courseCode, sisOfferingName, and term are required" });
    return;
  }
  const { courseCode, sisOfferingName, term } = parsed.data;

  await pool.query(
    `INSERT INTO schedule_courses (schedule_id, course_code, sis_offering_name, term)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [id, courseCode, sisOfferingName, term],
  );
  res.status(201).json({ ok: true });
});

// ── DELETE /api/schedules/:id/courses ────────────────────────────────────────

router.delete("/:id/courses", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM schedules WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }
  if (rows[0].user_id !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const parsed = removeCourseFromScheduleRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "courseCode, sisOfferingName, and term are required" });
    return;
  }
  const { courseCode, sisOfferingName, term } = parsed.data;

  await pool.query(
    `DELETE FROM schedule_courses
     WHERE schedule_id = $1 AND course_code = $2 AND sis_offering_name = $3 AND term = $4`,
    [id, courseCode, sisOfferingName, term],
  );
  res.status(204).send();
});

export default router;
