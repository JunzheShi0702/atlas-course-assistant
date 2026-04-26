import { describe, it, expect, vi, afterEach } from "vitest";
import {
  mapRawToSisCourse,
  searchCoursesBySisConstraints,
} from "./search-courses-by-sis-constraints";
import type { RawSisCourse } from "../types/sis";

vi.mock("../services/sis-client");

import { fetchSisClasses } from "../services/sis-client";
const mockFetch = vi.mocked(fetchSisClasses);

type SearchCoursesBySisConstraintsParams = Parameters<
  typeof searchCoursesBySisConstraints
>[0];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mapRawToSisCourse", () => {
  const fullRaw: RawSisCourse = {
    OfferingName: "EN.601.226",
    SectionName: "",
    Title: "Data Structures",
    SchoolName: "Whiting School of Engineering",
    Department: "EN Computer Science",
    Level: "Upper Level Undergraduate",
    TimeOfDay: "morning",
    DOW: "21",
    Location: "Homewood Campus",
    InstructorsFullName: "Ali Madooei, John Smith",
    Status: "Open",
  };

  it("maps all fields correctly", () => {
    const result = mapRawToSisCourse(fullRaw);
    expect(result).toEqual({
      offeringName: "EN.601.226",
      sectionName: "",
      title: "Data Structures",
      description: "",
      schoolName: "Whiting School of Engineering",
      department: "EN Computer Science",
      level: "Upper Level Undergraduate",
      timeOfDay: "morning",
      daysOfWeek: "Mon/Wed/Fri",
      location: "Homewood Campus",
      instructors: ["Ali Madooei", "John Smith"],
      status: "Open",
    });
  });

  it("handles missing optional fields with defaults", () => {
    const minimal: RawSisCourse = {
      OfferingName: "",
      SectionName: "",
      Title: "",
      SchoolName: "",
      Department: "",
      Level: "",
      TimeOfDay: "",
      DOW: "",
      Location: "",
      InstructorsFullName: "",
      Status: "",
    };

    const result = mapRawToSisCourse(minimal);
    expect(result.offeringName).toBe("");
    expect(result.instructors).toEqual([]);
    expect(result.daysOfWeek).toBe("");
  });

  it("splits multiple instructors by comma", () => {
    const raw: RawSisCourse = {
      ...fullRaw,
      InstructorsFullName: "Alice, Bob, Charlie",
    };
    expect(mapRawToSisCourse(raw).instructors).toEqual([
      "Alice",
      "Bob",
      "Charlie",
    ]);
  });

  it("returns single instructor as array", () => {
    const raw: RawSisCourse = {
      ...fullRaw,
      InstructorsFullName: "Alice",
    };
    expect(mapRawToSisCourse(raw).instructors).toEqual(["Alice"]);
  });

  it("parses prerequisites from SectionDetails prerequisite records", () => {
    const raw: RawSisCourse = {
      ...fullRaw,
      SectionDetails: [
        {
          Prerequisites: [
            {
              Description: "AS.110.108",
              Expression: "",
              IsNegative: false,
            },
            {
              Description: "",
              Expression: "EN.553.171 OR AS.110.201",
              IsNegative: true,
            },
          ],
        },
      ],
    };

    expect(mapRawToSisCourse(raw).prerequisites).toBe(
      "AS.110.108; NOT (EN.553.171 OR AS.110.201)",
    );
  });
});

describe("searchCoursesBySisConstraints", () => {
  it("passes non-empty params to the SIS client", async () => {
    mockFetch.mockResolvedValue([]);

    await searchCoursesBySisConstraints({
      Term: "Fall 2025",
      School: "Whiting School of Engineering",
    });

    expect(mockFetch).toHaveBeenCalledWith({
      Term: "Fall 2025",
      School: "Whiting School of Engineering",
    });
  });

  it("passes array params for repeated SIS query fields", async () => {
    mockFetch.mockResolvedValue([]);

    const multiSchoolParams: SearchCoursesBySisConstraintsParams = {
      Term: "Spring 2026",
      School: [
        "Krieger School of Arts and Sciences",
        "Whiting School of Engineering",
      ],
      Level: ["Lower Level Undergraduate", "Upper Level Undergraduate"],
    };
    await searchCoursesBySisConstraints(multiSchoolParams);

    expect(mockFetch).toHaveBeenCalledWith({
      Term: "Spring 2026",
      School: [
        "Krieger School of Arts and Sciences",
        "Whiting School of Engineering",
      ],
      Level: [
        "Lower Level Undergraduate",
        "Upper Level Undergraduate",
      ],
    });
  });

  it("strips undefined and empty-string params", async () => {
    mockFetch.mockResolvedValue([]);

    await searchCoursesBySisConstraints({
      Term: "Fall 2025",
      School: undefined,
      Department: "",
    });

    expect(mockFetch).toHaveBeenCalledWith({ Term: "Fall 2025" });
  });

  it("returns mapped courses", async () => {
    mockFetch.mockResolvedValue([
      {
        OfferingName: "EN.601.226",
        SectionName: "",
        Title: "Data Structures",
        SchoolName: "Whiting School of Engineering",
        Department: "EN Computer Science",
        Level: "Upper Level Undergraduate",
        TimeOfDay: "morning",
        DOW: "21",
        Location: "Homewood Campus",
        InstructorsFullName: "Ali Madooei",
        Status: "Open",
      },
    ]);

    const result = await searchCoursesBySisConstraints({ Term: "Fall 2025" });

    expect(result.courses).toHaveLength(1);
    expect(result.courses[0].offeringName).toBe("EN.601.226");
    expect(result.courses[0].daysOfWeek).toBe("Mon/Wed/Fri");
    expect(result.courses[0].instructors).toEqual(["Ali Madooei"]);
  });

  it("limits results to the specified limit", async () => {
    const rawCourses = Array.from({ length: 20 }, (_, i) => ({
      OfferingName: `EN.601.${200 + i}`,
      SectionName: "",
      Title: `Course ${i}`,
      SchoolName: "WSE",
      Department: "CS",
      Level: "UG",
      TimeOfDay: "morning",
      DOW: "1",
      Location: "Homewood",
      InstructorsFullName: "Instructor",
      Status: "Open",
    }));
    mockFetch.mockResolvedValue(rawCourses);

    const result = await searchCoursesBySisConstraints({ Term: "Fall 2025" }, 5);
    expect(result.courses).toHaveLength(5);
  });

  it("uses default limit of 10", async () => {
    const rawCourses = Array.from({ length: 15 }, (_, i) => ({
      OfferingName: `EN.601.${200 + i}`,
      SectionName: "",
      Title: `Course ${i}`,
      SchoolName: "WSE",
      Department: "CS",
      Level: "UG",
      TimeOfDay: "morning",
      DOW: "1",
      Location: "Homewood",
      InstructorsFullName: "Instructor",
      Status: "Open",
    }));
    mockFetch.mockResolvedValue(rawCourses);

    const result = await searchCoursesBySisConstraints({ Term: "Fall 2025" });
    expect(result.courses).toHaveLength(10);
  });

  it("returns empty array when API returns no results", async () => {
    mockFetch.mockResolvedValue([]);

    const result = await searchCoursesBySisConstraints({ Term: "Fall 2025" });
    expect(result.courses).toEqual([]);
  });
});
