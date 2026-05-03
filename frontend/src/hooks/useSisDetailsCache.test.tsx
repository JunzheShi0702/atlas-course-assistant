import { Provider } from "jotai";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSisDetailsCache } from "./useSisDetailsCache";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const wrapper = ({ children }: { children: ReactNode }) => <Provider>{children}</Provider>;

describe("useSisDetailsCache", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("prefetches and caches SIS details", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        details: {
          offeringName: "EN.601.226",
          sectionName: "01",
          title: "Data Structures",
          description: "Core course",
          schoolName: "Whiting",
          department: "Computer Science",
          level: "Undergraduate",
          timeOfDay: "Morning",
          daysOfWeek: "Monday",
          location: "Homewood",
          instructors: ["Ada"],
          status: "Open",
        },
      }),
    );

    const { result } = renderHook(() => useSisDetailsCache(), { wrapper });

    await act(async () => {
      await result.current.prefetchSisDetails("en-601-226-spring-2026");
    });

    await waitFor(() => {
      expect(result.current.cache.get("en-601-226-spring-2026")).toMatchObject({
        title: "Data Structures",
      });
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not refetch cached entries and stores errors on failures", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: "nope" }, 500));
    const { result } = renderHook(() => useSisDetailsCache(), { wrapper });

    await act(async () => {
      await result.current.prefetchSisDetails("bad-course");
    });
    expect(result.current.cache.get("bad-course")).toBe("error");

    await act(async () => {
      await result.current.prefetchSisDetails("bad-course");
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
