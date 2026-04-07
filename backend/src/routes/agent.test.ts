import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const {
  mockGenerateText,
  mockStreamText,
  mockIsQueryInProductScope,
  mockLoadScheduleContextForAgent,
  mockPoolQuery,
  mockPersistScheduleChatMessage,
} = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockStreamText: vi.fn(),
  mockIsQueryInProductScope: vi.fn(),
  mockLoadScheduleContextForAgent: vi.fn(),
  mockPoolQuery: vi.fn(),
  mockPersistScheduleChatMessage: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  streamText: mockStreamText,
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

vi.mock("../services/schedule-chat", () => ({
  persistScheduleChatMessage: mockPersistScheduleChatMessage,
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
    mockPersistScheduleChatMessage.mockResolvedValue("chat-message-1");
    mockIsQueryInProductScope.mockResolvedValue(true);
    mockLoadScheduleContextForAgent.mockResolvedValue({
      ok: true,
      context: {} as unknown,
    });
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({ type: "text", message: "hello" }),
      steps: [],
    });
    mockStreamText.mockReturnValue({
      text: Promise.resolve(JSON.stringify({ type: "text", message: "hello" })),
      steps: Promise.resolve([]),
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
        stream: false,
      });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Schedule not found" });
  });

  it("returns out-of-scope redirect text without invoking generateText", async () => {
    mockIsQueryInProductScope.mockResolvedValueOnce(false);

    const res = await request(makeApp()).post("/api/agent").send({
      message: "what's the weather today?",
      stream: false,
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
      stream: false,
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
      stream: false,
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
        stream: false,
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
        stream: false,
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "text",
      message:
        "Please clarify which course to remove and which course to add (course code or exact title + term for each).",
    });
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("streams SSE events in order and persists user + assistant messages", async () => {
    mockStreamText.mockImplementationOnce((config: {
      onChunk?: (event: { chunk: { type: string; text?: string } }) => void;
      onAbort?: () => Promise<void> | void;
    }) => {
      config.onChunk?.({ chunk: { type: "tool-call" } });
      config.onChunk?.({ chunk: { type: "text-delta", text: '{"type":"text","message":"Hello' } });
      config.onChunk?.({ chunk: { type: "text-delta", text: ' there"}' } });

      return {
        text: Promise.resolve(JSON.stringify({ type: "text", message: "Hello there" })),
        steps: Promise.resolve([]),
      };
    });

    const res = await request(makeApp("00000000-0000-0000-0000-000000000001"))
      .post("/api/agent")
      .send({
        message: "help me plan this schedule",
        scheduleId: "sched-1",
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.text).toContain('event: status');
    expect(res.text).toContain('"stage":"loading_context"');
    expect(res.text).toContain('"stage":"calling_tools"');
    expect(res.text).toContain('"stage":"generating_response"');
    expect(res.text).toContain('event: text_chunk');
    expect(res.text).toContain('"text":"Hello"');
    expect(res.text).toContain('"text":" there"');
    expect(res.text).toContain('event: final');
    expect(res.text).toContain('"stage":"done"');

    expect(mockPersistScheduleChatMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        role: "user",
        scheduleId: "sched-1",
        content: "help me plan this schedule",
      }),
    );
    expect(mockPersistScheduleChatMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        role: "assistant",
        scheduleId: "sched-1",
        content: "Hello there",
        responseType: "text",
      }),
    );
  });

  it("persists partial assistant text with aborted metadata when the stream aborts", async () => {
    mockStreamText.mockImplementationOnce((config: {
      onChunk?: (event: { chunk: { type: string; text?: string } }) => void;
      onAbort?: () => Promise<void> | void;
    }) => {
      config.onChunk?.({ chunk: { type: "text-delta", text: '{"type":"text","message":"Partial response' } });
      void config.onAbort?.();

      return {
        text: Promise.reject(new DOMException("The operation was aborted.", "AbortError")),
        steps: Promise.resolve([]),
      };
    });

    const res = await request(makeApp("00000000-0000-0000-0000-000000000001"))
      .post("/api/agent")
      .send({
        message: "help me audit this schedule",
        scheduleId: "sched-1",
      });

    expect(res.status).toBe(200);
    expect(mockPersistScheduleChatMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        role: "user",
        scheduleId: "sched-1",
      }),
    );
    expect(mockPersistScheduleChatMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        role: "assistant",
        scheduleId: "sched-1",
        content: "Partial response",
        metadata: { aborted: true },
      }),
    );
  });
});
