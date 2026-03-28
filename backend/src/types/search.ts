import { z } from "zod";

export const searchCourseDescriptionsInputSchema = z.object({
  query: z.string().describe("Natural-language search query, e.g. 'easy stats class with light workload'"),
  limit: z.number().int().positive().default(5).describe("Max results to return (default 5)"),
});

export type SearchCourseDescriptionsInput = z.infer<typeof searchCourseDescriptionsInputSchema>;

export interface SearchResult {
  courseId: string;
  sisOfferingName: string;
  code: string;
  title: string;
  description: string;
  term: string;
  rank: number;
  relevanceScore: number;
  /** Deterministic: query overlaps title/code strongly; skip matchExplanation. */
  clearlyMatches?: boolean;
  matchExplanation?: string;
}

export interface SearchCourseDescriptionsOutput {
  results: SearchResult[];
}
