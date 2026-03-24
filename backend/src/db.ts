import { Pool } from "pg";
import dotenv from "dotenv";
import type { CourseEvalSummaryResult } from "./types/eval-summary";

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

// Course summary cache functions
export async function getCachedCourseSummary(
  courseCode: string
): Promise<CourseEvalSummaryResult | null> {
  const result = await pool.query(
    'SELECT summary FROM course_summaries WHERE course_code = $1',
    [courseCode]
  );
  return result.rows[0]?.summary || null;
}

export async function cacheCourseSummary(
  courseCode: string,
  latestTerm: string,
  summary: CourseEvalSummaryResult
): Promise<void> {
  await pool.query(
    'INSERT INTO course_summaries (course_code, latest_term, summary) VALUES ($1, $2, $3) ON CONFLICT (course_code) DO UPDATE SET latest_term = EXCLUDED.latest_term, summary = EXCLUDED.summary, updated_at = NOW()',
    [courseCode, latestTerm, JSON.stringify(summary)]
  );
}
