import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RawSisCourse } from "../types/sis";
import {
  getCachedSisCourseDetail,
  getSisDetailsCacheTtlMs,
  upsertSisCourseDetailCache,
} from "./sis-course-details-cache";

vi.mock("../pool", () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { pool } from "../pool";

const mockPayload: RawSisCourse = {
  OfferingName: "EN.553.171",
  SectionName: "01",
  Title: "Test",
  SchoolName: "Whiting School of Engineering",
  Department: "EN",
  Level: "Upper",
  TimeOfDay: "afternoon",
  DOW: "4",
  Location: "Hodson",
  InstructorsFullName: "Prof",
  Status: "Open",
};

describe("sis-course-details-cache", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.mocked(pool.query).mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("getSisDetailsCacheTtlMs defaults to 7 days", () => {
    delete process.env.SIS_DETAILS_CACHE_TTL_MS;
    expect(getSisDetailsCacheTtlMs()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("getSisDetailsCacheTtlMs reads SIS_DETAILS_CACHE_TTL_MS", () => {
    process.env.SIS_DETAILS_CACHE_TTL_MS = "5000";
    expect(getSisDetailsCacheTtlMs()).toBe(5000);
  });

  it("getCachedSisCourseDetail returns undefined when absent", async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as never);
    const result = await getCachedSisCourseDetail("EN553171", "Spring 2026", "");
    expect(result).toBeUndefined();
  });

  it("getCachedSisCourseDetail returns payload on fresh hit", async () => {
    vi.mocked(pool.query).mockResolvedValue({
      rows: [{ payload: mockPayload, fetched_at: new Date() }],
    } as never);
    const result = await getCachedSisCourseDetail("EN553171", "Spring 2026", "");
    expect(result).toEqual(mockPayload);
  });

  it("getCachedSisCourseDetail returns undefined when entry is stale", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2025-02-15T12:00:00Z"));
      process.env.SIS_DETAILS_CACHE_TTL_MS = String(24 * 60 * 60 * 1000);
      vi.mocked(pool.query).mockResolvedValue({
        rows: [
          {
            payload: mockPayload,
            fetched_at: new Date("2025-02-01T12:00:00Z"),
          },
        ],
      } as never);
      const result = await getCachedSisCourseDetail(
        "EN553171",
        "Spring 2026",
        "",
      );
      expect(result).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("upsertSisCourseDetailCache inserts jsonb payload", async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as never);
    await upsertSisCourseDetailCache(
      "EN553171",
      "Spring 2026",
      "01",
      mockPayload,
    );
    expect(pool.query).toHaveBeenCalledOnce();
    const args = vi.mocked(pool.query).mock.calls[0];
    expect(args[0]).toContain("INSERT INTO sis_course_details_cache");
    expect(args[1]).toEqual([
      "EN553171",
      "Spring 2026",
      "01",
      JSON.stringify(mockPayload),
      null,
    ]);
  });

  it("upsertSisCourseDetailCache stores prerequisites when available", async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as never);
    await upsertSisCourseDetailCache(
      "EN553171",
      "Spring 2026",
      "01",
      {
        ...mockPayload,
        Prerequisites: "AS.110.108",
      },
    );
    const args = vi.mocked(pool.query).mock.calls[0];
    expect(args[1]).toEqual([
      "EN553171",
      "Spring 2026",
      "01",
      JSON.stringify({
        ...mockPayload,
        Prerequisites: "AS.110.108",
      }),
      "AS.110.108",
    ]);
  });

  it("upsertSisCourseDetailCache derives prerequisites from SectionDetails records", async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as never);
    await upsertSisCourseDetailCache(
      "EN553171",
      "Spring 2026",
      "01",
      {
        ...mockPayload,
        SectionDetails: [
          {
            Prerequisites: [
              { Description: "AS.110.108", Expression: "", IsNegative: false },
              { Description: "", Expression: "EN.553.171", IsNegative: true },
            ],
          },
        ],
      },
    );
    const args = vi.mocked(pool.query).mock.calls[0];
    expect(args[1]).toEqual([
      "EN553171",
      "Spring 2026",
      "01",
      JSON.stringify({
        ...mockPayload,
        SectionDetails: [
          {
            Prerequisites: [
              { Description: "AS.110.108", Expression: "", IsNegative: false },
              { Description: "", Expression: "EN.553.171", IsNegative: true },
            ],
          },
        ],
      }),
      "AS.110.108; NOT (EN.553.171)",
    ]);
  });

  it("falls back to legacy upsert when prerequisites column is missing", async () => {
    vi.mocked(pool.query)
      .mockRejectedValueOnce({ code: "42703" } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    await upsertSisCourseDetailCache(
      "EN553171",
      "Spring 2026",
      "01",
      mockPayload,
    );

    expect(pool.query).toHaveBeenCalledTimes(2);
    const fallbackCall = vi.mocked(pool.query).mock.calls[1];
    expect(fallbackCall[0]).not.toContain("prerequisites");
    expect(fallbackCall[1]).toEqual([
      "EN553171",
      "Spring 2026",
      "01",
      JSON.stringify(mockPayload),
    ]);
  });
});
