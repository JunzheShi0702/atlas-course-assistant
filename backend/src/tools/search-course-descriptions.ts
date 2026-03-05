/**
 * searchCourseDescriptions LLM tool — Issue #34
 *
 * Performs semantic search over the course_embeddings vector index.
 * Embeds the user query with text-embedding-3-small, computes cosine
 * similarity against stored embeddings, and returns top-k ranked results.
 */

import { pool } from "../db";
import { generateEmbedding } from "../services/embeddings";
import {
  SearchCourseDescriptionsInput,
  SearchCourseDescriptionsOutput,
  SearchResult,
} from "../types/search";

export async function searchCourseDescriptions(
  input: SearchCourseDescriptionsInput,
): Promise<SearchCourseDescriptionsOutput> {
  const { query, limit = 5 } = input;

  if (!query.trim()) {
    return { results: [] };
  }

  // Embed query using same model as the index (text-embedding-3-small)
  const queryEmbedding = await generateEmbedding(query);

  // Cosine similarity: 1 - (embedding <=> query) gives similarity score
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
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [JSON.stringify(queryEmbedding), limit],
  );

  const results: SearchResult[] = rows.map((row, i) => ({
    courseId: row.course_id,
    sisOfferingName: row.sis_offering_name,
    code: row.code,
    title: row.title,
    shortDescription: row.short_description,
    term: row.term,
    rank: i + 1,
    relevanceScore: Math.round(row.similarity * 1000) / 1000,
  }));

  return { results };
}
