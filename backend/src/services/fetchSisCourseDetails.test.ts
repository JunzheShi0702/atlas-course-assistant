import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RawSisCourse } from "../types/sis";

vi.mock("./sis-course-details-cache", () => ({
  getCachedSisCourseDetail: vi.fn(),
  upsertSisCourseDetailCache: vi.fn(),
  sectionKeyFromOptional: (s?: string) => s ?? "",
  getSisDetailsCacheTtlMs: () => 7 * 24 * 60 * 60 * 1000,
}));

import * as SisClient from "./sis-client";
import {
  getCachedSisCourseDetail,
  upsertSisCourseDetailCache,
} from "./sis-course-details-cache";

const raw: RawSisCourse = {
  OfferingName: "EN.553.171",
  SectionName: "01",
  Title: "Cached or live",
  SchoolName: "Whiting School of Engineering",
  Department: "EN",
  Level: "Upper",
  TimeOfDay: "afternoon",
  DOW: "4",
  Location: "Hodson",
  InstructorsFullName: "Prof",
  Status: "Open",
};

describe("fetchSisCourseDetails", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, JHU_SIS_API_KEY: "test-key" };
    vi.mocked(getCachedSisCourseDetail).mockReset();
    vi.mocked(upsertSisCourseDetailCache).mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns DB cache on hit without calling the SIS API", async () => {
    vi.mocked(getCachedSisCourseDetail).mockResolvedValue(raw);
    const apiSpy = vi
      .spyOn(SisClient, "fetchSisCourseDetailsFromApi")
      .mockResolvedValue(null);

    const out = await SisClient.fetchSisCourseDetails(
      "en-553-171-01-spring-2026",
    );
    expect(out).toEqual(raw);
    expect(apiSpy).not.toHaveBeenCalled();
    expect(upsertSisCourseDetailCache).not.toHaveBeenCalled();
  });

  it("calls SIS on miss and upserts the result", async () => {
    vi.mocked(getCachedSisCourseDetail).mockResolvedValue(undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([raw]),
    } as Response);

    const out = await SisClient.fetchSisCourseDetails(
      "en-553-171-01-spring-2026",
    );
    expect(out).toEqual(raw);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      "https://sis.jhu.edu/api/classes/EN55317101/Spring%202026?key=test-key",
    );
    expect(upsertSisCourseDetailCache).toHaveBeenCalledWith(
      "EN553171",
      "Spring 2026",
      "01",
      raw,
    );
  });

  it("does not upsert when SIS returns null", async () => {
    vi.mocked(getCachedSisCourseDetail).mockResolvedValue(undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response);

    const out = await SisClient.fetchSisCourseDetails(
      "en-999-999-spring-2026",
    );
    expect(out).toBeNull();
    expect(upsertSisCourseDetailCache).not.toHaveBeenCalled();
  });

  it("prefers a section row that includes prerequisites when courseId has no section", async () => {
    vi.mocked(getCachedSisCourseDetail).mockResolvedValue(undefined);
    const firstRow = {
      ...raw,
      SectionName: "01",
      SectionDetails: [],
    };
    const secondRow = {
      ...raw,
      SectionName: "02",
      SectionDetails: [
        {
          Prerequisites: [{ Description: "AS.110.108", Expression: "", IsNegative: false }],
        },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([firstRow, secondRow]),
    } as Response);

    const out = await SisClient.fetchSisCourseDetails("en-553-171-spring-2026");
    expect(out).toEqual(secondRow);
    expect(upsertSisCourseDetailCache).toHaveBeenCalledWith(
      "EN553171",
      "Spring 2026",
      "",
      secondRow,
    );
  });

  it("fetches section-specific detail rows when sectionless response lacks prerequisites", async () => {
    vi.mocked(getCachedSisCourseDetail).mockResolvedValue(undefined);
    const noPrereqRows = [
      {
        ...raw,
        SectionName: "01",
        SectionDetails: [],
      },
      {
        ...raw,
        SectionName: "02",
        SectionDetails: [],
      },
    ];
    const prereqRow = {
      ...raw,
      SectionName: "02",
      SectionDetails: [
        {
          Prerequisites: [{ Description: "AS.110.108", Expression: "", IsNegative: false }],
        },
      ],
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        const url = String(input);
        if (url.includes("/EN553171/Spring%202026")) {
          return {
            ok: true,
            json: () => Promise.resolve(noPrereqRows),
          } as Response;
        }
        if (url.includes("/EN55317102/Spring%202026")) {
          return {
            ok: true,
            json: () => Promise.resolve([prereqRow]),
          } as Response;
        }
        return {
          ok: true,
          json: () => Promise.resolve([]),
        } as Response;
      },
    );

    const out = await SisClient.fetchSisCourseDetails("en-553-171-spring-2026");
    expect(out).toEqual(prereqRow);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://sis.jhu.edu/api/classes/EN553171/Spring%202026?key=test-key",
      expect.anything(),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://sis.jhu.edu/api/classes/EN55317102/Spring%202026?key=test-key",
      expect.anything(),
    );
  });
});

describe("parseCourseId", () => {
  it("parses course ids without a section", () => {
    expect(SisClient.parseCourseId("en-553-171-spring-2026")).toEqual({
      offeringName: "EN553171",
      term: "Spring 2026",
      sectionName: undefined,
    });
  });

  it("parses course ids with a section", () => {
    expect(SisClient.parseCourseId("en-553-171-01-spring-2026")).toEqual({
      offeringName: "EN553171",
      term: "Spring 2026",
      sectionName: "01",
    });
  });

  it("rejects malformed course ids", () => {
    expect(() => SisClient.parseCourseId("en-553-spring-2026")).toThrow(
      /Invalid courseId format/,
    );
  });
});
