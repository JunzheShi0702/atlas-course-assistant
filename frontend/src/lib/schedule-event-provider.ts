import type { WeeklyScheduleEvent } from "@/types/schedules";

export interface ScheduleEventProvider {
  getWeeklyEvents: (scheduleId: string) => Promise<WeeklyScheduleEvent[]>;
}

// Stage 1 scaffold uses mock data to decouple weekly-grid UI from backend wiring.
export const mockScheduleEventProvider: ScheduleEventProvider = {
  async getWeeklyEvents(_scheduleId: string): Promise<WeeklyScheduleEvent[]> {
    return [];
  },
};
