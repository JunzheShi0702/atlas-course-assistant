import { z } from "zod";

// Course Evaluation Summary Schema (for type safety)
const evalMetricsSchema = z.object({
  overallQuality: z.number(),
  teachingEffectiveness: z.number(),
  difficulty: z.number(),
  workload: z.number(),
  feedbackQuality: z.number(),
});

const evalAttributionSchema = z.object({
  instructorNames: z.array(z.string()),
  termRange: z.object({
    startTerm: z.string(),
    endTerm: z.string(),
  }),
  sampleSize: z.number(),
});

const courseEvalSummaryResultSchema = z.union([
  z.object({
    hasData: z.literal(true),
    summaryText: z.string(),
    metrics: evalMetricsSchema,
    attribution: evalAttributionSchema,
  }),
  z.object({
    hasData: z.literal(false),
    message: z.string(),
  }),
]);

// Course Summary Cache Types - one row per course_code
export const courseSummaryCacheSchema = z.object({
  course_code: z.string(),
  latest_term: z.string(),               // Latest eval semester used for cache invalidation
  summary: courseEvalSummaryResultSchema, // Properly typed JSONB field
  created_at: z.date(),
  updated_at: z.date(),
});

export type CourseSummary = z.infer<typeof courseSummaryCacheSchema>;
export { courseEvalSummaryResultSchema };

// Schedule Types
export const scheduleSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string(), // Will be UUID when OAuth team implements users table
  name: z.string(),
  term: z.string(),
  created_at: z.date(),
  updated_at: z.date(),
});

export type Schedule = z.infer<typeof scheduleSchema>;

export const scheduleCourseSchema = z.object({
  schedule_id: z.string().uuid(),
  course_code: z.string(),
  sis_offering_name: z.string(),
  term: z.string(),
});

export type ScheduleCourse = z.infer<typeof scheduleCourseSchema>;

// Audit Types
export const scheduleAuditResultSchema = z.object({
  workloadRange: z.object({
    min: z.number(),
    max: z.number(),
  }).optional(),
  difficulty: z.number().min(1).max(5).optional(),
  feasibilityLabel: z.enum(['light', 'moderate', 'heavy', 'extreme']).optional(),
  narrativeSummary: z.string(),
  goalAlignment: z.string().optional(),
  recommendations: z.array(z.string()).optional(),
});

export type ScheduleAuditResult = z.infer<typeof scheduleAuditResultSchema>;

export const scheduleAuditSchema = z.object({
  id: z.string().uuid(),
  schedule_id: z.string().uuid(),
  created_at: z.date(),
  updated_at: z.date(),
  result: scheduleAuditResultSchema,
  model_version: z.string().nullable(),
});

export type ScheduleAudit = z.infer<typeof scheduleAuditSchema>;

// API Request/Response Types
export const createScheduleRequestSchema = z.object({
  name: z.string().min(1),
  term: z.string().min(1),
});

export type CreateScheduleRequest = z.infer<typeof createScheduleRequestSchema>;

export const addCourseToScheduleRequestSchema = z.object({
  courseCode: z.string().min(1),
  sisOfferingName: z.string().min(1),
  term: z.string().min(1),
});

export type AddCourseToScheduleRequest = z.infer<typeof addCourseToScheduleRequestSchema>;

export const removeCourseFromScheduleRequestSchema = z.object({
  courseCode: z.string().min(1),
  sisOfferingName: z.string().min(1),
  term: z.string().min(1),
});

export type RemoveCourseFromScheduleRequest = z.infer<typeof removeCourseFromScheduleRequestSchema>;

// Auth Types for when OAuth team implements authentication
export const authUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
});

export type AuthUser = z.infer<typeof authUserSchema>;

// Extended request types for Express
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
