import { z } from "zod";

export const getCourseEvalSummaryInputSchema = z.object({
  courseId: z
    .string()
    .describe(
      "Dotted course code, e.g. 'AS.270.415' or 'EN.663.657' — " +
      "corresponds to the 'code' field in SearchResult and course_code in course_evaluations",
    ),
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
