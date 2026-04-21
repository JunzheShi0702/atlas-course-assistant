import { z } from "zod";

export const searchCourseDescriptionsInputSchema = z.object({
  query: z.string().describe("Natural-language search query, e.g. 'easy stats class with light workload'"),
  limit: z.number().int().positive().default(5).describe("Max results to return (default 5)"),
});

export type SearchCourseDescriptionsInput = z.infer<typeof searchCourseDescriptionsInputSchema>;

export type SearchMatchType = "exact" | "constraint" | "semantic" | "hybrid";
export type ConstraintAlignment = "aligned" | "mismatch" | "unknown";
export type ConstraintMismatchReason =
  | "days"
  | "time_window"
  | "school"
  | "level"
  | "course_number"
  | "instructor";

export interface SearchResult {
  courseId: string;
  sisOfferingName: string;
  code: string;
  title: string;
  description: string;
  term: string;
  credits?: number;
  rank: number;
  relevanceScore: number;
  matchType?: SearchMatchType;
  constraintAlignment?: ConstraintAlignment;
  constraintMismatchReasons?: ConstraintMismatchReason[];
  /** Deterministic: query overlaps title/code strongly; skip matchExplanation. */
  clearlyMatches?: boolean;
  matchExplanation?: string;
}

export interface SearchCourseDescriptionsOutput {
  results: SearchResult[];
}
