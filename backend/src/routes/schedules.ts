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
 *   GET    /api/schedules/:id/chat      Get chat history (rollingSummary + messages)
 *   POST   /api/schedules/:id/audit     Run workload audit; persist to schedule_audits
 */

import { Router, Request, Response } from "express";
import { pool } from "../db";
import { requireAuth } from "../middleware/auth";
import {
  createScheduleRequestSchema,
  addCourseToScheduleRequestSchema,
  removeCourseFromScheduleRequestSchema,
} from "../types/database";
import { loadScheduleContextForAgent } from "../services/schedule-context";
import { buildAuditRecommendationCandidates } from "../services/audit-recommendations";
import { runAuditWithQualityGate } from "../services/audit-quality-gate";
import { runParallelAuditWorkflow } from "../services/parallel-audit-workflow";
import { EvalRow, weightedAvgOrNull } from "../tools/get-course-eval-summary";
import { AuditEvalMetrics } from "../types/eval-summary";

const router = Router();

function buildAuditEvalMetrics(rows: EvalRow[]): AuditEvalMetrics | null {
  if (rows.length === 0) return null;

  const metrics: AuditEvalMetrics = {
    overallQuality: weightedAvgOrNull(rows, "overall_quality"),
    teachingEffectiveness: weightedAvgOrNull(rows, "teaching_effectiveness"),
    difficulty: weightedAvgOrNull(rows, "intellectual_challange"),
    workload: weightedAvgOrNull(rows, "work_load"),
    feedbackQuality: weightedAvgOrNull(rows, "feedback_quality"),
    sampleSize: rows.reduce((sum, row) => sum + Math.max(row.num_respondents ?? 0, 0), 0),
    sectionCount: rows.length,
  };

  const hasAnyMetric = [
    metrics.overallQuality,
    metrics.teachingEffectiveness,
    metrics.difficulty,
    metrics.workload,
    metrics.feedbackQuality,
  ].some((value) => value !== null);

  return hasAnyMetric ? metrics : null;
}

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
    title: string;
  }>(
    `SELECT course_code, sis_offering_name, term, title
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
      courseTitle: c.title ?? "",
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
  const { courseCode, sisOfferingName, term, courseTitle, credits } = parsed.data;

  await pool.query(
    `INSERT INTO schedule_courses (schedule_id, course_code, sis_offering_name, term, title, credits)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING`,
    [id, courseCode, sisOfferingName, term, courseTitle.trim(), credits ?? null],
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

// ── GET /api/schedules/:id/chat ──────────────────────────────────────────────
// Returns the rolling summary and stored messages for a schedule's chat thread.
// Ownership is enforced: the schedule must belong to req.user.id.
// Returns { rollingSummary: "", messages: [] } when no conversation exists yet.

router.get("/:id/chat", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const { rows: schedRows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM schedules WHERE id = $1`,
    [id],
  );
  if (schedRows.length === 0) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }
  if (schedRows[0].user_id !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Fetch chat state for this schedule (may not exist yet)
  const { rows: stateRows } = await pool.query<{
    id: string;
    rolling_summary: string;
  }>(
    `SELECT id, rolling_summary FROM schedule_chat_state WHERE schedule_id = $1`,
    [id],
  );

  if (stateRows.length === 0) {
    res.json({ rollingSummary: "", messages: [] });
    return;
  }

  const chatStateId = stateRows[0].id;
  const rollingSummary = stateRows[0].rolling_summary;

  // Fetch messages in chronological order. The retention policy caps raw
  // message count at 100, so LIMIT 100 retrieves everything stored.
  const { rows: msgRows } = await pool.query<{
    id: string;
    role: string;
    content: string;
    response_type: string | null;
    metadata: unknown;
    created_at: Date;
  }>(
    `SELECT id, role, content, response_type, metadata, created_at
     FROM schedule_chat_messages
     WHERE chat_state_id = $1
     ORDER BY created_at ASC
     LIMIT 100`,
    [chatStateId],
  );

  res.json({
    rollingSummary,
    messages: msgRows.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      responseType: m.response_type,
      metadata: m.metadata,
      createdAt: m.created_at,
    })),
  });
});

// ── POST /api/schedules/:id/audit ─────────────────────────────────────────────

router.post("/:id/audit", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  try {
    const ctxResult = await loadScheduleContextForAgent(userId, id);
    if (!ctxResult.ok) {
      res.status(ctxResult.error === "not_found" ? 404 : 403).json({ error: ctxResult.error });
      return;
    }
    const context = ctxResult.context;

    // Fetch eval metrics for each course
    const evalEntries = await Promise.all(
      context.courses.map(async (course) => {
        const { rows } = await pool.query<EvalRow>(
          `SELECT overall_quality, intellectual_challange, work_load, num_respondents,
                  semester, instructor, teaching_effectiveness, feedback_quality
           FROM course_evaluations WHERE course_code = $1`,
          [course.courseCode],
        );
        return [course.courseCode, buildAuditEvalMetrics(rows)] as const;
      }),
    );
    const evalsByCourse: Record<string, AuditEvalMetrics | null> = Object.fromEntries(evalEntries);

    const missingEvaluationData = Object.entries(evalsByCourse)
      .filter(([, metrics]) => metrics === null)
      .map(([code]) => code);

    const recommendationCandidates = await buildAuditRecommendationCandidates({
      courses: context.courses,
      scheduleTerm: context.scheduleTerm,
      evalsByCourse,
    });

    const uncachedRecommendationCodes = recommendationCandidates
      .map((candidate) => candidate.courseCode)
      .filter((courseCode, index, values) => values.indexOf(courseCode) === index)
      .filter((courseCode) => evalsByCourse[courseCode] === undefined);

    const recommendationEvalEntries = await Promise.all(
      uncachedRecommendationCodes.map(async (courseCode) => {
        const { rows } = await pool.query<EvalRow>(
          `SELECT overall_quality, intellectual_challange, work_load, num_respondents,
                  semester, instructor, teaching_effectiveness, feedback_quality
           FROM course_evaluations WHERE course_code = $1`,
          [courseCode],
        );
        return [courseCode, buildAuditEvalMetrics(rows)] as const;
      }),
    );

    for (const [courseCode, metrics] of recommendationEvalEntries) {
      evalsByCourse[courseCode] = metrics;
    }

    for (const candidate of recommendationCandidates) {
      const metrics = evalsByCourse[candidate.courseCode];
      candidate.overallQuality = metrics?.overallQuality ?? null;
      candidate.workload = metrics?.workload ?? null;
      candidate.difficulty = metrics?.difficulty ?? null;
      candidate.respondentCount = metrics?.sampleSize ?? 0;
    }

    const workflowResult = await runParallelAuditWorkflow({
        context,
        evalsByCourse,
        recommendationCandidates,
      });

    const { result } = await runAuditWithQualityGate({
      context,
      evalsByCourse,
      recommendationCandidates,
      findings: workflowResult.findings,
      incompleteChecks: workflowResult.incompleteChecks,
      missingEvaluationData,
    });

    await pool.query(
      `INSERT INTO schedule_audits (schedule_id, result, model_version)
       VALUES ($1, $2::jsonb, 'gpt-4o-mini')`,
      [id, JSON.stringify(result)],
    );

    res.json({ result });
  } catch (err) {
    console.error("[audit] route failed:", err);
    res.status(500).json({ error: "The server could not complete the workload audit" });
  }
});

export default router;
