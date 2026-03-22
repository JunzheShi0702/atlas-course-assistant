import { useState, useCallback } from "react";
import type {
  Schedule,
  SchedulesListResponse,
  CreateScheduleBody,
  ScheduleCourseBody,
} from "@/types/schedules";

const API_BASE = (
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_API_URL ?? ""
).replace(/\/$/, "");

async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const fullUrl = API_BASE ? `${API_BASE}${url}` : url;
  const res = await fetch(fullUrl, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

export interface UseSchedulesReturn {
  schedules: Schedule[];
  loading: boolean;
  error: string | null;
  loadSchedules: () => Promise<Schedule[]>;
  createSchedule: (body: CreateScheduleBody) => Promise<Schedule>;
  addCourse: (scheduleId: string, body: ScheduleCourseBody) => Promise<void>;
  removeCourse: (scheduleId: string, body: ScheduleCourseBody) => Promise<void>;
}

export function useSchedules(): UseSchedulesReturn {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSchedules = useCallback(async (): Promise<Schedule[]> => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<SchedulesListResponse>("/api/schedules");
      setSchedules(data.schedules);
      return data.schedules;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load schedules";
      setError(msg);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const createSchedule = useCallback(
    async (body: CreateScheduleBody): Promise<Schedule> => {
      const created = await fetchApi<Schedule>("/api/schedules", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setSchedules((prev) => [...prev, created]);
      return created;
    },
    [],
  );

  const addCourse = useCallback(
    async (scheduleId: string, body: ScheduleCourseBody): Promise<void> => {
      await fetchApi<unknown>(`/api/schedules/${scheduleId}/courses`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    [],
  );

  const removeCourse = useCallback(
    async (scheduleId: string, body: ScheduleCourseBody): Promise<void> => {
      await fetchApi<unknown>(`/api/schedules/${scheduleId}/courses`, {
        method: "DELETE",
        body: JSON.stringify(body),
      });
    },
    [],
  );

  return { schedules, loading, error, loadSchedules, createSchedule, addCourse, removeCourse };
}
