import { Pool } from "pg";
import dotenv from "dotenv";
import type { 
  Schedule, 
  ScheduleCourse, 
  ScheduleAudit, 
  ScheduleAuditResult
} from "./types/database";

dotenv.config();

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase requires SSL; local Docker does not
  ssl:
    process.env.DATABASE_URL?.includes("supabase.co") ||
    process.env.DATABASE_URL?.includes("supabase.com")
      ? { rejectUnauthorized: false }
      : false,
});

// Schedule functions
export async function getSchedulesByUserId(userId: string): Promise<Schedule[]> {
  const result = await pool.query(
    'SELECT * FROM schedules WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return result.rows;
}

export async function getScheduleById(id: string): Promise<Schedule | null> {
  const result = await pool.query('SELECT * FROM schedules WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function createSchedule(userId: string, name: string, term: string): Promise<Schedule> {
  const result = await pool.query(
    'INSERT INTO schedules (user_id, name, term) VALUES ($1, $2, $3) RETURNING *',
    [userId, name, term]
  );
  return result.rows[0];
}

export async function verifyScheduleOwnership(scheduleId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT id FROM schedules WHERE id = $1 AND user_id = $2',
    [scheduleId, userId]
  );
  return result.rows.length > 0;
}

// Schedule course functions
export async function getScheduleCourses(scheduleId: string): Promise<ScheduleCourse[]> {
  const result = await pool.query(
    'SELECT * FROM schedule_courses WHERE schedule_id = $1',
    [scheduleId]
  );
  return result.rows;
}

export async function addCourseToSchedule(
  scheduleId: string, 
  courseCode: string, 
  sisOfferingName: string, 
  term: string
): Promise<void> {
  await pool.query(
    'INSERT INTO schedule_courses (schedule_id, course_code, sis_offering_name, term) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
    [scheduleId, courseCode, sisOfferingName, term]
  );
}

export async function removeCourseFromSchedule(
  scheduleId: string, 
  courseCode: string, 
  sisOfferingName: string, 
  term: string
): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM schedule_courses WHERE schedule_id = $1 AND course_code = $2 AND sis_offering_name = $3 AND term = $4',
    [scheduleId, courseCode, sisOfferingName, term]
  );
  return result.rowCount > 0;
}

// Schedule audit functions
export async function getLatestScheduleAudit(scheduleId: string): Promise<ScheduleAudit | null> {
  const result = await pool.query(
    'SELECT * FROM schedule_audits WHERE schedule_id = $1 ORDER BY created_at DESC LIMIT 1',
    [scheduleId]
  );
  return result.rows[0] || null;
}

export async function createScheduleAudit(
  scheduleId: string, 
  result: ScheduleAuditResult, 
  modelVersion?: string
): Promise<ScheduleAudit> {
  const query = await pool.query(
    'INSERT INTO schedule_audits (schedule_id, result, model_version) VALUES ($1, $2, $3) RETURNING *',
    [scheduleId, JSON.stringify(result), modelVersion || null]
  );
  return query.rows[0];
}
