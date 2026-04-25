import type { WeeklyScheduleEvent } from "@/types/schedules";

export interface ScheduleEventProvider {
  getWeeklyEvents: (scheduleId: string) => Promise<WeeklyScheduleEvent[]>;
}

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

// Stage 1 scaffold uses mock data to decouple weekly-grid UI from backend wiring.
export const mockScheduleEventProvider: ScheduleEventProvider = {
  async getWeeklyEvents(_scheduleId: string): Promise<WeeklyScheduleEvent[]> {
    return DEMO_EVENTS;
  },
};
