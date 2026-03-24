import { z } from "zod";

// Course Summary Cache Types
export const courseSummaryCacheSchema = z.object({
  id: z.string().uuid(),
  course_code: z.string(),
  term: z.string(),
  summary: z.record(z.unknown()), // JSONB field storing CourseEvalSummaryResult
  created_at: z.date(),
  updated_at: z.date(),
});

export type CourseSummary = z.infer<typeof courseSummaryCacheSchema>;

// Schedule and Course Management Types
export const scheduleAuditSchema = z.object({
  id: z.string().uuid(),
  schedule_id: z.string().uuid(),
  user_action: z.string(),
  course_code: z.string().optional(),
  action_timestamp: z.date(),
  metadata: z.record(z.unknown()).optional(), // JSONB field
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
