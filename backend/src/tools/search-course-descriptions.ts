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

async function generateMatchExplanation(query: string, title: string, shortDescription: string, code: string): Promise<string> {
  try {
    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      prompt: `You are helping students understand why a course matches their search query.

      User Query: "${query}"
      Course: ${code} - ${title}
      Description: ${shortDescription}

      Generate a natural explanation (2-3 sentences) of why this specific course matches the user's request. First, explain the direct connection between the query and course content. Then, add a second sentence explaining which area of study or domain this course belongs to that relates to their search.

      Examples:
      - For query "easy stats class" and course "Introduction to Statistics": "This introductory statistics course aligns with your search for an accessible statistics class. It falls within the mathematics and data analysis domain."
      - For query "machine learning" and course "Artificial Intelligence": "This AI course covers machine learning algorithms, directly matching your interest. It's part of the computer science and artificial intelligence field."

      Explanation (include both match reasoning and study area):`,
      temperature: 0.3,
    });
    
    return text.trim();
  } catch (error) {
    console.error("Failed to generate match explanation:", error);
    // Fallback to simple explanation
    return `This ${code} course relates to your search for "${query}".`;
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
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [JSON.stringify(queryEmbedding), limit],
  );

  const results: SearchResult[] = await Promise.all(
    rows.map(async (row, i) => {
      const relevanceScore = Math.round(row.similarity * 1000) / 1000;
      
      const matchExplanation = await generateMatchExplanation(
        query, 
        row.title, 
        row.short_description, 
        row.code
      );
      
      return {
        courseId: row.course_id,
        sisOfferingName: row.sis_offering_name,
        code: row.code,
        title: row.title,
        shortDescription: row.short_description,
        term: row.term,
        rank: i + 1,
        relevanceScore,
        matchExplanation,
      };
    })
  );

  return { results };
}
