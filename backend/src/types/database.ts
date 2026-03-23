import { z } from "zod";

// Course Summary Cache Types
export const courseSummaryCacheSchema = z.object({
  id: z.string().uuid(),
  course_code: z.string(),
  term: z.string(),
  summary: z.record(z.unknown()), // JSONB field storing CourseEvalSummaryResult
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type CourseSummary = z.infer<typeof courseSummaryCacheSchema>;