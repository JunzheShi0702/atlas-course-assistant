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

export interface ScheduleAuditResult {
  workloadRange?: {
    min: number;
    max: number;
  };
  difficulty?: number;
  feasibilityLabel?: ScheduleFeasibilityLabel;
  narrativeSummary: string;
  missingEvaluationData?: string[];
  goalAlignment?: string;
  recommendations?: string[];
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
