import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockQuery,
  mockGenerateObject,
  mockLoadContext,
  mockBuildAuditRecommendationCandidates,
  mockFetchSisCourseDetails,
} = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockGenerateObject: vi.fn(),
  mockLoadContext: vi.fn(),
  mockBuildAuditRecommendationCandidates: vi.fn(),
  mockFetchSisCourseDetails: vi.fn(),
}));

vi.mock("../db", () => ({ pool: { query: mockQuery } }));
vi.mock("ai", () => ({ generateObject: mockGenerateObject }));
vi.mock("@ai-sdk/openai", () => ({ openai: vi.fn(() => "mock-model") }));
vi.mock("../services/schedule-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/schedule-context")>();
  return { ...actual, loadScheduleContextForAgent: mockLoadContext };
});
vi.mock("../services/audit-recommendations", () => ({
  buildAuditRecommendationCandidates: mockBuildAuditRecommendationCandidates,
}));
vi.mock("../services/sis-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/sis-client")>();
  return {
    ...actual,
    fetchSisCourseDetails: mockFetchSisCourseDetails,
  };
});

import express from "express";
import request from "supertest";
import schedulesRouter from "./schedules";
import { ScheduleAuditResult } from "../types/database";

const OWNER_ID = "00000000-0000-0000-0000-000000000001";
const SCHEDULE_ID = "aaaaaaaa-0000-0000-0000-000000000001";

const mockAuditResult: ScheduleAuditResult = {
  workloadRange: { min: 15, max: 22 },
  difficulty: 3.4,
  feasibilityLabel: "moderate",
  narrativeSummary: "A moderate schedule.",
  goalAlignment: {
    score: 4,
    rationale: "The schedule mostly supports the student's goals.",
    alignedGoals: ["ML research preparation"],
    conflicts: [],
  },
  recommendations: [
    {
      courseCode: "EN.601.320",
      sisOfferingName: "EN.601.320",
      term: "Spring 2026",
      title: "Parallel Programming",
    },
  ],
};

const mockLlmAuditObject = {
  difficulty: 3.4,
  feasibilityLabel: "moderate" as const,
  narrativeSummary: "A moderate schedule.",
  goalAlignment: {
    score: 4,
    rationale: "The schedule mostly supports the student's goals.",
    alignedGoals: ["ML research preparation"],
    conflicts: [],
  },
  recommendations: ["EN.601.320"],
};

const mockContext = {
  scheduleName: "Spring 2026 - Main",
  scheduleTerm: "Spring 2026",
  courses: [
    { courseCode: "EN.601.226", sisOfferingName: "EN.601.226", term: "Spring 2026", courseTitle: "Data Structures" },
  ],
  profile: null,
  canonicalMemories: [] as { memory_text: string; memory_type: string; source: string }[],
};

function makeApp(userId?: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (userId) (req as express.Request & { user?: { id: string; email: string } }).user = { id: userId, email: "test@jhu.edu" };
    next();
  });
  app.use("/api/schedules", schedulesRouter);
  return app;
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGenerateObject.mockReset();
  mockLoadContext.mockReset();
  mockBuildAuditRecommendationCandidates.mockReset();
  mockFetchSisCourseDetails.mockReset();
  mockBuildAuditRecommendationCandidates.mockResolvedValue([
    {
      courseCode: "EN.601.320",
      sisOfferingName: "EN.601.320",
      term: "Spring 2026",
      title: "Parallel Programming",
      overallQuality: 4.5,
      workload: 3.1,
      difficulty: 3.4,
      respondentCount: 30,
    },
  ]);
});

describe("GET /api/schedules/:id/events", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(makeApp()).get(`/api/schedules/${SCHEDULE_ID}/events`);

    expect(res.status).toBe(401);
  });

  it("returns 404 when schedule is not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(makeApp(OWNER_ID)).get(`/api/schedules/${SCHEDULE_ID}/events`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Schedule not found");
  });

  it("returns 403 for non-owner", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: "different-user" }] });

    const res = await request(makeApp(OWNER_ID)).get(`/api/schedules/${SCHEDULE_ID}/events`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Forbidden");
  });

  it("returns empty events array for schedules with no courses", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(makeApp(OWNER_ID)).get(`/api/schedules/${SCHEDULE_ID}/events`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ events: [] });
    expect(mockFetchSisCourseDetails).not.toHaveBeenCalled();
  });

  it("returns normalized weekly events for courses with SIS meeting data", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID }] })
      .mockResolvedValueOnce({
        rows: [
          {
            course_code: "EN.601.226",
            sis_offering_name: "EN.601.226",
            term: "Spring 2026",
            title: "Data Structures",
          },
        ],
      });

    mockFetchSisCourseDetails.mockResolvedValueOnce({
      DOW: "5",
      Meetings: "M 3:30PM - 5:20PM, W 3:30PM - 5:20PM",
      Title: "Data Structures",
      Location: "Malone 228",
    });

    const res = await request(makeApp(OWNER_ID)).get(`/api/schedules/${SCHEDULE_ID}/events`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(2);
    expect(res.body.events[0]).toMatchObject({
      eventId: `${SCHEDULE_ID}:EN.601.226:Monday:15:30:17:20`,
      dayOfWeek: "Monday",
      startTime: "15:30",
      endTime: "17:20",
      courseCode: "EN.601.226",
      courseTitle: "Data Structures",
      location: "Malone 228",
    });
    expect(res.body.events[1]).toMatchObject({
      eventId: `${SCHEDULE_ID}:EN.601.226:Wednesday:15:30:17:20`,
      dayOfWeek: "Wednesday",
      startTime: "15:30",
      endTime: "17:20",
      courseCode: "EN.601.226",
    });

    // Contract freeze guard: keep stable top-level field names and nullable shape.
    expect(Object.keys(res.body.events[0]).sort()).toEqual([
      "courseCode",
      "courseTitle",
      "dayOfWeek",
      "endTime",
      "eventId",
      "location",
      "startTime",
    ]);
  });

  it("returns events in deterministic sorted order", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID }] })
      .mockResolvedValueOnce({
        rows: [
          {
            course_code: "EN.601.300",
            sis_offering_name: "EN.601.300",
            term: "Spring 2026",
            title: "Late Monday",
          },
          {
            course_code: "EN.601.100",
            sis_offering_name: "EN.601.100",
            term: "Spring 2026",
            title: "Unknown slot",
          },
          {
            course_code: "EN.601.200",
            sis_offering_name: "EN.601.200",
            term: "Spring 2026",
            title: "Early Monday",
          },
        ],
      });

    mockFetchSisCourseDetails
      .mockResolvedValueOnce({
        DOW: "1",
        Meetings: "M 11:00AM - 12:00PM",
        Title: "Late Monday",
        Location: "Malone 200",
      })
      .mockResolvedValueOnce({
        DOW: "",
        Meetings: "TBA",
        Title: "Unknown slot",
        Location: "",
      })
      .mockResolvedValueOnce({
        DOW: "1",
        Meetings: "M 8:00AM - 9:00AM",
        Title: "Early Monday",
        Location: "Malone 100",
      });

    const res = await request(makeApp(OWNER_ID)).get(`/api/schedules/${SCHEDULE_ID}/events`);

    expect(res.status).toBe(200);
    expect(res.body.events.map((event: { courseCode: string; startTime: string | null }) => ({
      courseCode: event.courseCode,
      startTime: event.startTime,
    }))).toEqual([
      { courseCode: "EN.601.200", startTime: "08:00" },
      { courseCode: "EN.601.300", startTime: "11:00" },
      { courseCode: "EN.601.100", startTime: null },
    ]);
  });

  it("returns deterministic nulls for missing SIS fields", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID }] })
      .mockResolvedValueOnce({
        rows: [
          {
            course_code: "EN.601.999",
            sis_offering_name: "EN.601.999",
            term: "Spring 2026",
            title: "",
          },
        ],
      });

    mockFetchSisCourseDetails.mockResolvedValueOnce({
      DOW: "",
      Meetings: "TBA",
      Title: "",
      Location: "",
    });

    const res = await request(makeApp(OWNER_ID)).get(`/api/schedules/${SCHEDULE_ID}/events`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0]).toMatchObject({
      eventId: `${SCHEDULE_ID}:EN.601.999:unknown`,
      dayOfWeek: null,
      startTime: null,
      endTime: null,
      courseCode: "EN.601.999",
      courseTitle: "EN.601.999",
      location: null,
    });
  });

  it("falls back to SIS title when schedule course title is missing", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID }] })
      .mockResolvedValueOnce({
        rows: [
          {
            course_code: "EN.601.777",
            sis_offering_name: "EN.601.777",
            term: "Spring 2026",
            title: null,
          },
        ],
      });

    mockFetchSisCourseDetails.mockResolvedValueOnce({
      DOW: "2",
      Meetings: "T 9:00AM - 10:15AM",
      Title: "Algorithms for Data Science",
      Location: "Malone 221",
    });

    const res = await request(makeApp(OWNER_ID)).get(`/api/schedules/${SCHEDULE_ID}/events`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0]).toMatchObject({
      courseCode: "EN.601.777",
      courseTitle: "Algorithms for Data Science",
      dayOfWeek: "Tuesday",
      startTime: "09:00",
      endTime: "10:15",
      location: "Malone 221",
    });
  });

  it("converts 12-hour SIS meeting times to 24-hour format around midnight and noon", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID }] })
      .mockResolvedValueOnce({
        rows: [
          {
            course_code: "EN.601.888",
            sis_offering_name: "EN.601.888",
            term: "Spring 2026",
            title: "Systems Lab",
          },
          {
            course_code: "EN.601.889",
            sis_offering_name: "EN.601.889",
            term: "Spring 2026",
            title: "Applied Logic",
          },
        ],
      });

    mockFetchSisCourseDetails
      .mockResolvedValueOnce({
        DOW: "16",
        Meetings: "F 12:00AM - 1:15AM",
        Title: "Systems Lab",
        Location: "Hackerman 100",
      })
      .mockResolvedValueOnce({
        DOW: "8",
        Meetings: "Th 12:00PM - 1:15PM",
        Title: "Applied Logic",
        Location: "Malone 303",
      });

    const res = await request(makeApp(OWNER_ID)).get(`/api/schedules/${SCHEDULE_ID}/events`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(2);
    const fridayEvent = res.body.events.find((event: { dayOfWeek: string }) => event.dayOfWeek === "Friday");
    const thursdayEvent = res.body.events.find((event: { dayOfWeek: string }) => event.dayOfWeek === "Thursday");

    expect(fridayEvent).toBeDefined();
    expect(thursdayEvent).toBeDefined();
    expect(fridayEvent).toMatchObject({
      dayOfWeek: "Friday",
      startTime: "00:00",
      endTime: "01:15",
      courseCode: "EN.601.888",
    });
    expect(thursdayEvent).toMatchObject({
      dayOfWeek: "Thursday",
      startTime: "12:00",
      endTime: "13:15",
      courseCode: "EN.601.889",
    });
  });

  it("returns deterministic null event fields when SIS detail fetch fails", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID }] })
      .mockResolvedValueOnce({
        rows: [
          {
            course_code: "EN.601.226",
            sis_offering_name: "EN.601.226",
            term: "Spring 2026",
            title: "Data Structures",
          },
        ],
      });

    mockFetchSisCourseDetails.mockRejectedValueOnce(new Error("SIS unavailable"));

    const res = await request(makeApp(OWNER_ID)).get(`/api/schedules/${SCHEDULE_ID}/events`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0]).toMatchObject({
      dayOfWeek: null,
      startTime: null,
      endTime: null,
      courseCode: "EN.601.226",
      courseTitle: "Data Structures",
      location: null,
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/schedules/:id/audit
// ---------------------------------------------------------------------------

describe("POST /api/schedules/:id/audit", () => {
  it("returns 401 when not authenticated", async () => {
    const app = makeApp(); // no user
    const res = await request(app).post(`/api/schedules/${SCHEDULE_ID}/audit`);
    expect(res.status).toBe(401);
  });

  it("returns 404 when schedule not found", async () => {
    mockLoadContext.mockResolvedValue({ ok: false, error: "not_found" });
    const app = makeApp(OWNER_ID);
    const res = await request(app).post(`/api/schedules/${SCHEDULE_ID}/audit`);
    expect(res.status).toBe(404);
  });

  it("returns 403 when user does not own the schedule", async () => {
    mockLoadContext.mockResolvedValue({ ok: false, error: "forbidden" });
    const app = makeApp(OWNER_ID);
    const res = await request(app).post(`/api/schedules/${SCHEDULE_ID}/audit`);
    expect(res.status).toBe(403);
  });

  it("returns 200 with result on success", async () => {
    mockLoadContext.mockResolvedValue({ ok: true, context: mockContext });
    // eval query returns empty (no eval data for this course)
    mockQuery.mockResolvedValue({ rows: [] });
    // second call: INSERT into schedule_audits
    mockQuery.mockResolvedValueOnce({ rows: [] }); // eval query
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "audit-1" }] }); // INSERT
    mockGenerateObject.mockResolvedValue({ object: mockLlmAuditObject });

    const app = makeApp(OWNER_ID);
    const res = await request(app).post(`/api/schedules/${SCHEDULE_ID}/audit`);

    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ feasibilityLabel: "moderate" });
    expect(res.body.result.goalAlignment).toMatchObject({ score: 4 });
    expect(res.body.result.recommendations).toHaveLength(1);
  });

  it("returns 500 when LLM throws", async () => {
    mockLoadContext.mockResolvedValue({ ok: true, context: mockContext });
    mockQuery.mockResolvedValue({ rows: [] });
    mockGenerateObject.mockRejectedValue(new Error("LLM failure"));

    const app = makeApp(OWNER_ID);
    const res = await request(app).post(`/api/schedules/${SCHEDULE_ID}/audit`);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("The server could not complete the workload audit");
  });

  it("persists audit to schedule_audits on success", async () => {
    mockLoadContext.mockResolvedValue({ ok: true, context: mockContext });
    mockQuery
      .mockResolvedValueOnce({ rows: [] })           // eval query
      .mockResolvedValueOnce({ rows: [{ id: "audit-1" }] }); // INSERT
    mockGenerateObject.mockResolvedValue({ object: mockLlmAuditObject });

    const app = makeApp(OWNER_ID);
    await request(app).post(`/api/schedules/${SCHEDULE_ID}/audit`);

    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      typeof sql === "string" && sql.includes("INSERT INTO schedule_audits"),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1][0]).toBe(SCHEDULE_ID);
  });

  it("handles courses with no eval data", async () => {
    mockLoadContext.mockResolvedValue({ ok: true, context: mockContext });
    mockQuery
      .mockResolvedValueOnce({ rows: [] })           // eval query returns empty → null metrics
      .mockResolvedValueOnce({ rows: [{ id: "audit-2" }] }); // INSERT
    mockGenerateObject.mockResolvedValue({
      object: {
        ...mockLlmAuditObject,
        goalAlignment: {
          score: null,
          rationale: "Insufficient data to align recommendations confidently.",
          alignedGoals: [],
          conflicts: [],
        },
        recommendations: [],
      },
    });

    const app = makeApp(OWNER_ID);
    const res = await request(app).post(`/api/schedules/${SCHEDULE_ID}/audit`);

    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ narrativeSummary: "A moderate schedule." });
    expect(res.body.result.goalAlignment).toMatchObject({ score: null });
    expect(res.body.result.recommendations).toEqual([]);
    // generateObject was still called despite missing eval data
    expect(mockGenerateObject).toHaveBeenCalledOnce();
  });

  it("returns explicit goal alignment when goals are absent", async () => {
    mockLoadContext.mockResolvedValue({
      ok: true,
      context: {
        ...mockContext,
        profile: null,
        canonicalMemories: [],
      },
    });
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "audit-4" }] });
    mockGenerateObject.mockResolvedValue({
      object: {
        ...mockLlmAuditObject,
        goalAlignment: {
          score: null,
          rationale: "No explicit goals were available.",
          alignedGoals: [],
          conflicts: [],
        },
        recommendations: [],
      },
    });

    const res = await request(makeApp(OWNER_ID)).post(`/api/schedules/${SCHEDULE_ID}/audit`);

    expect(res.status).toBe(200);
    expect(res.body.result.goalAlignment).toEqual({
      score: null,
      rationale: "No explicit goals were available.",
      alignedGoals: [],
      conflicts: [],
    });
    expect(res.body.result.recommendations).toEqual([]);
  });

  it("passes weighted, null-safe audit metrics into the prompt", async () => {
    mockLoadContext.mockResolvedValue({
      ok: true,
      context: {
        ...mockContext,
        courses: [
          { courseCode: "EN.601.226", sisOfferingName: "EN.601.226", term: "Spring 2026", courseTitle: "Data Structures", credits: 3 },
        ],
      },
    });
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            overall_quality: "4.0",
            teaching_effectiveness: "4.5",
            intellectual_challange: null,
            work_load: "5.0",
            feedback_quality: null,
            num_respondents: 10,
            semester: "Spring 2025",
            instructor: "A",
          },
          {
            overall_quality: "2.0",
            teaching_effectiveness: "3.5",
            intellectual_challange: null,
            work_load: "3.0",
            feedback_quality: null,
            num_respondents: 30,
            semester: "Fall 2024",
            instructor: "B",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: "audit-3" }] });
    mockGenerateObject.mockResolvedValue({ object: mockLlmAuditObject });

    const res = await request(makeApp(OWNER_ID)).post(`/api/schedules/${SCHEDULE_ID}/audit`);

    expect(res.status).toBe(200);
    const generateCall = mockGenerateObject.mock.calls[0][0];
    expect(generateCall.prompt).toContain("| EN.601.226 | Data Structures | 3 | 3.50 | n/a | 2.50 | n/a | 40 |");
    expect(generateCall.prompt).toContain("partial evaluation data; missing difficulty, feedback.");
  });
});

// ---------------------------------------------------------------------------
// GET /api/schedules/:id
// ---------------------------------------------------------------------------

const AUDIT_ID = "cccccccc-0000-0000-0000-000000000001";
const AUDIT_CREATED_AT = new Date("2026-03-01T12:00:00Z");

const schedRow = {
  id: SCHEDULE_ID,
  name: "Spring 2026 - Main",
  term: "Spring 2026",
  user_id: OWNER_ID,
  created_at: new Date("2026-01-01T00:00:00Z"),
  updated_at: new Date("2026-01-01T00:00:00Z"),
};

describe("GET /api/schedules/:id", () => {
  it("includes latestAudit with id, createdAt, and result when an audit exists", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [schedRow] })         // schedules lookup
      .mockResolvedValueOnce({ rows: [] })                  // schedule_courses
      .mockResolvedValueOnce({ rows: [{                     // schedule_audits
        id: AUDIT_ID,
        created_at: AUDIT_CREATED_AT,
        result: mockAuditResult,
      }] });

    const app = makeApp(OWNER_ID);
    const res = await request(app).get(`/api/schedules/${SCHEDULE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.latestAudit).toMatchObject({
      id: AUDIT_ID,
      result: { feasibilityLabel: "moderate", narrativeSummary: "A moderate schedule." },
    });
    expect(res.body.latestAudit.createdAt).toBeDefined();
  });

  it("sets latestAudit to null when no audit exists", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [schedRow] })  // schedules lookup
      .mockResolvedValueOnce({ rows: [] })           // schedule_courses
      .mockResolvedValueOnce({ rows: [] });          // schedule_audits — empty

    const app = makeApp(OWNER_ID);
    const res = await request(app).get(`/api/schedules/${SCHEDULE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.latestAudit).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Remaining schedules CRUD + course add/remove paths
// ---------------------------------------------------------------------------

describe("GET /api/schedules", () => {
  it("returns schedules for the authenticated user", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: SCHEDULE_ID,
          name: "Spring 2026 - Main",
          term: "Spring 2026",
          created_at: new Date("2026-01-01T00:00:00Z"),
          updated_at: new Date("2026-01-02T00:00:00Z"),
        },
      ],
    });

    const res = await request(makeApp(OWNER_ID)).get("/api/schedules");

    expect(res.status).toBe(200);
    expect(res.body.schedules).toHaveLength(1);
    expect(res.body.schedules[0]).toMatchObject({
      id: SCHEDULE_ID,
      name: "Spring 2026 - Main",
      term: "Spring 2026",
    });
    expect(mockQuery.mock.calls[0][1]).toEqual([OWNER_ID]);
  });
});

describe("POST /api/schedules", () => {
  it("returns 400 when request body is invalid", async () => {
    const res = await request(makeApp(OWNER_ID)).post("/api/schedules").send({ name: "" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "name and term are required" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("creates a schedule and returns 201", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: SCHEDULE_ID,
          name: "My Plan",
          term: "Spring 2026",
          created_at: new Date("2026-01-01T00:00:00Z"),
          updated_at: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    });

    const res = await request(makeApp(OWNER_ID))
      .post("/api/schedules")
      .send({ name: "My Plan", term: "Spring 2026" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: SCHEDULE_ID,
      name: "My Plan",
      term: "Spring 2026",
    });
  });
});

describe("DELETE /api/schedules/:id", () => {
  it("returns 404 when schedule does not exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(makeApp(OWNER_ID)).delete(`/api/schedules/${SCHEDULE_ID}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Schedule not found" });
  });

  it("returns 403 for non-owner", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ user_id: "00000000-0000-0000-0000-000000000999" }],
    });

    const res = await request(makeApp(OWNER_ID)).delete(`/api/schedules/${SCHEDULE_ID}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Forbidden" });
  });

  it("deletes owned schedule and returns 204", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(makeApp(OWNER_ID)).delete(`/api/schedules/${SCHEDULE_ID}`);

    expect(res.status).toBe(204);
    const deleteCall = mockQuery.mock.calls.find(([sql]) =>
      typeof sql === "string" && sql.includes("DELETE FROM schedules"),
    );
    expect(deleteCall).toBeDefined();
  });
});

describe("POST /api/schedules/:id/courses", () => {
  it("returns 400 when body is invalid", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID }] });

    const res = await request(makeApp(OWNER_ID))
      .post(`/api/schedules/${SCHEDULE_ID}/courses`)
      .send({ courseCode: "EN.601.226" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "courseCode, sisOfferingName, and term are required" });
  });

  it("adds course and returns 201", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(makeApp(OWNER_ID))
      .post(`/api/schedules/${SCHEDULE_ID}/courses`)
      .send({
        courseCode: "EN.601.226",
        sisOfferingName: "EN.601.226",
        term: "Spring 2026",
        courseTitle: "Data Structures",
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
  });
});

describe("DELETE /api/schedules/:id/courses", () => {
  it("returns 400 when body is invalid", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID }] });

    const res = await request(makeApp(OWNER_ID))
      .delete(`/api/schedules/${SCHEDULE_ID}/courses`)
      .send({ courseCode: "EN.601.226" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "courseCode, sisOfferingName, and term are required" });
  });

  it("removes course and returns 204", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(makeApp(OWNER_ID))
      .delete(`/api/schedules/${SCHEDULE_ID}/courses`)
      .send({
        courseCode: "EN.601.226",
        sisOfferingName: "EN.601.226",
        term: "Spring 2026",
      });

    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// GET /api/schedules/:id/chat
// ---------------------------------------------------------------------------

const CHAT_STATE_ID = "bbbbbbbb-0000-0000-0000-000000000001";

describe("GET /api/schedules/:id/chat", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeApp()).get(`/api/schedules/${SCHEDULE_ID}/chat`);
    expect(res.status).toBe(401);
  });

  it("returns 404 when schedule does not exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // schedules lookup
    const res = await request(makeApp(OWNER_ID)).get(`/api/schedules/${SCHEDULE_ID}/chat`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Schedule not found" });
  });

  it("returns 403 when schedule belongs to a different user", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: "different-user" }] });
    const res = await request(makeApp(OWNER_ID)).get(`/api/schedules/${SCHEDULE_ID}/chat`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Forbidden" });
  });

  it("returns empty history when no chat state exists yet", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID }] }); // schedules
    mockQuery.mockResolvedValueOnce({ rows: [] });                        // schedule_chat_state

    const res = await request(makeApp(OWNER_ID)).get(`/api/schedules/${SCHEDULE_ID}/chat`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ rollingSummary: "", messages: [] });
  });

  it("returns rollingSummary and messages in chronological order", async () => {
    const now = new Date();
    const msg1 = { id: "msg-1", role: "user",      content: "hi",    response_type: null, metadata: {}, created_at: now };
    const msg2 = { id: "msg-2", role: "assistant",  content: "hello", response_type: "text", metadata: { type: "text" }, created_at: now };

    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CHAT_STATE_ID, rolling_summary: "prior summary" }] });
    mockQuery.mockResolvedValueOnce({ rows: [msg1, msg2] });

    const res = await request(makeApp(OWNER_ID)).get(`/api/schedules/${SCHEDULE_ID}/chat`);
    expect(res.status).toBe(200);
    expect(res.body.rollingSummary).toBe("prior summary");
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.messages[0].id).toBe("msg-1");
    expect(res.body.messages[1].id).toBe("msg-2");
    expect(res.body.messages[1].responseType).toBe("text");
  });

  it("queries messages by chatStateId, not scheduleId", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CHAT_STATE_ID, rolling_summary: "" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await request(makeApp(OWNER_ID)).get(`/api/schedules/${SCHEDULE_ID}/chat`);

    const msgQuery = mockQuery.mock.calls.find(([sql]) =>
      typeof sql === "string" && sql.includes("FROM schedule_chat_messages"),
    );
    expect(msgQuery).toBeDefined();
    expect(msgQuery![1]).toEqual([CHAT_STATE_ID]);
  });
});
