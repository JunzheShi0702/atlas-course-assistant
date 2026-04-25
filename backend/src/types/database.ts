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

const evalSourceDatumSchema = z.object({
  term: z.string().nullable(),
  instructor: z.string().nullable(),
  metricName: z.enum([
    "overall_quality",
    "teaching_effectiveness",
    "intellectual_challange",
    "work_load",
    "feedback_quality",
  ]),
  metricLabel: z.enum([
    "Overall Quality",
    "Teaching Effectiveness",
    "Difficulty",
    "Workload",
    "Feedback Quality",
  ]),
  metricValue: z.number(),
  respondentCount: z.number().nullable(),
});

const evalSourceDataMetaSchema = z.object({
  totalDataPoints: z.number(),
  returnedDataPoints: z.number(),
  truncated: z.boolean(),
});

const courseEvalSummaryResultSchema = z.union([
  z.object({
    hasData: z.literal(true),
    summaryText: z.string(),
    metrics: evalMetricsSchema,
    attribution: evalAttributionSchema,
    sourceData: z.array(evalSourceDatumSchema).optional().default([]),
    sourceDataMeta: evalSourceDataMetaSchema
      .optional()
      .default({ totalDataPoints: 0, returnedDataPoints: 0, truncated: false }),
  }),
  z.object({
    hasData: z.literal(false),
    message: z.string(),
    sourceData: z.array(evalSourceDatumSchema).optional().default([]),
    sourceDataMeta: evalSourceDataMetaSchema
      .optional()
      .default({ totalDataPoints: 0, returnedDataPoints: 0, truncated: false }),
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
  user_id: z.string().uuid(),
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
  title: z.string().optional(),
});

export type ScheduleCourse = z.infer<typeof scheduleCourseSchema>;

// Audit Types
export const scheduleGoalAlignmentSchema = z.object({
  score: z.number().min(0).max(5).nullable(),
  rationale: z.string(),
  alignedGoals: z.array(z.string()),
  conflicts: z.array(z.string()),
});

export const scheduleAuditRecommendationSchema = z.object({
  courseCode: z.string(),
  sisOfferingName: z.string(),
  term: z.string(),
  title: z.string(),
});

export const scheduleAuditFindingCategorySchema = z.enum([
  "workload",
  "schedule_conflicts",
  "preference_alignment",
  "prerequisites",
]);

export const scheduleAuditFindingSeveritySchema = z.enum([
  "info",
  "warning",
  "critical",
]);

export const scheduleAuditFindingSchema = z.object({
  category: scheduleAuditFindingCategorySchema,
  severity: scheduleAuditFindingSeveritySchema,
  title: z.string(),
  summary: z.string(),
  evidence: z.array(z.string()),
  courseCode: z.string().optional(),
  sisOfferingName: z.string().optional(),
  satisfiedPreferences: z.array(z.string()).optional(),
  violatedPreferences: z.array(z.string()).optional(),
});

export const scheduleAuditIncompleteCheckSchema = z.object({
  category: scheduleAuditFindingCategorySchema,
  status: z.literal("failed"),
  errorCode: z.literal("check_execution_failed"),
  message: z.string(),
});

export const scheduleAuditResultSchema = z.object({
  workloadRange: z.object({
    min: z.number(),
    max: z.number(),
  }).optional(),
  narrativeSummary: z.string(),
  goalAlignment: scheduleGoalAlignmentSchema.optional(),
  recommendations: z.array(scheduleAuditRecommendationSchema).optional(),
  missingEvaluationData: z.array(z.string()).optional(),
  findings: z.array(scheduleAuditFindingSchema).optional(),
  incompleteChecks: z.array(scheduleAuditIncompleteCheckSchema).optional(),
});

export type ScheduleAuditResult = z.infer<typeof scheduleAuditResultSchema>;
export type ScheduleGoalAlignment = z.infer<typeof scheduleGoalAlignmentSchema>;
export type ScheduleAuditRecommendation = z.infer<typeof scheduleAuditRecommendationSchema>;
export type ScheduleAuditFinding = z.infer<typeof scheduleAuditFindingSchema>;
export type ScheduleAuditFindingCategory = z.infer<typeof scheduleAuditFindingCategorySchema>;
export type ScheduleAuditFindingSeverity = z.infer<typeof scheduleAuditFindingSeveritySchema>;
export type ScheduleAuditIncompleteCheck = z.infer<typeof scheduleAuditIncompleteCheckSchema>;

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
  courseTitle: z.string().max(2000).optional().default(""),
  credits: z.number().positive().optional(),
});

export type AddCourseToScheduleRequest = z.infer<typeof addCourseToScheduleRequestSchema>;

export const removeCourseFromScheduleRequestSchema = z.object({
  courseCode: z.string().min(1),
  sisOfferingName: z.string().min(1),
  term: z.string().min(1),
});

export type RemoveCourseFromScheduleRequest = z.infer<typeof removeCourseFromScheduleRequestSchema>;

// Weekly calendar event contract (Issue #268, stage 0 contract freeze)
const weeklyCalendarDaySchema = z.enum([
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
]);

const weeklyCalendarTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const weeklyCalendarEventSchema = z.object({
  eventId: z.string(),
  dayOfWeek: weeklyCalendarDaySchema.nullable(),
  startTime: weeklyCalendarTimeSchema.nullable(),
  endTime: weeklyCalendarTimeSchema.nullable(),
  courseCode: z.string(),
  courseTitle: z.string(),
  location: z.string().nullable(),
});

export type WeeklyCalendarEvent = z.infer<typeof weeklyCalendarEventSchema>;

export const weeklyCalendarEventsResponseSchema = z.object({
  events: z.array(weeklyCalendarEventSchema),
});

export type WeeklyCalendarEventsResponse = z.infer<typeof weeklyCalendarEventsResponseSchema>;

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
