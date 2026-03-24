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
  courseCode: string, 
  term: string
): Promise<CourseEvalSummaryResult | null> {
  const result = await pool.query(
    'SELECT * FROM course_summaries WHERE course_code = $1 AND term = $2',
    [courseCode, term]
  );
  return result.rows[0]?.summary || null;
}

export async function cacheCourseSummary(
  courseCode: string, 
  term: string, 
  summary: CourseEvalSummaryResult
): Promise<void> {
  await pool.query(
    'INSERT INTO course_summaries (course_code, term, summary) VALUES ($1, $2, $3) ON CONFLICT (course_code, term) DO UPDATE SET summary = EXCLUDED.summary, updated_at = NOW()',
    [courseCode, term, JSON.stringify(summary)]
  );
}
