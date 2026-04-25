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

const DEMO_EVENTS: WeeklyScheduleEvent[] = [
  {
    eventId: "demo-en-601-226-mon",
    dayOfWeek: "Monday",
    startTime: "09:00",
    endTime: "10:15",
    courseCode: "EN.601.226",
    courseTitle: "Data Structures",
    location: "Malone 228",
  },
  {
    eventId: "demo-en-601-226-wed",
    dayOfWeek: "Wednesday",
    startTime: "09:00",
    endTime: "10:15",
    courseCode: "EN.601.226",
    courseTitle: "Data Structures",
    location: "Malone 228",
  },
  {
    eventId: "demo-en-601-315-tue",
    dayOfWeek: "Tuesday",
    startTime: "13:30",
    endTime: "14:45",
    courseCode: "EN.601.315",
    courseTitle: "Database Systems",
    location: "Hackerman 122",
  },
  {
    eventId: "demo-en-601-315-thu",
    dayOfWeek: "Thursday",
    startTime: "13:30",
    endTime: "14:45",
    courseCode: "EN.601.315",
    courseTitle: "Database Systems",
    location: "Hackerman 122",
  },
  {
    eventId: "demo-as-030-205-tue",
    dayOfWeek: "Tuesday",
    startTime: "15:00",
    endTime: "16:15",
    courseCode: "AS.030.205",
    courseTitle: "",
    location: null,
  },
  {
    eventId: "demo-en-625-411-mon-conflict",
    dayOfWeek: "Monday",
    startTime: "09:30",
    endTime: "10:20",
    courseCode: "EN.625.411",
    courseTitle: "Real-Time Systems",
    location: "Maryland 110",
  },
  {
    eventId: "demo-en-625-411-wed-clear",
    dayOfWeek: "Wednesday",
    startTime: "11:00",
    endTime: "12:15",
    courseCode: "EN.625.411",
    courseTitle: "Real-Time Systems",
    location: "Maryland 110",
  },
  {
    eventId: "demo-en-553-201-fri-tba",
    dayOfWeek: "Friday",
    startTime: null,
    endTime: null,
    courseCode: "EN.553.201",
    courseTitle: "Probability",
    location: null,
  },
  {
    eventId: "demo-missing-fields",
    dayOfWeek: null,
    startTime: null,
    endTime: null,
    courseCode: "",
    courseTitle: "",
    location: null,
  },
];

// Retained for isolated UI tests and local scaffolding when a fake provider is useful.
export const mockScheduleEventProvider: ScheduleEventProvider = {
  async getWeeklyEvents(_scheduleId: string): Promise<WeeklyScheduleEvent[]> {
    return DEMO_EVENTS;
  },
};
