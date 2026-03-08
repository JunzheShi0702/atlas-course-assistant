import { z } from "zod";

export const getCourseEvalSummaryInputSchema = z.object({
  courseId: z
    .string()
    .uuid()
    .describe("The course UUID from course_embeddings / search results"),
});

export type GetCourseEvalSummaryInput = z.infer<
  typeof getCourseEvalSummaryInputSchema
>;

export interface EvalMetrics {
  overallQuality: number;
  teachingEffectiveness: number;
  difficulty: number;
  workload: number;
  feedbackQuality: number;
}

export interface EvalAttribution {
  instructorNames: string[];
  termRange: { startTerm: string; endTerm: string };
  sampleSize: number;
}

export interface GetCourseEvalSummaryOutput {
  hasData: true;
  summaryText: string;
  metrics: EvalMetrics;
  attribution: EvalAttribution;
}

export interface GetCourseEvalSummaryNoDataOutput {
  hasData: false;
  message: string;
}

export type CourseEvalSummaryResult =
  | GetCourseEvalSummaryOutput
  | GetCourseEvalSummaryNoDataOutput;
