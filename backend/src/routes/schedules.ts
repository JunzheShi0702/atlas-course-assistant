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
 *   GET    /api/schedules/:id/events Weekly calendar events DTO for schedule
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
  type WeeklyCalendarEvent,
  weeklyCalendarEventsResponseSchema,
  createScheduleRequestSchema,
  addCourseToScheduleRequestSchema,
  removeCourseFromScheduleRequestSchema,
  createCustomScheduleEventRequestSchema,
  updateCustomScheduleEventRequestSchema,
} from "../types/database";
import { runAuditWithQualityGate } from "../services/audit-quality-gate";
import { fetchSisCourseDetails } from "../services/sis-client";
import {
  decodeDaysOfWeek,
  normalizeOptionalText,
  parseMeetingTimesTo24Hour,
  scheduleCourseToCourseId,
  sortWeeklyEvents,
} from "../services/weekly-events-contract";
import {
  type LoadScheduleContextError,
  loadScheduleContextForAgent,
} from "../services/schedule-context";
import { runParallelAuditWorkflow } from "../services/parallel-audit-workflow";
import { EvalRow, weightedAvgOrNull } from "../tools/get-course-eval-summary";
import { AuditEvalMetrics } from "../types/eval-summary";
import {
  enforceAiRateLimit,
  enforceDailySpendCap,
  enforcePromptInjectionPolicy,
} from "../services/ai-safeguards";
import { writeAiCallLog } from "../services/ai-observability";
import { toDatabaseUserId } from "../middleware/auth";

const router = Router();

function isValidTimeRange(startTime: string, endTime: string): boolean {
  return startTime < endTime;
}

function hasPartialTimeRange(startTime: string | null | undefined, endTime: string | null | undefined): boolean {
  return (startTime == null) !== (endTime == null);
}

async function loadOwnedScheduleUserId(
  scheduleId: string,
): Promise<{ found: false } | { found: true; userId: string }> {
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM schedules WHERE id = $1`,
    [scheduleId],
  );
  if (rows.length === 0) return { found: false };
  return { found: true, userId: rows[0].user_id };
}

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

type ScheduleCourseRow = {
  course_code: string;
  sis_offering_name: string;
  term: string;
  title: string;
  credits: string | null;
};

function scheduleRowNeedsCreditsHydration(creditsRaw: string | null): boolean {
  if (creditsRaw == null || String(creditsRaw).trim() === "") return true;
  const n = Number.parseFloat(String(creditsRaw));
  return !Number.isFinite(n);
}

async function hydrateCreditsFromCourseEmbeddings(courseRows: ScheduleCourseRow[]): Promise<void> {
  const needing = courseRows.filter((row) => scheduleRowNeedsCreditsHydration(row.credits));
  if (needing.length === 0) return;
  const offeringSet = [...new Set(needing.map((n) => n.sis_offering_name.trim()))];
  const { rows: embRows } = await pool.query<{
    sis_offering_name: string;
    term: string;
    credits: string | null;
  }>(
    `SELECT sis_offering_name, term::text AS term, credits::text AS credits
     FROM course_embeddings
     WHERE sis_offering_name = ANY($1::text[])`,
    [offeringSet],
  );

  const byPair = new Map<string, string>();
  for (const row of embRows) {
    if (row.credits == null || String(row.credits).trim() === "") continue;
    const key = `${row.sis_offering_name.trim()}|${String(row.term).trim()}`;
    if (!byPair.has(key)) byPair.set(key, String(row.credits).trim());
  }

  for (const row of needing) {
    const key = `${row.sis_offering_name.trim()}|${row.term.trim()}`;
    const hydrated = byPair.get(key);
    if (hydrated !== undefined) {
      row.credits = hydrated;
    }
  }
}

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

  const { rows: courseRows } = await pool.query<ScheduleCourseRow>(
    `SELECT course_code, sis_offering_name, term, title, credits
     FROM schedule_courses
     WHERE schedule_id = $1`,
    [id],
  );

  await hydrateCreditsFromCourseEmbeddings(courseRows);

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
    courses: courseRows.map((c) => {
      const creditsRaw = c.credits;
      const creditsNum =
        creditsRaw != null && creditsRaw !== ""
          ? Number.parseFloat(String(creditsRaw))
          : NaN;
      return {
        courseCode: c.course_code,
        sisOfferingName: c.sis_offering_name,
        term: c.term,
        courseTitle: c.title ?? "",
        ...(Number.isFinite(creditsNum) ? { credits: creditsNum } : {}),
      };
    }),
    latestAudit: auditRows.length > 0
      ? { id: auditRows[0].id, createdAt: auditRows[0].created_at, result: auditRows[0].result }
      : null,
  });
});

// ── GET /api/schedules/:id/events ────────────────────────────────────────────
// Returns a stable weekly-event DTO to support calendar rendering.
// Missing values are normalized to null; empty schedules return { events: [] }.

router.get("/:id/events", requireAuth, async (req: Request, res: Response) => {
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

  const { rows: courseRows } = await pool.query<{
    course_code: string;
    sis_offering_name: string;
    term: string;
    title: string | null;
  }>(
    `SELECT course_code, sis_offering_name, term, title
     FROM schedule_courses
     WHERE schedule_id = $1`,
    [id],
  );
  const { rows: customEventRows } = await pool.query<{
    id: string;
    title: string;
    day_of_week: WeeklyCalendarEvent["dayOfWeek"];
    start_time: string | null;
    end_time: string | null;
    location: string | null;
  }>(
    `SELECT id, title, day_of_week, start_time, end_time, location
     FROM schedule_custom_events
     WHERE schedule_id = $1`,
    [id],
  );

  const events: WeeklyCalendarEvent[] = [];

  for (const course of courseRows) {
    const courseId = scheduleCourseToCourseId(course.sis_offering_name, course.term);
    let sisDetail: Awaited<ReturnType<typeof fetchSisCourseDetails>> | null = null;
    try {
      sisDetail = await fetchSisCourseDetails(courseId);
    } catch {
      sisDetail = null;
    }

    const days = decodeDaysOfWeek(sisDetail?.DOW ?? "");
    const meetings = normalizeOptionalText(sisDetail?.Meetings);
    const { startTime, endTime } = parseMeetingTimesTo24Hour(meetings ?? "");
    if (meetings !== null && /\d/.test(meetings) && (startTime === null || endTime === null)) {
      console.warn(
        `[weekly-events] failed to parse SIS meeting time for ${courseId}: ${meetings}`,
      );
    }
    const location = normalizeOptionalText(sisDetail?.Location);
    const courseTitle =
      normalizeOptionalText(course.title)
      ?? normalizeOptionalText(sisDetail?.Title)
      ?? course.course_code;

    if (days.length === 0) {
      events.push({
        eventId: `${id}:${course.course_code}:unknown`,
        eventType: "course",
        dayOfWeek: null,
        startTime,
        endTime,
        courseCode: course.course_code,
        courseTitle,
        location,
      });
      continue;
    }

    for (const dayOfWeek of days) {
      events.push({
        eventId: `${id}:${course.course_code}:${dayOfWeek}:${startTime ?? "na"}:${endTime ?? "na"}`,
        eventType: "course",
        dayOfWeek,
        startTime,
        endTime,
        courseCode: course.course_code,
        courseTitle,
        location,
      });
    }
  }

  for (const event of customEventRows) {
    events.push({
      eventId: event.id,
      eventType: "custom",
      dayOfWeek: event.day_of_week,
      startTime: event.start_time,
      endTime: event.end_time,
      courseCode: "Custom",
      courseTitle: event.title,
      location: normalizeOptionalText(event.location),
    });
  }

  const payload = { events: sortWeeklyEvents(events) };
  const parsed = weeklyCalendarEventsResponseSchema.safeParse(payload);
  if (!parsed.success) {
    res.status(500).json({ error: "Failed to construct weekly events response" });
    return;
  }

  res.json(payload);
});

// ── POST /api/schedules/:id/custom-events ───────────────────────────────────

router.post("/:id/custom-events", requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const ownership = await loadOwnedScheduleUserId(id);
  if (!ownership.found) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }
  if (ownership.userId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const parsed = createCustomScheduleEventRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const { title, dayOfWeek, startTime, endTime, location } = parsed.data;
  if (hasPartialTimeRange(startTime, endTime)) {
    res.status(400).json({ error: "startTime and endTime must both be provided or both be TBA" });
    return;
  }
  if (startTime !== null && endTime !== null && !isValidTimeRange(startTime, endTime)) {
    res.status(400).json({ error: "endTime must be later than startTime" });
    return;
  }

  const { rows } = await pool.query<{
    id: string;
    title: string;
    day_of_week: string | null;
    start_time: string | null;
    end_time: string | null;
    location: string | null;
  }>(
    `INSERT INTO schedule_custom_events
       (schedule_id, title, day_of_week, start_time, end_time, location)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, title, day_of_week, start_time, end_time, location`,
    [id, title.trim(), dayOfWeek, startTime, endTime, location?.trim() || null],
  );

  const created = rows[0];
  res.status(201).json({
    eventId: created.id,
    eventType: "custom",
    dayOfWeek: created.day_of_week,
    startTime: created.start_time,
    endTime: created.end_time,
    courseCode: "Custom",
    courseTitle: created.title,
    location: normalizeOptionalText(created.location),
  });
});

// ── PATCH /api/schedules/:id/custom-events/:eventId ─────────────────────────

router.patch("/:id/custom-events/:eventId", requireAuth, async (req: Request, res: Response) => {
  const { id, eventId } = req.params;
  const ownership = await loadOwnedScheduleUserId(id);
  if (!ownership.found) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }
  if (ownership.userId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const parsed = updateCustomScheduleEventRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "At least one custom event field is required" });
    return;
  }

  const { rows: existingRows } = await pool.query<{
    id: string;
    title: string;
    day_of_week: string | null;
    start_time: string | null;
    end_time: string | null;
    location: string | null;
  }>(
    `SELECT id, title, day_of_week, start_time, end_time, location
     FROM schedule_custom_events
     WHERE id = $1 AND schedule_id = $2`,
    [eventId, id],
  );
  if (existingRows.length === 0) {
    res.status(404).json({ error: "Custom event not found" });
    return;
  }

  const existing = existingRows[0];
  const hasDayOverride = Object.prototype.hasOwnProperty.call(parsed.data, "dayOfWeek");
  const hasStartOverride = Object.prototype.hasOwnProperty.call(parsed.data, "startTime");
  const hasEndOverride = Object.prototype.hasOwnProperty.call(parsed.data, "endTime");
  const hasLocationOverride = Object.prototype.hasOwnProperty.call(parsed.data, "location");
  const next = {
    title: parsed.data.title?.trim() ?? existing.title,
    dayOfWeek: hasDayOverride ? parsed.data.dayOfWeek : existing.day_of_week,
    startTime: hasStartOverride ? parsed.data.startTime : existing.start_time,
    endTime: hasEndOverride ? parsed.data.endTime : existing.end_time,
    location: hasLocationOverride ? (parsed.data.location?.trim() || null) : existing.location,
  };
  if (hasPartialTimeRange(next.startTime, next.endTime)) {
    res.status(400).json({ error: "startTime and endTime must both be provided or both be TBA" });
    return;
  }
  if (
    typeof next.startTime === "string" &&
    typeof next.endTime === "string" &&
    !isValidTimeRange(next.startTime, next.endTime)
  ) {
    res.status(400).json({ error: "endTime must be later than startTime" });
    return;
  }

  const { rows } = await pool.query<{
    id: string;
    title: string;
    day_of_week: string | null;
    start_time: string | null;
    end_time: string | null;
    location: string | null;
  }>(
    `UPDATE schedule_custom_events
     SET title = $3,
         day_of_week = $4,
         start_time = $5,
         end_time = $6,
         location = $7,
         updated_at = NOW()
     WHERE id = $1 AND schedule_id = $2
     RETURNING id, title, day_of_week, start_time, end_time, location`,
    [eventId, id, next.title, next.dayOfWeek, next.startTime, next.endTime, next.location],
  );

  const updated = rows[0];
  res.json({
    eventId: updated.id,
    eventType: "custom",
    dayOfWeek: updated.day_of_week,
    startTime: updated.start_time,
    endTime: updated.end_time,
    courseCode: "Custom",
    courseTitle: updated.title,
    location: normalizeOptionalText(updated.location),
  });
});

// ── DELETE /api/schedules/:id/custom-events/:eventId ────────────────────────

router.delete("/:id/custom-events/:eventId", requireAuth, async (req: Request, res: Response) => {
  const { id, eventId } = req.params;
  const ownership = await loadOwnedScheduleUserId(id);
  if (!ownership.found) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }
  if (ownership.userId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { rowCount } = await pool.query(
    `DELETE FROM schedule_custom_events
     WHERE id = $1 AND schedule_id = $2`,
    [eventId, id],
  );
  if (!rowCount) {
    res.status(404).json({ error: "Custom event not found" });
    return;
  }
  res.status(204).send();
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
       AND (response_type IS NULL OR response_type <> 'clarification')
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
  const dbUserId = toDatabaseUserId(userId);
  const { id } = req.params;
  const routeName = "/api/schedules/:id/audit";
  const requestId = req.header("x-request-id") ?? null;

  try {
    const rateLimitResult = await enforceAiRateLimit(routeName, userId);
    if (rateLimitResult.allowed === false) {
      res.status(rateLimitResult.status).json({ error: rateLimitResult.error });
      return;
    }
    const spendCapResult = await enforceDailySpendCap(routeName, userId);
    if (spendCapResult.allowed === false) {
      res.status(spendCapResult.status).json({ error: spendCapResult.error });
      return;
    }
    const injectionResult = await enforcePromptInjectionPolicy({
      route: routeName,
      appUserId: userId,
      message: JSON.stringify(req.body ?? {}),
    });
    if (injectionResult.allowed === false) {
      res.status(injectionResult.status).json({ error: injectionResult.error });
      return;
    }

    const startedAt = Date.now();
    const ctxResult = await loadScheduleContextForAgent(userId, id);
    if (!ctxResult.ok) {
      const error: LoadScheduleContextError = ctxResult.error;
      res.status(error === "not_found" ? 404 : 403).json({ error });
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

    const workflowResult = await runParallelAuditWorkflow({
        context,
        evalsByCourse,
        recommendationCandidates: [],
      });

    const { result } = await runAuditWithQualityGate({
      context,
      evalsByCourse,
      findings: workflowResult.findings,
      incompleteChecks: workflowResult.incompleteChecks,
      missingEvaluationData,
    });

    await pool.query(
      `INSERT INTO schedule_audits (schedule_id, result, model_version)
       VALUES ($1, $2::jsonb, 'gpt-4o-mini')`,
      [id, JSON.stringify(result)],
    );

    void writeAiCallLog({
      route: routeName,
      userId: dbUserId,
      requestId,
      model: "gpt-4o-mini",
      operation: "schedule_audit",
      prompt: `Run workload audit for schedule ${id}`,
      response: JSON.stringify(result),
      latencyMs: Date.now() - startedAt,
      success: true,
      metadata: {
        courseCount: ctxResult.context.courses.length,
        missingEvaluationDataCount: missingEvaluationData.length,
      },
    }).catch((logErr) => console.error("[audit] ai observability write failed:", logErr));

    res.json({ result });
  } catch (err) {
    console.error("[audit] route failed:", err);
    res.status(500).json({ error: "The server could not complete the workload audit" });
  }
});

export default router;
