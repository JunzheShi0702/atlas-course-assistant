/**
 * searchCourseDescriptions tool — Issue #34
 *
 * Semantic search over the course_embeddings vector index.
 * Embeds the user query with text-embedding-3-small, computes cosine
 * similarity against stored embeddings, and returns top-k ranked results.
 * matchExplanation is filled by the main agent (unless clearlyMatches, then omit).
 * clearlyMatches is computed here deterministically from query vs title/code.
 */

import { pool } from "../db";
import { generateEmbedding } from "../services/embeddings";
import {
  SearchCourseDescriptionsInput,
  SearchCourseDescriptionsOutput,
  SearchResult,
} from "../types/search";

/** Cosine similarity (1 − distance); results below this are dropped as too weak. */
const MIN_RELEVANCE_SCORE = 0.3;

export async function searchCourseDescriptions(
  input: SearchCourseDescriptionsInput,
): Promise<SearchCourseDescriptionsOutput> {
  const { query, limit = 5 } = input;

  if (!query.trim()) {
    return { results: [] };
  }

  const queryEmbedding = await generateEmbedding(query);

  const { rows } = await pool.query<{
    course_id: string;
    code: string;
    sis_offering_name: string;
    term: string;
    title: string;
    short_description: string;
    similarity: number;
  }>(
    `SELECT
       course_id,
       code,
       sis_offering_name,
       term,
       title,
       short_description,
       1 - (embedding <=> $1::vector) AS similarity
     FROM course_embeddings
     WHERE (1 - (embedding <=> $1::vector)) >= $3
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [JSON.stringify(queryEmbedding), limit, MIN_RELEVANCE_SCORE],
  );

  const normalizedQuery = query.trim().toLowerCase();

  const results: SearchResult[] = rows.map((row, i) => {
    const relevanceScore = Math.round(row.similarity * 1000) / 1000;
    const clearlyMatches =
      row.title.toLowerCase().includes(normalizedQuery) ||
      normalizedQuery.includes(row.title.toLowerCase()) ||
      normalizedQuery.includes(row.code.toLowerCase());

    return {
      courseId: row.course_id,
      sisOfferingName: row.sis_offering_name,
      code: row.code,
      title: row.title,
      description: row.short_description,
      term: row.term,
      rank: i + 1,
      relevanceScore,
      clearlyMatches,
    };
  });

  return { results };
}
