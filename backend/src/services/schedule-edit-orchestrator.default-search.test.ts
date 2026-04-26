import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSearchCoursesBySisConstraints, mockSearchCourseDescriptions } = vi.hoisted(() => ({
  mockSearchCoursesBySisConstraints: vi.fn(),
  mockSearchCourseDescriptions: vi.fn(),
}));

vi.mock("../tools/search-courses-by-sis-constraints", () => ({
  searchCoursesBySisConstraints: mockSearchCoursesBySisConstraints,
}));

vi.mock("../tools/search-course-descriptions", () => ({
  searchCourseDescriptions: mockSearchCourseDescriptions,
}));

import { handleScheduleEditMessage } from "./schedule-edit-orchestrator";

describe("handleScheduleEditMessage default SIS lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchCourseDescriptions.mockResolvedValue({ results: [] });
  });

  it("keeps school-prefixed course numbers when resolving explicit codes", async () => {
    mockSearchCoursesBySisConstraints.mockResolvedValueOnce({
      courses: [
        {
          offeringName: "EN.540.202",
          sectionName: "01",
          title: "Data Engineering",
          description: "",
          schoolName: "Whiting School of Engineering",
          department: "Computer Science",
          level: "Upper Level Undergraduate",
          timeOfDay: "afternoon",
          daysOfWeek: "Mon/Wed",
          location: "Malone Hall",
          instructors: [],
          status: "Open",
        },
      ],
    });

    const out = await handleScheduleEditMessage(
      {
        userId: "user-1",
        scheduleId: "sched-1",
        message: "add EN.540.202 in Spring 2026",
      },
      {
        loadContext: vi.fn().mockResolvedValue({
          ok: true,
          context: {
            scheduleName: "Main",
            scheduleTerm: "Spring 2026",
            courses: [],
            profile: null,
          },
        }),
        runModify: vi.fn().mockResolvedValue({
          ok: true,
          needsClarification: false,
          added: [{ courseCode: "540.202", sisOfferingName: "EN.540.202", term: "Spring 2026" }],
          removed: [],
          failed: [],
        }),
      },
    );

    expect(out.handled).toBe(true);
    expect(mockSearchCoursesBySisConstraints).toHaveBeenCalledWith(
      expect.objectContaining({
        Term: "Spring 2026",
        CourseNumber: "EN.540.202",
      }),
      8,
    );
  });
});
