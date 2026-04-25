import type { WeeklyScheduleEvent } from "@/types/schedules";
import { apiUrl } from "@/lib/apiUrl";

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

    const raw = (await res.json()) as { events?: unknown[] };
    if (!Array.isArray(raw.events)) {
      return [];
    }

    return raw.events.filter(
      (event): event is WeeklyScheduleEvent =>
        !!event
        && typeof event === "object"
        && typeof (event as WeeklyScheduleEvent).eventId === "string"
        && typeof (event as WeeklyScheduleEvent).courseCode === "string"
        && typeof (event as WeeklyScheduleEvent).courseTitle === "string",
    );
  },
};

// Retained for tests and local development fallback.
export const mockScheduleEventProvider: ScheduleEventProvider = {
  async getWeeklyEvents(_scheduleId: string): Promise<WeeklyScheduleEvent[]> {
    return [];
  },
};
