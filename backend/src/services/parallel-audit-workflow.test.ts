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
      rawPreferencesText: "I prefer Monday morning classes.",
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

  it("includes explicit satisfied or violated preference labels in preference findings", async () => {
    const result = await runParallelAuditWorkflow({
      context: makeContext(),
      evalsByCourse: makeEvals(),
      recommendationCandidates: [],
    });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "preference_alignment",
          violatedPreferences: expect.arrayContaining(["preferred time window"]),
          satisfiedPreferences: expect.arrayContaining(["preferred days"]),
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
});
