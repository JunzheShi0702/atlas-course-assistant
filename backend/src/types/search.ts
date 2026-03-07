import { z } from "zod";

export const searchCourseDescriptionsInputSchema = z.object({
  query: z.string().describe("Natural-language search query, e.g. 'easy stats class with light workload'"),
  limit: z.number().int().positive().default(5).describe("Max results to return (default 5)"),
});

export type SearchCourseDescriptionsInput = z.infer<typeof searchCourseDescriptionsInputSchema>;

export const searchExactInputSchema = z.object({
  query: z.string().describe("Exact or partial match on course code, title, or offering name"),
  limit: z.number().int().positive().default(10).describe("Max results to return (default 10)"),
});

export type SearchExactInput = z.infer<typeof searchExactInputSchema>;

export interface SearchResult {
  courseId: string;
  sisOfferingName: string;
  code: string;
  title: string;
  shortDescription: string;
  term: string;
  rank: number;
  relevanceScore: number;
  /** Instructor name(s) when available (e.g. from SIS) */
  instructor?: string;
  /** Recommendation reasoning for semantic matches (shown above course card) */
  matchExplanation?: string;
}

export interface SearchCourseDescriptionsOutput {
  results: SearchResult[];
}

export interface SearchExactOutput {
  results: SearchResult[];
}
