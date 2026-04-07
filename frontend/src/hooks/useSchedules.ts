import { useState, useCallback } from "react";
import type {
  Schedule,
  ScheduleDetail,
  SchedulesListResponse,
  CreateScheduleBody,
  ScheduleCourseBody,
  RunScheduleAuditResponse,
} from "@/types/schedules";
import { apiUrl } from "@/lib/apiUrl";

async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(url), {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
  });

  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

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

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface UseSchedulesReturn {
  schedules: Schedule[];
  loading: boolean;
  error: string | null;
  loadSchedules: () => Promise<Schedule[]>;
  createSchedule: (body: CreateScheduleBody) => Promise<Schedule>;
  deleteSchedule: (id: string) => Promise<void>;
  getSchedule: (id: string) => Promise<ScheduleDetail>;
  addCourse: (scheduleId: string, body: ScheduleCourseBody) => Promise<void>;
  removeCourse: (scheduleId: string, body: ScheduleCourseBody) => Promise<void>;
  runScheduleAudit: (scheduleId: string) => Promise<RunScheduleAuditResponse>;
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

  const createSchedule = useCallback(async (body: CreateScheduleBody): Promise<Schedule> => {
    const created = await fetchApi<Schedule>("/api/schedules", {
      method: "POST",
      body: JSON.stringify(body),
    });
    setSchedules((prev) => [created, ...prev]);
    return created;
  }, []);

  const deleteSchedule = useCallback(async (id: string): Promise<void> => {
    await fetchApi<void>(`/api/schedules/${id}`, { method: "DELETE" });
    setSchedules((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const getSchedule = useCallback(async (id: string): Promise<ScheduleDetail> => {
    return fetchApi<ScheduleDetail>(`/api/schedules/${id}`);
  }, []);

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

  const runScheduleAudit = useCallback(async (scheduleId: string): Promise<RunScheduleAuditResponse> => {
    return fetchApi<RunScheduleAuditResponse>(`/api/schedules/${scheduleId}/audit`, {
      method: "POST",
    });
  }, []);

  return {
    schedules,
    loading,
    error,
    loadSchedules,
    createSchedule,
    deleteSchedule,
    getSchedule,
    addCourse,
    removeCourse,
    runScheduleAudit,
  };
}
