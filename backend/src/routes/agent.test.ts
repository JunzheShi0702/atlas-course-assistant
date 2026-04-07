import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const {
  mockGenerateText,
  mockIsQueryInProductScope,
  mockLoadScheduleContextForAgent,
  mockPoolQuery,
} = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockIsQueryInProductScope: vi.fn(),
  mockLoadScheduleContextForAgent: vi.fn(),
  mockPoolQuery: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  stepCountIs: vi.fn(() => () => true),
  tool: vi.fn((def) => def),
}));

vi.mock("@ai-sdk/openai", () => ({
  openai: vi.fn(() => "mock-model"),
}));

vi.mock("../services/query-scope", () => ({
  isQueryInProductScope: mockIsQueryInProductScope,
  OUT_OF_SCOPE_REDIRECT_MESSAGE:
    "I can only help with JHU course planning right now.",
}));

vi.mock("../services/schedule-context", () => ({
  loadScheduleContextForAgent: mockLoadScheduleContextForAgent,
  buildScheduleContextBlock: vi.fn(() => "\nSCHEDULE CONTEXT"),
}));

vi.mock("../pool", () => ({
  pool: { query: mockPoolQuery },
}));

import agentRouter from "./agent";

function makeApp(userId?: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (userId) {
      (req as express.Request & { user?: { id: string; email: string } }).user = {
        id: userId,
        email: "student@jhu.edu",
      };
    }
    next();
  });
  app.use("/api/agent", agentRouter);
  return app;
}

describe("POST /api/agent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPoolQuery.mockResolvedValue({ rows: [] });
    mockIsQueryInProductScope.mockResolvedValue(true);
    mockLoadScheduleContextForAgent.mockResolvedValue({
      ok: true,
      context: {} as unknown,
    });
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({ type: "text", message: "hello" }),
      steps: [],
    });
  });

  it("returns 400 when message is missing", async () => {
    const res = await request(makeApp()).post("/api/agent").send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "message is required" });
  });

  it("returns 401 when scheduleId is provided but user is unauthenticated", async () => {
    const res = await request(makeApp()).post("/api/agent").send({
      message: "help me plan this schedule",
      scheduleId: "sched-1",
    });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });

  it("returns 404 when schedule context is missing", async () => {
    mockLoadScheduleContextForAgent.mockResolvedValueOnce({
      ok: false,
      error: "not_found",
    });

    const res = await request(makeApp("00000000-0000-0000-0000-000000000001"))
      .post("/api/agent")
      .send({
        message: "audit this schedule",
        scheduleId: "sched-1",
      });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Schedule not found" });
  });

  it("returns out-of-scope redirect text without invoking generateText", async () => {
    mockIsQueryInProductScope.mockResolvedValueOnce(false);

    const res = await request(makeApp()).post("/api/agent").send({
      message: "what's the weather today?",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "text",
      message: "I can only help with JHU course planning right now.",
    });
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("normalizes empty search results with fallback message", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({ type: "search", results: [] }),
      steps: [],
    });

    const res = await request(makeApp()).post("/api/agent").send({
      message: "find courses about dance",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "search",
      results: [],
      message:
        "I didn’t find any courses matching those criteria. Try relaxing filters or searching for different keywords.",
    });
  });

  it("replaces empty message strings with fallback message", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({ type: "text", message: "   " }),
      steps: [],
    });

    const res = await request(makeApp()).post("/api/agent").send({
      message: "hello",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "text",
      message:
        "I didn’t find any courses matching those criteria. Try relaxing filters or searching for different keywords.",
    });
  });

  it("routes unambiguous schedule edits through agent tool flow", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({ type: "text", message: "Understood." }),
      steps: [
        {
          toolResults: [
            {
              toolName: "modifyScheduleCourses",
              output: {
                ok: true,
                needsClarification: false,
                added: [],
                removed: [],
                failed: [],
              },
            },
          ],
        },
      ],
    });

    const res = await request(makeApp("00000000-0000-0000-0000-000000000001"))
      .post("/api/agent")
      .send({
        message: "add EN.601.226 to this schedule",
        scheduleId: "sched-1",
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      type: "text",
      message: "Understood.",
      scheduleChanges: {
        operation: "add",
        added: [],
        removed: [],
        failed: [],
      },
    });
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    const generateCall = mockGenerateText.mock.calls[0]?.[0] as { tools?: Record<string, unknown> } | undefined;
    expect(generateCall?.tools?.modifyScheduleCourses).toBeTruthy();
  });

  it("returns clarification for ambiguous schedule edits and shortcuts before LLM", async () => {
    const res = await request(makeApp("00000000-0000-0000-0000-000000000001"))
      .post("/api/agent")
      .send({
        message: "swap it for something easier",
        scheduleId: "sched-1",
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "text",
      message:
        "Please clarify which course to remove and which course to add (course code or exact title + term for each).",
    });
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("returns clarification for underspecified course follow-ups before LLM", async () => {
    const res = await request(makeApp()).post("/api/agent").send({
      message: "how hard is it?",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "text",
      message: "Please tell me which course you mean (course code or exact title).",
    });
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("returns deterministic conflict handling for contradictory time constraints", async () => {
    const res = await request(makeApp()).post("/api/agent").send({
      message: "find morning classes after 5 pm",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "text",
      message:
        "Those time constraints conflict: a class cannot be both a morning class and after 5 PM. Pick one time window and try again.",
    });
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("uses tool no-data output for evaluation summaries", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        type: "summary",
        hasData: true,
        summaryText: "Hallucinated summary",
      }),
      steps: [
        {
          toolResults: [
            {
              toolName: "getCourseEvalSummary",
              output: {
                hasData: false,
                message: "No evaluation data found for this course.",
              },
            },
          ],
        },
      ],
    });

    const res = await request(makeApp()).post("/api/agent").send({
      message: "how hard is EN.601.226",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "summary",
      hasData: false,
      summaryText: "No evaluation data found for this course.",
    });
  });

  it("uses deterministic no-results guidance for overly constrained searches", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({ type: "search", results: [] }),
      steps: [],
    });

    const res = await request(makeApp()).post("/api/agent").send({
      message: "find WSE courses on Wednesday taught by Smith",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "search",
      results: [],
      message:
        "I couldn't find any courses matching all of those constraints. Try relaxing one filter, such as day filters or school.",
    });
  });
});
