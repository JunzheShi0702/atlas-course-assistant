import type { WeeklyScheduleEvent, WeeklyScheduleEventsResponse } from "@/types/schedules";
import { apiUrl } from "@/lib/apiUrl";

const VALID_WEEKLY_DAYS = new Set([
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
]);

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isWeeklyScheduleEvent(value: unknown): value is WeeklyScheduleEvent {
  if (!value || typeof value !== "object") return false;

  const event = value as Partial<WeeklyScheduleEvent>;
  return typeof event.eventId === "string"
    && (event.dayOfWeek === null || (typeof event.dayOfWeek === "string" && VALID_WEEKLY_DAYS.has(event.dayOfWeek)))
    && isNullableString(event.startTime)
    && isNullableString(event.endTime)
    && typeof event.courseCode === "string"
    && typeof event.courseTitle === "string"
    && isNullableString(event.location);
}

export interface ScheduleEventProvider {
  getWeeklyEvents: (scheduleId: string) => Promise<WeeklyScheduleEvent[]>;
}

export const scheduleEventProvider: ScheduleEventProvider = {
  async getWeeklyEvents(scheduleId: string): Promise<WeeklyScheduleEvent[]> {
    const res = await fetch(apiUrl(`/api/schedules/${scheduleId}/events`), {
      method: "GET",
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const raw = (await res.json()) as Partial<WeeklyScheduleEventsResponse>;
    if (!Array.isArray(raw.events)) {
      return [];
    }

    return raw.events.filter(isWeeklyScheduleEvent);
  },
};

// Retained for tests and local development fallback.
export const mockScheduleEventProvider: ScheduleEventProvider = {
  async getWeeklyEvents(_scheduleId: string): Promise<WeeklyScheduleEvent[]> {
    return [];
  },
};
