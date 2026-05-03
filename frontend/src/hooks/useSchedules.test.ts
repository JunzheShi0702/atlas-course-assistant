import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useSchedules } from "./useSchedules";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("useSchedules", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("loads schedules and updates state", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        schedules: [
          { id: "s1", name: "Main", term: "Spring 2026", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
        ],
      }),
    );

    const { result } = renderHook(() => useSchedules());

    let loaded: unknown[] = [];
    await act(async () => {
      loaded = await result.current.loadSchedules();
    });

    expect(loaded).toHaveLength(1);
    expect(result.current.schedules).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it("sets error and returns [] when loadSchedules fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: "db down" }, 500));

    const { result } = renderHook(() => useSchedules());

    let loaded: unknown[] = [];
    await act(async () => {
      loaded = await result.current.loadSchedules();
    });

    expect(loaded).toEqual([]);
    expect(result.current.error).toBe("db down");
  });

  it("createSchedule prepends the new schedule", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        id: "new",
        name: "New Plan",
        term: "Spring 2026",
        createdAt: "2026-02-01",
        updatedAt: "2026-02-01",
      }, 201),
    );

    const { result } = renderHook(() => useSchedules());

    await act(async () => {
      await result.current.createSchedule({ name: "New Plan", term: "Spring 2026" });
    });

    expect(result.current.schedules.map((s) => s.id)).toEqual(["new"]);
  });

  it("deleteSchedule removes schedule from local state", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          id: "s1",
          name: "Plan 1",
          term: "Spring 2026",
          createdAt: "2026-01-01",
          updatedAt: "2026-01-01",
        }, 201),
      )
      .mockResolvedValueOnce(jsonResponse(undefined, 204));

    const { result } = renderHook(() => useSchedules());

    await act(async () => {
      await result.current.createSchedule({ name: "Plan 1", term: "Spring 2026" });
    });
    expect(result.current.schedules).toHaveLength(1);

    await act(async () => {
      await result.current.deleteSchedule("s1");
    });

    await waitFor(() => {
      expect(result.current.schedules).toEqual([]);
    });
  });

  it("creates a custom event through the custom-events endpoint", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        eventId: "custom-1",
        eventType: "custom",
        dayOfWeek: "Tuesday",
        startTime: "18:00",
        endTime: "19:00",
        courseCode: "Custom",
        courseTitle: "Gym",
        location: "Rec Center",
      }, 201),
    );

    const { result } = renderHook(() => useSchedules());

    let created;
    await act(async () => {
      created = await result.current.createCustomEvent("sched-1", {
        title: "Gym",
        dayOfWeek: "Tuesday",
        startTime: "18:00",
        endTime: "19:00",
        location: "Rec Center",
      });
    });

    expect(created).toMatchObject({
      eventId: "custom-1",
      eventType: "custom",
      courseTitle: "Gym",
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/schedules/sched-1/custom-events"),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
  });

  it("updates a custom event through the custom-events endpoint", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        eventId: "custom-1",
        eventType: "custom",
        dayOfWeek: "Thursday",
        startTime: "20:00",
        endTime: "21:00",
        courseCode: "Custom",
        courseTitle: "Gym",
        location: "Rec Center",
      }),
    );

    const { result } = renderHook(() => useSchedules());

    let updated;
    await act(async () => {
      updated = await result.current.updateCustomEvent("sched-1", "custom-1", {
        dayOfWeek: "Thursday",
        startTime: "20:00",
        endTime: "21:00",
      });
    });

    expect(updated).toMatchObject({
      eventId: "custom-1",
      dayOfWeek: "Thursday",
      startTime: "20:00",
      endTime: "21:00",
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/schedules/sched-1/custom-events/custom-1"),
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
      }),
    );
  });

  it("deletes a custom event through the custom-events endpoint", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(undefined, 204));

    const { result } = renderHook(() => useSchedules());

    await act(async () => {
      await result.current.deleteCustomEvent("sched-1", "custom-1");
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/schedules/sched-1/custom-events/custom-1"),
      expect.objectContaining({
        method: "DELETE",
        credentials: "include",
      }),
    );
  });

  it("redirects to login when a custom event request is unauthorized", async () => {
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "/schedules/sched-1" },
    });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: "Unauthorized" }, 401));

    const { result } = renderHook(() => useSchedules());

    await expect(
      result.current.createCustomEvent("sched-1", {
        title: "Gym",
        dayOfWeek: "Tuesday",
        startTime: "18:00",
        endTime: "19:00",
        location: null,
      }),
    ).rejects.toThrow("Unauthorized");
    expect(window.location.href).toBe("/");

    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });
});
