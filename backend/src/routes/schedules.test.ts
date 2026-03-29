import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockQuery, mockGenerateObject, mockLoadContext } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockGenerateObject: vi.fn(),
  mockLoadContext: vi.fn(),
}));

vi.mock("../db", () => ({ pool: { query: mockQuery } }));
vi.mock("ai", () => ({ generateObject: mockGenerateObject }));
vi.mock("@ai-sdk/openai", () => ({ openai: vi.fn(() => "mock-model") }));
vi.mock("../services/schedule-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/schedule-context")>();
  return { ...actual, loadScheduleContextForAgent: mockLoadContext };
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
};

const mockContext = {
  scheduleName: "Spring 2026 - Main",
  scheduleTerm: "Spring 2026",
  courses: [
    { courseCode: "EN.601.226", sisOfferingName: "EN.601.226", term: "Spring 2026", courseTitle: "Data Structures" },
  ],
  profile: null,
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
  vi.clearAllMocks();
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
    mockGenerateObject.mockResolvedValue({ object: mockAuditResult });

    const app = makeApp(OWNER_ID);
    const res = await request(app).post(`/api/schedules/${SCHEDULE_ID}/audit`);

    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ feasibilityLabel: "moderate" });
  });

  it("returns 500 when LLM throws", async () => {
    mockLoadContext.mockResolvedValue({ ok: true, context: mockContext });
    mockQuery.mockResolvedValue({ rows: [] });
    mockGenerateObject.mockRejectedValue(new Error("LLM failure"));

    const app = makeApp(OWNER_ID);
    const res = await request(app).post(`/api/schedules/${SCHEDULE_ID}/audit`);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to generate audit");
  });

  it("persists audit to schedule_audits on success", async () => {
    mockLoadContext.mockResolvedValue({ ok: true, context: mockContext });
    mockQuery
      .mockResolvedValueOnce({ rows: [] })           // eval query
      .mockResolvedValueOnce({ rows: [{ id: "audit-1" }] }); // INSERT
    mockGenerateObject.mockResolvedValue({ object: mockAuditResult });

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
    mockGenerateObject.mockResolvedValue({ object: mockAuditResult });

    const app = makeApp(OWNER_ID);
    const res = await request(app).post(`/api/schedules/${SCHEDULE_ID}/audit`);

    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ narrativeSummary: "A moderate schedule." });
    // generateObject was still called despite missing eval data
    expect(mockGenerateObject).toHaveBeenCalledOnce();
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
