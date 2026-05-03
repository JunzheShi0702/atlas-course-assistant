import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { runParallelAuditWorkflow } from "./parallel-audit-workflow";
import type { ScheduleAgentContext } from "./schedule-context";
import type { AuditEvalMetrics } from "../types/eval-summary";
import type { RawSisCourse } from "../types/sis";

function makeRawCourse(overrides: Partial<RawSisCourse> = {}): RawSisCourse {
  return {
    OfferingName: "EN.601.226",
    SectionName: "01",
    Title: "Data Structures",
    SchoolName: "Whiting School of Engineering",
    Department: "Computer Science",
    Level: "Upper Level Undergraduate",
    TimeOfDay: "morning",
    DOW: "5",
    Location: "Hackerman",
    InstructorsFullName: "Ada Lovelace",
    Status: "Open",
    StartTimeEndTime: "09:00|10:15",
    ...overrides,
  };
}

function makeContext(overrides: Partial<ScheduleAgentContext> = {}): ScheduleAgentContext {
  return {
    scheduleName: "Spring 2026",
    scheduleTerm: "Spring 2026",
    courses: [
      {
        courseCode: "EN.601.226",
        sisOfferingName: "EN.601.226",
        term: "Spring 2026",
        courseTitle: "Data Structures",
        credits: 3,
      },
      {
        courseCode: "EN.601.315",
        sisOfferingName: "EN.601.315",
        term: "Spring 2026",
        courseTitle: "Databases",
        credits: 3,
      },
    ],
    profile: {
      school: "Whiting School of Engineering",
      degrees: ["B.S. Computer Science"],
      rawGoalsText: "Software engineering",
      rawWorkloadText: "Balanced",
      rawPreferencesText:
        "Times: Early Morning (before 10am), Morning (10am-12pm), Mid Day (12pm-3pm), Afternoon (3pm-6pm), Evening (after 6pm); Days: Mon, Tue, Wed, Thu, Fri",
      derivedMemories: null,
    },
    canonicalMemories: [],
    ...overrides,
  };
}

function makeEvals(overrides: Record<string, AuditEvalMetrics | null> = {}): Record<string, AuditEvalMetrics | null> {
  return {
    "EN.601.226": {
      overallQuality: 4.2,
      teachingEffectiveness: 4.1,
      difficulty: 4.3,
      workload: 4.4,
      feedbackQuality: 3.9,
      sampleSize: 30,
      sectionCount: 1,
    },
    "EN.601.315": {
      overallQuality: 4.0,
      teachingEffectiveness: 4.0,
      difficulty: 4.2,
      workload: 4.1,
      feedbackQuality: 3.8,
      sampleSize: 20,
      sectionCount: 1,
    },
    ...overrides,
  };
}

describe("runParallelAuditWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchSisCourseDetails.mockReset();
    mockFetchSisCourseDetails
      .mockResolvedValue(makeRawCourse())
      .mockResolvedValueOnce(makeRawCourse())
      .mockResolvedValueOnce(
        makeRawCourse({
          OfferingName: "EN.601.315",
          Title: "Databases",
          StartTimeEndTime: "09:30|10:45",
          TimeOfDay: "evening",
        }),
      );
  });

  it("fans out course detail fetches concurrently before synthesis", async () => {
    let resolveFirst: ((value: RawSisCourse | null) => void) | undefined;
    let resolveSecond: ((value: RawSisCourse | null) => void) | undefined;

    mockFetchSisCourseDetails
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );

    const pending = runParallelAuditWorkflow({
      context: makeContext(),
      evalsByCourse: makeEvals(),
      recommendationCandidates: [],
    });

    await Promise.resolve();

    expect(mockFetchSisCourseDetails).toHaveBeenCalledTimes(2);

    resolveFirst?.(makeRawCourse());
    resolveSecond?.(
      makeRawCourse({
        OfferingName: "EN.601.315",
        Title: "Databases",
      }),
    );

    await expect(pending).resolves.toMatchObject({
      findings: expect.any(Array),
    });
  });

  it("returns synthesized findings with category, severity, and evidence", async () => {
    const result = await runParallelAuditWorkflow({
      context: makeContext(),
      evalsByCourse: makeEvals(),
      recommendationCandidates: [],
    });

    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0]).toEqual(
      expect.objectContaining({
        category: expect.any(String),
        severity: expect.any(String),
        evidence: expect.any(Array),
      }),
    );
    expect(result.incompleteChecks).toEqual([]);
  });

  it("emits critical schedule conflict findings when meetings overlap", async () => {
    const result = await runParallelAuditWorkflow({
      context: makeContext(),
      evalsByCourse: makeEvals(),
      recommendationCandidates: [],
    });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "schedule_conflicts",
          severity: "critical",
          title: "Meeting-time overlap detected",
        }),
      ]),
    );
  });

  it("emits an informational preference result when no section conflicts with saved preferences", async () => {
    const result = await runParallelAuditWorkflow({
      context: makeContext(),
      evalsByCourse: makeEvals(),
      recommendationCandidates: [],
    });

    expect(
      result.findings.some(
        (f) =>
          f.category === "preference_alignment" &&
          f.severity === "info" &&
          f.title === "Schedule preferences clear",
      ),
    ).toBe(true);
  });

  it("emits preference findings when a section overlaps excluded clock time from saved chips", async () => {
    mockFetchSisCourseDetails.mockReset();
    mockFetchSisCourseDetails
      .mockResolvedValueOnce(makeRawCourse())
      .mockResolvedValueOnce(
        makeRawCourse({
          OfferingName: "EN.601.315",
          Title: "Databases",
          StartTimeEndTime: "19:00|20:15",
          TimeOfDay: "evening",
        }),
      );

    const result = await runParallelAuditWorkflow({
      context: makeContext({
        profile: {
          ...makeContext().profile!,
          rawPreferencesText:
            "Times: Early Morning (before 10am), Morning (10am-12pm), Mid Day (12pm-3pm), Afternoon (3pm-6pm); Days: Mon, Tue, Wed, Thu, Fri",
        },
      }),
      evalsByCourse: makeEvals(),
      recommendationCandidates: [],
    });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "preference_alignment",
          severity: "warning",
          title: "Schedule preference mismatch",
          violatedPreferences: expect.arrayContaining(["preferred time window"]),
          satisfiedPreferences: [],
          courseCode: "EN.601.315",
        }),
      ]),
    );
  });

  it("honors every structured onboarding time chip, not just the first Morning substring", async () => {
    mockFetchSisCourseDetails.mockReset();
    mockFetchSisCourseDetails
      .mockResolvedValueOnce(
        makeRawCourse({ TimeOfDay: "afternoon", StartTimeEndTime: "15:00|16:00" }),
      )
      .mockResolvedValueOnce(
        makeRawCourse({
          OfferingName: "EN.601.315",
          Title: "Databases",
          TimeOfDay: "evening",
          StartTimeEndTime: "19:00|20:15",
        }),
      );

    const base = makeContext();
    const result = await runParallelAuditWorkflow({
      context: {
        ...base,
        profile: {
          ...base.profile!,
          rawPreferencesText:
            "Times: Early Morning (before 10am), Afternoon (3pm-6pm); Days: Mon, Tue, Wed, Thu, Fri",
        },
      },
      evalsByCourse: makeEvals(),
      recommendationCandidates: [],
    });

    const pref = result.findings.filter((f) => f.category === "preference_alignment");
    expect(pref.some((f) => f.courseCode === "EN.601.226")).toBe(false);
    expect(pref.some((f) => f.courseCode === "EN.601.315")).toBe(true);
  });

  it("flags meetings starting before 10:00 when structured prefs omit Early Morning", async () => {
    mockFetchSisCourseDetails.mockReset();
    mockFetchSisCourseDetails.mockResolvedValue(
      makeRawCourse({
        OfferingName: "AS.110.301",
        Title: "Elementary Number Theory",
        TimeOfDay: "morning",
        StartTimeEndTime: "09:00|10:15",
        DOW: "1",
      }),
    );

    const base = makeContext({
      courses: [
        {
          courseCode: "AS.110.301",
          sisOfferingName: "AS.110.301",
          term: "Spring 2026",
          courseTitle: "Elementary Number Theory",
          credits: 3,
        },
      ],
    });
    const result = await runParallelAuditWorkflow({
      context: {
        ...base,
        profile: {
          ...base.profile!,
          rawPreferencesText:
            "Times: Morning (10am-12pm), Mid Day (12pm-3pm); Days: Mon, Tue, Wed, Thu, Fri",
        },
      },
      evalsByCourse: {
        ...makeEvals(),
        "EN.601.226": null,
        "EN.601.315": null,
        "AS.110.301": makeEvals()["EN.601.226"],
      },
      recommendationCandidates: [],
    });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "preference_alignment",
          courseCode: "AS.110.301",
          summary: expect.stringMatching(/outside your saved class-time chips|10:00/i),
        }),
      ]),
    );
  });

  it("does not flag before-10 meetings when Early Morning is among structured prefs", async () => {
    mockFetchSisCourseDetails.mockReset();
    mockFetchSisCourseDetails.mockResolvedValue(
      makeRawCourse({
        OfferingName: "AS.110.301",
        Title: "Elementary Number Theory",
        TimeOfDay: "morning",
        StartTimeEndTime: "09:00|10:15",
        DOW: "1",
      }),
    );

    const base = makeContext({
      courses: [
        {
          courseCode: "AS.110.301",
          sisOfferingName: "AS.110.301",
          term: "Spring 2026",
          courseTitle: "Elementary Number Theory",
          credits: 3,
        },
      ],
    });
    const result = await runParallelAuditWorkflow({
      context: {
        ...base,
        profile: {
          ...base.profile!,
          rawPreferencesText:
            "Times: Early Morning (before 10am), Morning (10am-12pm); Days: Mon, Tue, Wed, Thu, Fri",
        },
      },
      evalsByCourse: {
        ...makeEvals(),
        "EN.601.226": null,
        "EN.601.315": null,
        "AS.110.301": makeEvals()["EN.601.226"],
      },
      recommendationCandidates: [],
    });

    expect(
      result.findings.filter((f) => f.category === "preference_alignment" && f.severity === "warning"),
    ).toEqual([]);
    expect(
      result.findings.some(
        (f) =>
          f.category === "preference_alignment" &&
          f.severity === "info" &&
          f.title === "Schedule preferences clear",
      ),
    ).toBe(true);
  });

  it("uses SIS Meetings when pipe StartTimeEndTime is missing to detect before-10 time conflicts", async () => {
    mockFetchSisCourseDetails.mockReset();
    mockFetchSisCourseDetails.mockResolvedValue(
      makeRawCourse({
        OfferingName: "AS.110.304",
        Title: "Sample",
        DOW: "2",
        StartTimeEndTime: "",
        Meetings: "T 9:00-10:15AM",
        TimeOfDay: "morning",
      }),
    );

    const base = makeContext({
      courses: [
        {
          courseCode: "AS.110.304",
          sisOfferingName: "AS.110.304",
          term: "Spring 2026",
          courseTitle: "Sample",
          credits: 3,
        },
      ],
    });
    const result = await runParallelAuditWorkflow({
      context: {
        ...base,
        profile: {
          ...base.profile!,
          rawPreferencesText:
            "Times: Morning (10am-12pm), Mid Day (12pm-3pm); Days: Mon, Tue, Wed, Thu, Fri",
        },
      },
      evalsByCourse: {
        ...makeEvals(),
        "EN.601.226": null,
        "EN.601.315": null,
        "AS.110.304": makeEvals()["EN.601.226"],
      },
      recommendationCandidates: [],
    });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "preference_alignment",
          courseCode: "AS.110.304",
          violatedPreferences: expect.arrayContaining(["preferred time window"]),
        }),
      ]),
    );
  });

  it("flags meetings on calendar days outside the structured Days list", async () => {
    mockFetchSisCourseDetails.mockReset();
    mockFetchSisCourseDetails.mockResolvedValue(
      makeRawCourse({
        OfferingName: "AS.050.100",
        Title: "Saturday Seminar",
        DOW: "32",
        TimeOfDay: "morning",
        StartTimeEndTime: "10:00|11:15",
      }),
    );

    const base = makeContext({
      courses: [
        {
          courseCode: "AS.050.100",
          sisOfferingName: "AS.050.100",
          term: "Spring 2026",
          courseTitle: "Saturday Seminar",
          credits: 1,
        },
      ],
    });
    const result = await runParallelAuditWorkflow({
      context: {
        ...base,
        profile: {
          ...base.profile!,
          rawPreferencesText:
            "Times: Morning (10am-12pm); Days: Mon, Tue, Wed, Thu, Fri",
        },
      },
      evalsByCourse: {
        ...makeEvals(),
        "EN.601.226": null,
        "EN.601.315": null,
        "AS.050.100": makeEvals()["EN.601.226"],
      },
      recommendationCandidates: [],
    });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "preference_alignment",
          courseCode: "AS.050.100",
          violatedPreferences: expect.arrayContaining(["preferred days"]),
        }),
      ]),
    );
  });

  it("includes a provisional prerequisite finding in the stable output contract", async () => {
    const result = await runParallelAuditWorkflow({
      context: makeContext(),
      evalsByCourse: makeEvals(),
      recommendationCandidates: [],
    });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "prerequisites",
          severity: "info",
        }),
      ]),
    );
  });

  it("isolates a failed check and preserves successful findings for mixed audit results", async () => {
    const result = await runParallelAuditWorkflow({
      context: makeContext(),
      evalsByCourse: makeEvals(),
      recommendationCandidates: [],
      checkRunners: {
        prerequisites: async () => {
          throw new Error("prereq lookup failed");
        },
      },
    });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "workload",
        }),
      ]),
    );
    expect(result.incompleteChecks).toEqual([
      {
        category: "prerequisites",
        status: "failed",
        errorCode: "check_execution_failed",
        message:
          "The prerequisite check could not complete, so prerequisite findings may be incomplete.",
      },
    ]);
  });

  it("returns deterministic incomplete metadata when shared course-detail loading fails", async () => {
    mockFetchSisCourseDetails.mockReset();
    mockFetchSisCourseDetails.mockRejectedValue(new Error("SIS down"));

    const result = await runParallelAuditWorkflow({
      context: makeContext({
        courses: [
          {
            courseCode: "EN.601.226",
            sisOfferingName: "EN.601.226",
            term: "Spring 2026",
            courseTitle: "Data Structures",
            credits: 3,
          },
        ],
      }),
      evalsByCourse: makeEvals({
        "EN.601.315": null,
      }),
      recommendationCandidates: [],
    });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "workload",
        }),
        expect.objectContaining({
          category: "prerequisites",
        }),
      ]),
    );
    expect(result.incompleteChecks).toEqual([
      {
        category: "preference_alignment",
        status: "failed",
        errorCode: "check_execution_failed",
        message:
          "The preference-alignment check could not complete, so preference findings may be incomplete.",
      },
      {
        category: "schedule_conflicts",
        status: "failed",
        errorCode: "check_execution_failed",
        message:
          "The schedule-conflict check could not complete, so overlap findings may be incomplete.",
      },
    ]);
  });
});
