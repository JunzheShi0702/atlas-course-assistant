export interface Schedule {
  id: string;
  name: string;
  term: string;
  createdAt: string;
  updatedAt: string;
}

export interface SchedulesListResponse {
  schedules: Schedule[];
}

export interface CreateScheduleBody {
  name: string;
  term: string;
}

export interface ScheduleCourseItem {
  courseCode: string;
  sisOfferingName: string;
  term: string;
  courseTitle?: string;
}

export type ScheduleFeasibilityLabel = "light" | "moderate" | "heavy" | "extreme";

export interface ScheduleGoalAlignment {
  score: number | null;
  rationale: string;
  alignedGoals: string[];
  conflicts: string[];
}

export interface ScheduleAuditRecommendation {
  courseCode: string;
  sisOfferingName: string;
  term: string;
  title: string;
}

export type ScheduleAuditFindingCategory =
  | "workload"
  | "schedule_conflicts"
  | "preference_alignment"
  | "prerequisites";

export type ScheduleAuditFindingSeverity = "info" | "warning" | "critical";

export interface ScheduleAuditFinding {
  category: ScheduleAuditFindingCategory;
  severity: ScheduleAuditFindingSeverity;
  title: string;
  summary: string;
  evidence: string[];
  courseCode?: string;
  sisOfferingName?: string;
  satisfiedPreferences?: string[];
  violatedPreferences?: string[];
}

export interface ScheduleAuditIncompleteCheck {
  category: ScheduleAuditFindingCategory;
  status: "failed";
  errorCode: "check_execution_failed";
  message: string;
}

export interface ScheduleAuditResult {
  workloadRange?: {
    min: number;
    max: number;
  };
  difficulty?: number;
  feasibilityLabel?: ScheduleFeasibilityLabel;
  narrativeSummary: string;
  missingEvaluationData?: string[];
  goalAlignment?: ScheduleGoalAlignment;
  recommendations?: ScheduleAuditRecommendation[];
  findings?: ScheduleAuditFinding[];
  incompleteChecks?: ScheduleAuditIncompleteCheck[];
}

export interface ScheduleAudit {
  id: string;
  createdAt: string;
  result: ScheduleAuditResult;
}

export interface RunScheduleAuditResponse {
  result: ScheduleAuditResult;
}

export interface ScheduleDetail extends Schedule {
  courses: ScheduleCourseItem[];
  latestAudit: ScheduleAudit | null;
}

export interface ScheduleCourseBody {
  courseCode: string;
  sisOfferingName: string;
  term: string;
  courseTitle?: string;
  credits?: number;
}

export interface ChatHistoryMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  responseType: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ChatHistoryResponse {
  rollingSummary: string;
  messages: ChatHistoryMessage[];
}

export type WeeklyScheduleDay =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

export interface WeeklyScheduleEvent {
  eventId: string;
  eventType: "course" | "custom";
  dayOfWeek: WeeklyScheduleDay | null;
  startTime: string | null;
  endTime: string | null;
  courseCode: string;
  courseTitle: string;
  location: string | null;
}

export interface WeeklyScheduleEventsResponse {
  events: WeeklyScheduleEvent[];
}

export interface CustomScheduleEventBody {
  title: string;
  dayOfWeek: WeeklyScheduleDay;
  startTime: string;
  endTime: string;
  location?: string | null;
}
