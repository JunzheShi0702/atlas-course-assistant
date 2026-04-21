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

export interface AuditEvalMetrics {
  overallQuality: number | null;
  teachingEffectiveness: number | null;
  difficulty: number | null;
  workload: number | null;
  feedbackQuality: number | null;
  sampleSize: number;
  sectionCount: number;
}

export interface EvalAttribution {
  instructorNames: string[];
  termRange: { startTerm: string; endTerm: string };
  sampleSize: number;
}

export interface EvalSourceDatum {
  term: string | null;
  instructor: string | null;
  metricName: "overall_quality" | "teaching_effectiveness" | "intellectual_challange" | "work_load" | "feedback_quality";
  metricLabel: "Overall Quality" | "Teaching Effectiveness" | "Difficulty" | "Workload" | "Feedback Quality";
  metricValue: number;
  respondentCount: number | null;
}

export interface EvalSourceDataMeta {
  totalDataPoints: number;
  returnedDataPoints: number;
  truncated: boolean;
}

export interface GetCourseEvalSummaryOutput {
  hasData: true;
  summaryText: string;
  metrics: EvalMetrics;
  attribution: EvalAttribution;
  sourceData: EvalSourceDatum[];
  sourceDataMeta: EvalSourceDataMeta;
}

export interface GetCourseEvalSummaryNoDataOutput {
  hasData: false;
  message: string;
  sourceData: EvalSourceDatum[];
  sourceDataMeta: EvalSourceDataMeta;
}

export type CourseEvalSummaryResult =
  | GetCourseEvalSummaryOutput
  | GetCourseEvalSummaryNoDataOutput;
