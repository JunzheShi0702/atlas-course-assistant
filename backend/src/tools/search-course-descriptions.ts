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

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "class", "course", "for", "from",
  "has", "i", "in", "into", "is", "it", "me", "my", "of", "on", "or", "show", "that",
  "the", "this", "to", "with", "want", "looking", "find", "recommend", "easy",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function buildMatchExplanation(query: string, title: string, shortDescription: string, relevanceScore: number): string {
  const queryTokens = Array.from(new Set(tokenize(query)));
  const haystack = `${title} ${shortDescription}`.toLowerCase();
  const matchedTokens = queryTokens.filter((token) => haystack.includes(token)).slice(0, 3);

  if (matchedTokens.length > 0) {
    const joined = matchedTokens.map((token) => `"${token}"`).join(", ");
    return `Matches your request via ${joined} in the title or description.`;
  }

  if (relevanceScore >= 0.8) {
    return "Strong semantic match based on title and description content.";
  }
  if (relevanceScore >= 0.65) {
    return "Good semantic match to your request based on course content.";
  }
  return "Potential related course based on semantic similarity.";
}

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

  const results: SearchResult[] = rows.map((row, i) => {
    const relevanceScore = Math.round(row.similarity * 1000) / 1000;
    
    return {
      courseId: row.course_id,
      sisOfferingName: row.sis_offering_name,
      code: row.code,
      title: row.title,
      shortDescription: row.short_description,
      term: row.term,
      rank: i + 1,
      relevanceScore,
      matchExplanation: buildMatchExplanation(query, row.title, row.short_description, relevanceScore),
    };
  });

  return { results };
}
