import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const {
  mockGenerateText,
  mockIsQueryInProductScope,
  mockLoadScheduleContextForAgent,
  mockPoolQuery,
  mockGetOrCreateChatState,
  mockPersistMessage,
  mockEnforceRetentionPolicy,
  mockHandleScheduleEditMessage,
} = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockIsQueryInProductScope: vi.fn(),
  mockLoadScheduleContextForAgent: vi.fn(),
  mockPoolQuery: vi.fn(),
  mockGetOrCreateChatState: vi.fn(),
  mockPersistMessage: vi.fn(),
  mockEnforceRetentionPolicy: vi.fn(),
  mockHandleScheduleEditMessage: vi.fn(),
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

vi.mock("../services/chat-persistence", () => ({
  getOrCreateChatState: mockGetOrCreateChatState,
  persistMessage: mockPersistMessage,
  enforceRetentionPolicy: mockEnforceRetentionPolicy,
}));

vi.mock("../services/schedule-edit-orchestrator", () => ({
  handleScheduleEditMessage: mockHandleScheduleEditMessage,
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
  const OWNER_ID = "00000000-0000-0000-0000-000000000001";
  const SCHEDULE_ID = "aaaaaaaa-0000-0000-0000-000000000001";
  const CHAT_STATE_ID = "bbbbbbbb-0000-0000-0000-000000000001";

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
    mockGetOrCreateChatState.mockResolvedValue({ id: CHAT_STATE_ID, schedule_id: SCHEDULE_ID });
    mockPersistMessage.mockResolvedValue({});
    mockEnforceRetentionPolicy.mockResolvedValue(undefined);
    mockHandleScheduleEditMessage.mockResolvedValue({ handled: false });
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

  it("persists user and assistant messages when scheduleId and auth are present", async () => {
    const res = await request(makeApp(OWNER_ID))
      .post("/api/agent")
      .send({ message: "find me a CS course", scheduleId: SCHEDULE_ID });

    expect(res.status).toBe(200);
    expect(mockGetOrCreateChatState).toHaveBeenCalledWith(
      expect.anything(),
      SCHEDULE_ID,
      OWNER_ID,
    );
    expect(mockPersistMessage).toHaveBeenCalledTimes(2);
    expect(mockPersistMessage).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ role: "user", content: "find me a CS course" }),
    );
    expect(mockPersistMessage).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ role: "assistant" }),
    );
  });

  it("skips persistence when scheduleId is absent", async () => {
    const res = await request(makeApp(OWNER_ID))
      .post("/api/agent")
      .send({ message: "find me a CS course" });

    expect(res.status).toBe(200);
    expect(mockGetOrCreateChatState).not.toHaveBeenCalled();
    expect(mockPersistMessage).not.toHaveBeenCalled();
  });

  it("returns 200 even if enforceRetentionPolicy throws", async () => {
    mockEnforceRetentionPolicy.mockRejectedValueOnce(new Error("db error"));

    const res = await request(makeApp(OWNER_ID))
      .post("/api/agent")
      .send({ message: "find me a CS course", scheduleId: SCHEDULE_ID });

    expect(res.status).toBe(200);
  });

  it("short-circuits schedule edits through orchestrator before generateText", async () => {
    mockHandleScheduleEditMessage.mockResolvedValueOnce({
      handled: true,
      payload: {
        type: "text",
        message: "Added 1 course to your schedule.",
        scheduleChanges: {
          operation: "add",
          added: [{ courseCode: "520.433", sisOfferingName: "EN.520.433", term: "Spring 2026" }],
          removed: [],
          failed: [],
        },
      },
    });

    const res = await request(makeApp("00000000-0000-0000-0000-000000000001"))
      .post("/api/agent")
      .send({
        message: "add EN.601.226 to this schedule",
        scheduleId: "sched-1",
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "text",
      message: "Added 1 course to your schedule.",
      scheduleChanges: {
        operation: "add",
        added: [{ courseCode: "520.433", sisOfferingName: "EN.520.433", term: "Spring 2026" }],
        removed: [],
        failed: [],
      },
    });
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("returns search candidates for ambiguous schedule edits and shortcuts before LLM", async () => {
    mockHandleScheduleEditMessage.mockResolvedValueOnce({
      handled: true,
      payload: {
        type: "search",
        message: "I found multiple candidate courses. Please choose one.",
        results: [
          {
            courseId: "en-601-226-spring-2026",
            code: "601.226",
            title: "Data Structures",
            description: "",
            sisOfferingName: "EN.601.226",
            term: "Spring 2026",
          },
        ],
        scheduleChanges: {
          operation: "replace",
          added: [],
          removed: [],
          failed: [
            {
              action: "add",
              reasonCode: "ambiguous_reference",
              message: "I found multiple candidate courses. Please choose one.",
              candidates: [{ courseCode: "601.226", sisOfferingName: "EN.601.226", term: "Spring 2026" }],
            },
          ],
        },
      },
    });

    const res = await request(makeApp("00000000-0000-0000-0000-000000000001"))
      .post("/api/agent")
      .send({
        message: "swap it for something easier",
        scheduleId: "sched-1",
      });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("search");
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("passes through term mismatch failures from schedule edit orchestration", async () => {
    mockHandleScheduleEditMessage.mockResolvedValueOnce({
      handled: true,
      payload: {
        type: "text",
        message: "I couldn't apply that schedule change yet.",
        scheduleChanges: {
          operation: "add",
          added: [],
          removed: [],
          failed: [
            {
              action: "add",
              reasonCode: "term_mismatch",
              message: "This schedule only supports edits in Spring 2026.",
            },
          ],
        },
      },
    });

    const res = await request(makeApp(OWNER_ID))
      .post("/api/agent")
      .send({ message: "add EN.520.433 in Fall 2026", scheduleId: SCHEDULE_ID });

    expect(res.status).toBe(200);
    expect(res.body.scheduleChanges.failed[0].reasonCode).toBe("term_mismatch");
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("does not short-circuit underspecified course follow-ups", async () => {
    const res = await request(makeApp()).post("/api/agent").send({
      message: "how hard is it?",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "text",
      message: "hello",
    });
    expect(mockGenerateText).toHaveBeenCalled();
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
