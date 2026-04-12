import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RawSisCourse } from "../types/sis";

const { mockFetchSisCourseDetails } = vi.hoisted(() => ({
  mockFetchSisCourseDetails: vi.fn(),
}));

vi.mock("./sis-client", async () => {
  const actual = await vi.importActual<typeof import("./sis-client")>("./sis-client");
  return {
    ...actual,
    fetchSisCourseDetails: mockFetchSisCourseDetails,
  };
});

import { getSisCourseDetails } from "./get-sis-course-details";

const rawCourse: RawSisCourse = {
  OfferingName: "EN.553.171",
  SectionName: "01",
  Title: "Discrete Mathematics",
  SchoolName: "Whiting School of Engineering",
  Department: "Engineering",
  Level: "Upper Level Undergraduate",
  TimeOfDay: "afternoon",
  DOW: "5",
  Location: "Hodson 110",
  InstructorsFullName: "Ada Lovelace, Grace Hopper",
  Status: "Open",
};

describe("getSisCourseDetails", () => {
  beforeEach(() => {
    mockFetchSisCourseDetails.mockReset();
  });

  it("maps a raw SIS course into the stable tool contract", async () => {
    mockFetchSisCourseDetails.mockResolvedValueOnce(rawCourse);

    await expect(
      getSisCourseDetails("en-553-171-01-spring-2026"),
    ).resolves.toEqual({
      courseId: "en-553-171-01-spring-2026",
      course: {
        offeringName: "EN.553.171",
        sectionName: "01",
        title: "Discrete Mathematics",
        description: "",
        schoolName: "Whiting School of Engineering",
        department: "Engineering",
        level: "Upper Level Undergraduate",
        timeOfDay: "afternoon",
        daysOfWeek: "Mon/Wed",
        location: "Hodson 110",
        instructors: ["Ada Lovelace", "Grace Hopper"],
        status: "Open",
      },
    });
  });

  it("returns a deterministic invalid-courseId message without hitting SIS", async () => {
    await expect(getSisCourseDetails("not-a-course")).resolves.toEqual({
      courseId: "not-a-course",
      course: null,
      message:
        "Invalid courseId format. Expected values like en-553-171-spring-2026 or en-553-171-01-spring-2026.",
    });
    expect(mockFetchSisCourseDetails).not.toHaveBeenCalled();
  });

  it("returns the course-not-found fallback when SIS has no match", async () => {
    mockFetchSisCourseDetails.mockResolvedValueOnce(null);

    await expect(
      getSisCourseDetails("en-553-171-spring-2026"),
    ).resolves.toEqual({
      courseId: "en-553-171-spring-2026",
      course: null,
      message: "Course not found",
    });
  });
});
