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

export interface ScheduleAudit {
  id: string;
  createdAt: string;
  result: Record<string, unknown>;
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
}
