import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchCourses } from "./search-courses";

const { mockSearchCourseDescriptions, mockSearchCoursesBySisConstraints } = vi.hoisted(() => ({
  mockSearchCourseDescriptions: vi.fn(),
  mockSearchCoursesBySisConstraints: vi.fn(),
}));

vi.mock("./search-course-descriptions", () => ({
  searchCourseDescriptions: mockSearchCourseDescriptions,
}));

vi.mock("./search-courses-by-sis-constraints", () => ({
  searchCoursesBySisConstraints: mockSearchCoursesBySisConstraints,
}));

beforeEach(() => {
  vi.resetAllMocks();
});

describe("searchCourses", () => {
  it("maps semantic-only results to matchType semantic", async () => {
    mockSearchCourseDescriptions.mockResolvedValueOnce({
      results: [
        {
          courseId: "course-1",
          sisOfferingName: "EN.601.226.01",
          code: "EN.601.226",
          title: "Data Structures",
          description: "desc",
          term: "Fall 2025",
          rank: 1,
          relevanceScore: 0.92,
          clearlyMatches: true,
        },
      ],
    });
    mockSearchCoursesBySisConstraints.mockResolvedValueOnce({ courses: [] });

    const result = await searchCourses({ query: "data structures" });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].matchType).toBe("semantic");
    expect(mockSearchCourseDescriptions).toHaveBeenCalledWith({ query: "data structures", limit: 5 });
    expect(mockSearchCoursesBySisConstraints).not.toHaveBeenCalled();
  });

  it("maps SIS-only results to matchType constraint", async () => {
    mockSearchCourseDescriptions.mockResolvedValueOnce({ results: [] });
    mockSearchCoursesBySisConstraints.mockResolvedValueOnce({
      courses: [
        {
          offeringName: "EN.601.226.01",
          sectionName: "01",
          title: "Data Structures",
          description: "",
          schoolName: "Whiting School of Engineering",
          department: "EN Computer Science",
          level: "Upper Level Undergraduate",
          timeOfDay: "morning",
          daysOfWeek: "Mon/Wed/Fri",
          location: "Homewood",
          instructors: ["Ali Madooei"],
          status: "Open",
        },
      ],
    });

    const result = await searchCourses({ Term: "Fall 2025", School: "Whiting School of Engineering" });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      code: "EN.601.226",
      term: "Fall 2025",
      matchType: "constraint",
    });
    expect(mockSearchCoursesBySisConstraints).toHaveBeenCalledWith(
      { Term: "Fall 2025", School: "Whiting School of Engineering" },
      undefined,
    );
    expect(mockSearchCourseDescriptions).not.toHaveBeenCalled();
  });

  it("maps explicit full course code hit to matchType exact", async () => {
    mockSearchCourseDescriptions.mockResolvedValueOnce({ results: [] });
    mockSearchCoursesBySisConstraints.mockResolvedValueOnce({
      courses: [
        {
          offeringName: "EN.601.226.01",
          sectionName: "01",
          title: "Data Structures",
          description: "",
          schoolName: "Whiting School of Engineering",
          department: "EN Computer Science",
          level: "Upper Level Undergraduate",
          timeOfDay: "morning",
          daysOfWeek: "Mon/Wed/Fri",
          location: "Homewood",
          instructors: ["Ali Madooei"],
          status: "Open",
        },
      ],
    });

    const result = await searchCourses({ CourseNumber: "EN.601.226", Term: "Fall 2025" });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].matchType).toBe("exact");
  });

  it("maps overlap between semantic and SIS sets to matchType hybrid", async () => {
    mockSearchCourseDescriptions.mockResolvedValueOnce({
      results: [
        {
          courseId: "course-1",
          sisOfferingName: "EN.601.226.01",
          code: "EN.601.226",
          title: "Data Structures",
          description: "semantic description",
          term: "Fall 2025",
          rank: 1,
          relevanceScore: 0.8,
        },
      ],
    });

    mockSearchCoursesBySisConstraints.mockResolvedValueOnce({
      courses: [
        {
          offeringName: "EN.601.226.01",
          sectionName: "01",
          title: "Data Structures",
          description: "",
          schoolName: "Whiting School of Engineering",
          department: "EN Computer Science",
          level: "Upper Level Undergraduate",
          timeOfDay: "morning",
          daysOfWeek: "Mon/Wed/Fri",
          location: "Homewood",
          instructors: ["Ali Madooei"],
          status: "Open",
        },
      ],
    });

    const result = await searchCourses({
      query: "data structures",
      Term: "Fall 2025",
      School: "Whiting School of Engineering",
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      code: "EN.601.226",
      description: "semantic description",
      matchType: "hybrid",
    });
  });

  it("deduplicates using courseId first, then offering+term, then code+term", async () => {
    mockSearchCourseDescriptions.mockResolvedValueOnce({
      results: [
        {
          courseId: "course-1",
          sisOfferingName: "EN.601.226.01",
          code: "EN.601.226",
          title: "Data Structures",
          description: "semantic description",
          term: "Fall 2025",
          rank: 1,
          relevanceScore: 0.95,
        },
        {
          courseId: "course-2",
          sisOfferingName: "",
          code: "AS.050.100",
          title: "Intro Writing",
          description: "semantic fallback-key row",
          term: "Fall 2025",
          rank: 2,
          relevanceScore: 0.64,
        },
      ],
    });

    mockSearchCoursesBySisConstraints.mockResolvedValueOnce({
      courses: [
        {
          offeringName: "EN.601.226.01",
          sectionName: "01",
          title: "Data Structures",
          description: "",
          schoolName: "Whiting School of Engineering",
          department: "EN Computer Science",
          level: "Upper Level Undergraduate",
          timeOfDay: "morning",
          daysOfWeek: "Mon/Wed/Fri",
          location: "Homewood",
          instructors: ["Ali Madooei"],
          status: "Open",
        },
        {
          offeringName: "AS.050.100",
          sectionName: "01",
          title: "Intro Writing",
          description: "",
          schoolName: "Krieger School of Arts and Sciences",
          department: "Writing",
          level: "Lower Level Undergraduate",
          timeOfDay: "afternoon",
          daysOfWeek: "Tue/Thu",
          location: "Homewood",
          instructors: ["Ada Lovelace"],
          status: "Open",
        },
      ],
    });

    const result = await searchCourses({
      query: "courses",
      Term: "Fall 2025",
      School: "Whiting School of Engineering",
    });

    expect(result.results).toHaveLength(2);
    expect(result.results.map((r) => r.code)).toEqual(["EN.601.226", "AS.050.100"]);
    expect(result.results[0].matchType).toBe("hybrid");
    expect(result.results[1].matchType).toBe("hybrid");
  });

  it("normalizes structured params before SIS search", async () => {
    mockSearchCourseDescriptions.mockResolvedValueOnce({ results: [] });
    mockSearchCoursesBySisConstraints.mockResolvedValueOnce({ courses: [] });

    await searchCourses({
      Term: "Spring 2026",
      Department: "   ",
      Instructor: "Ali Madooei",
      CourseNumber: "EN.601.226",
      days: ["monday", "Wednesday", "NotADay"] as unknown as string[],
      dayMatchType: "all",
    });

    expect(mockSearchCourseDescriptions).not.toHaveBeenCalled();
    expect(mockSearchCoursesBySisConstraints).toHaveBeenCalledWith(
      expect.objectContaining({
        Term: "Spring 2026",
        Instructor: "Madooei",
        CourseNumber: "EN601226",
        DaysOfWeek: "all|5",
      }),
      undefined,
    );
    const sisParams = mockSearchCoursesBySisConstraints.mock.calls[0][0] as Record<string, unknown>;
    expect(sisParams.Department).toBeUndefined();
    expect(sisParams.days).toBeUndefined();
    expect(sisParams.dayMatchType).toBeUndefined();
  });

  it("promotes exact course-code query into structured lookup and skips semantic retrieval", async () => {
    mockSearchCourseDescriptions.mockResolvedValueOnce({ results: [] });
    mockSearchCoursesBySisConstraints.mockResolvedValueOnce({
      courses: [
        {
          offeringName: "EN.601.226.01",
          sectionName: "01",
          title: "Data Structures",
          description: "",
          schoolName: "Whiting School of Engineering",
          department: "EN Computer Science",
          level: "Upper Level Undergraduate",
          timeOfDay: "morning",
          daysOfWeek: "Mon/Wed/Fri",
          location: "Homewood",
          instructors: ["Ali Madooei"],
          status: "Open",
        },
      ],
    });

    const result = await searchCourses({
      query: "Can you tell me about EN.601.226?",
      Term: "Spring 2026",
    });

    expect(mockSearchCourseDescriptions).not.toHaveBeenCalled();
    expect(mockSearchCoursesBySisConstraints).toHaveBeenCalledWith(
      expect.objectContaining({
        CourseNumber: "EN601226",
        Term: "Spring 2026",
      }),
      undefined,
    );
    expect(result.results).toHaveLength(1);
    expect(result.results[0].matchType).toBe("exact");
  });
});
