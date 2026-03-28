/**
 * searchCourseDescriptions LLM tool — Issue #34
 *
 * Performs semantic search over the course_embeddings vector index.
 * Embeds the user query with text-embedding-3-small, computes cosine
 * similarity against stored embeddings, and returns top-k ranked results.
 */

import { pool } from "../db";
import { generateEmbedding } from "../services/embeddings";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import {
  SearchCourseDescriptionsInput,
  SearchCourseDescriptionsOutput,
  SearchResult,
} from "../types/search";

/** Cosine similarity (1 − distance); results below this are dropped as too weak. */
const MIN_RELEVANCE_SCORE = 0.3;

async function generateMatchExplanation(
  query: string,
  title: string,
  description: string,
  code: string,
): Promise<string | undefined> {
  try {
    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      prompt: `This course was retrieved as relevant to the student's search. Help them see how it connects to what they asked for.

User query: "${query}"
Course: ${code} — ${title}
Catalog-style description: ${description}

Write 1–2 short sentences. Describe what the course covers and how it relates to the student's query (themes, skills, or subject area). The search already ranked this course—do not argue that it is unrelated, a poor fit, or "does not match." Do not use negative disclaimers (e.g. "not really," "only loosely," "unrelated," "doesn't address").

If you truly cannot write a helpful line without contradicting that, respond with exactly: NONE`,
      temperature: 0.3,
    });

    const trimmed = text.trim();
    if (!trimmed || /^NONE\.?$/i.test(trimmed)) {
      return undefined;
    }
    return trimmed;
  } catch (error) {
    console.error("Failed to generate match explanation:", error);
    return undefined;
  }
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
     WHERE (1 - (embedding <=> $1::vector)) >= $3
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [JSON.stringify(queryEmbedding), limit, MIN_RELEVANCE_SCORE],
  );

  const results: SearchResult[] = await Promise.all(
    rows.map(async (row, i) => {
      const relevanceScore = Math.round(row.similarity * 1000) / 1000;
      
      const normalizedQuery = query.trim().toLowerCase();
      const clearlyMatches = 
        row.title.toLowerCase().includes(normalizedQuery) ||
        normalizedQuery.includes(row.title.toLowerCase()) ||
        normalizedQuery.includes(row.code.toLowerCase());

      const matchExplanation = clearlyMatches
        ? undefined
        : await generateMatchExplanation(query, row.title, row.short_description, row.code);
      
      return {
        courseId: row.course_id,
        sisOfferingName: row.sis_offering_name,
        code: row.code,
        title: row.title,
        description: row.short_description,
        term: row.term,
        rank: i + 1,
        relevanceScore,
        matchExplanation,
      };
    })
  );

  return { results };
}
