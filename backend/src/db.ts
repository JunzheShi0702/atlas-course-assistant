import type { CourseEvalSummaryResult } from "./types/eval-summary";
import { courseEvalSummaryResultSchema } from "./types/database";
import { semesterSortKey } from "./tools/get-course-eval-summary";
import { pool } from "./pool";

export { pool };

// Course summary cache functions
export async function getCachedCourseSummary(
  courseCode: string
): Promise<CourseEvalSummaryResult | null> {
  // Get cached data with latest_term for freshness check
  const cacheResult = await pool.query(
    'SELECT summary, latest_term FROM course_summaries WHERE course_code = $1',
    [courseCode]
  );
  
  const cached = cacheResult.rows[0];
  if (!cached) {
    return null;
  }

  // Check for newer evaluation data (freshness check)
  const freshResult = await pool.query(
    'SELECT DISTINCT semester FROM course_evaluations WHERE course_code = $1',
    [courseCode]
  );
  
  if (freshResult.rows.length > 0) {
    // Sort semesters chronologically using semesterSortKey, get latest
    const sortedSemesters = freshResult.rows
      .map(row => row.semester)
      .sort((a, b) => semesterSortKey(b).localeCompare(semesterSortKey(a))); // DESC order
    
    const currentLatest = sortedSemesters[0];
    if (currentLatest !== cached.latest_term) {
      // Newer data available - invalidate cache
      console.log(`Cache miss for ${courseCode}: cached term ${cached.latest_term}, current latest ${currentLatest}`);
      return null;
    }
  }

  // Validate cached JSON before returning
  const validation = courseEvalSummaryResultSchema.safeParse(cached.summary);
  if (!validation.success) {
    console.warn(`Invalid cached summary for ${courseCode}:`, validation.error.flatten());
    return null;
  }

  return validation.data;
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
