import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchSisClasses } from "./sis-client";

describe("fetchSisClasses", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, JHU_SIS_API_KEY: "test-api-key-123" };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("throws when JHU_SIS_API_KEY is not set", async () => {
    delete process.env.JHU_SIS_API_KEY;
    await expect(fetchSisClasses({})).rejects.toThrow(
      "JHU_SIS_API_KEY is not set",
    );
  });

  it("builds the correct URL with API key and params", async () => {
    const mockResponse = { ok: true, json: () => Promise.resolve([]) };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockResponse as Response);

    await fetchSisClasses({ Term: "Fall 2025", School: "Engineering" });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
    expect(calledUrl.origin + calledUrl.pathname).toBe(
      "https://sis.jhu.edu/api/classes",
    );
    expect(calledUrl.searchParams.get("key")).toBe("test-api-key-123");
    expect(calledUrl.searchParams.get("Term")).toBe("Fall 2025");
    expect(calledUrl.searchParams.get("School")).toBe("Engineering");
  });

  it("returns parsed JSON on success", async () => {
    const mockCourses = [
      { OfferingName: "EN.601.220", Title: "Data Structures" },
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockCourses),
    } as Response);

    const result = await fetchSisClasses({ Term: "Fall 2025" });
    expect(result).toEqual(mockCourses);
  });

  it("throws on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    } as Response);

    await expect(fetchSisClasses({})).rejects.toThrow(
      "SIS API responded with status 403: Forbidden",
    );
  });

  it("throws on fetch abort (timeout)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new DOMException("The operation was aborted.", "AbortError"),
    );

    await expect(fetchSisClasses({})).rejects.toThrow("aborted");
  });
});
