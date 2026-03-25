/**
 * exactSearchCourses — Issue #52 / agent orchestration
 *
 * Keyword-based lookup against the local course_embeddings table.
 * Used when the user supplies a specific course code or short title phrase.
 *
 * Priority order:
 *  1. Exact code match  (e.g. "EN.601.226")
 *  2. Partial code/title ILIKE  (e.g. "601" or "data structures")
 *  3. Fall back to semantic search if nothing found
 */

import { pool } from "../db";
import { searchCourseDescriptions } from "./search-course-descriptions";
import type { SearchCourseDescriptionsOutput } from "../types/search";

/** Matches a full dotted course code anywhere in a string, e.g. "EN.601.226" */
const COURSE_CODE_RE = /\b([A-Z]{2}\.\d{3}\.\d{3}(?:\.\d{2})?)\b/i;

function formatRows(
  rows: {
    course_id: string;
    code: string;
    sis_offering_name: string;
    term: string;
    title: string;
    short_description: string;
  }[],
): SearchCourseDescriptionsOutput {
  return {
    results: rows.map((r, i) => ({
      courseId: r.course_id,
      sisOfferingName: r.sis_offering_name,
      code: r.code,
      title: r.title,
      shortDescription: r.short_description,
      term: r.term,
      rank: i + 1,
      relevanceScore: 1.0,
    })),
  };
}

export async function exactSearchCourses(input: {
  query: string;
  limit?: number;
}): Promise<SearchCourseDescriptionsOutput> {
  const { query, limit = 5 } = input;
  const q = query.trim();
  if (!q) return { results: [] };

  // 1. Pure course code query (e.g. "EN.601.226") — exact SQL match only,
  //    no fallback. Caller is responsible for handling not-found.
  const codeMatch = q.match(COURSE_CODE_RE);
  if (codeMatch) {
    const code = codeMatch[1].toUpperCase();
    const { rows } = await pool.query<{
      course_id: string;
      code: string;
      sis_offering_name: string;
      term: string;
      title: string;
      short_description: string;
    }>(
      `SELECT course_id, code, sis_offering_name, term, title, short_description
       FROM course_embeddings
       WHERE code = $1
       LIMIT $2`,
      [code, limit],
    );
    return formatRows(rows); // empty if not found — caller handles
  }

  // 2. Partial keyword match on code or title (e.g. "601" or "data structures")
  const { rows: kwRows } = await pool.query<{
    course_id: string;
    code: string;
    sis_offering_name: string;
    term: string;
    title: string;
    short_description: string;
  }>(
    `SELECT course_id, code, sis_offering_name, term, title, short_description
     FROM course_embeddings
     WHERE code ILIKE $1 OR title ILIKE $1
     ORDER BY
       CASE WHEN code ILIKE $2 THEN 0 ELSE 1 END,
       title
     LIMIT $3`,
    [`%${q}%`, `${q}%`, limit],
  );
  if (kwRows.length > 0) return formatRows(kwRows);

  // 3. Nothing found by keyword — fall back to semantic search
  return searchCourseDescriptions({ query: q, limit });
}
