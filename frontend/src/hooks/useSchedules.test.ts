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
});
