import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const {
  mockGenerateText,
  mockStreamText,
  mockIsQueryInProductScope,
  mockLoadScheduleContextForAgent,
  mockLoadUserMemoryContextForAgent,
  mockPoolQuery,
  mockGetOrCreateChatState,
  mockPersistMessage,
  mockEnforceRetentionPolicy,
  mockHandleScheduleEditMessage,
  mockGetSisCourseDetails,
  mockRunChatMemoryExtraction,
  mockLoadRecentMessages,
  mockFormatChatHistoryBlock,
} = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockStreamText: vi.fn(),
  mockIsQueryInProductScope: vi.fn(),
  mockLoadScheduleContextForAgent: vi.fn(),
  mockLoadUserMemoryContextForAgent: vi.fn(),
  mockPoolQuery: vi.fn(),
  mockGetOrCreateChatState: vi.fn(),
  mockPersistMessage: vi.fn(),
  mockEnforceRetentionPolicy: vi.fn(),
  mockHandleScheduleEditMessage: vi.fn(),
  mockGetSisCourseDetails: vi.fn(),
  mockRunChatMemoryExtraction: vi.fn().mockResolvedValue(undefined),
  mockLoadRecentMessages: vi.fn(),
  mockFormatChatHistoryBlock: vi.fn(),
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
  loadUserMemoryContextForAgent: mockLoadUserMemoryContextForAgent,
  buildUserMemoriesOnlyBlock: vi.fn((ctx: { canonicalMemories: { memory_text: string }[] }) =>
    ctx.canonicalMemories?.length
      ? "\nMEMORIES BLOCK\n" + ctx.canonicalMemories.map((m) => m.memory_text).join("")
      : "",
  ),
}));

vi.mock("../pool", () => ({
  pool: { query: mockPoolQuery },
}));

vi.mock("../services/chat-persistence", () => ({
  getOrCreateChatState: mockGetOrCreateChatState,
  persistMessage: mockPersistMessage,
  enforceRetentionPolicy: mockEnforceRetentionPolicy,
  loadRecentMessages: mockLoadRecentMessages,
  formatChatHistoryBlock: mockFormatChatHistoryBlock,
}));

vi.mock("../services/chat-memory-extraction", () => ({
  runChatMemoryExtraction: mockRunChatMemoryExtraction,
}));

vi.mock("../services/schedule-edit-orchestrator", () => ({
  handleScheduleEditMessage: mockHandleScheduleEditMessage,
}));

vi.mock("../services/get-sis-course-details", () => ({
  getSisCourseDetails: mockGetSisCourseDetails,
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
    mockStreamText.mockReturnValue({
      text: Promise.resolve(JSON.stringify({ type: "text", message: "hello" })),
      steps: Promise.resolve([]),
    });
    mockGetOrCreateChatState.mockResolvedValue({
      id: CHAT_STATE_ID,
      schedule_id: SCHEDULE_ID,
      rolling_summary: "",
    });
    mockPersistMessage.mockResolvedValue({
      id: "cccccccc-0000-0000-0000-000000000001",
    });
    mockEnforceRetentionPolicy.mockResolvedValue(undefined);
    mockHandleScheduleEditMessage.mockResolvedValue({ handled: false });
    mockGetSisCourseDetails.mockResolvedValue({
      courseId: "en-601-226-spring-2026",
      course: {
        offeringName: "EN.601.226",
        sectionName: "01",
        title: "Data Structures",
        description: "",
        schoolName: "Whiting School of Engineering",
        department: "Computer Science",
        level: "Upper Level Undergraduate",
        timeOfDay: "afternoon",
        daysOfWeek: "Mon/Wed",
        location: "Malone Hall",
        instructors: ["Grace Hopper"],
        status: "Open",
      },
    });
    mockLoadRecentMessages.mockResolvedValue([]);
    mockFormatChatHistoryBlock.mockReturnValue("");
    mockLoadUserMemoryContextForAgent.mockResolvedValue({
      canonicalMemories: [],
      profile: null,
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

  it("preserves specific search message when results are empty", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        type: "search",
        results: [],
        message: "No exact matches, but try broadening to related math courses.",
      }),
      steps: [],
    });

    const res = await request(makeApp()).post("/api/agent").send({
      message: "find linear algebra with impossible constraints",
      stream: false,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "search",
      results: [],
      message: "No exact matches, but try broadening to related math courses.",
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
    expect(mockRunChatMemoryExtraction).toHaveBeenCalledWith({
      pool: expect.anything(),
      appUserId: OWNER_ID,
      userMessage: "find me a CS course",
      userMessageId: "cccccccc-0000-0000-0000-000000000001",
    });
  });

  it("skips persistence when scheduleId is absent", async () => {
    const res = await request(makeApp(OWNER_ID))
      .post("/api/agent")
      .send({ message: "find me a CS course" });

    expect(res.status).toBe(200);
    expect(mockGetOrCreateChatState).not.toHaveBeenCalled();
    expect(mockPersistMessage).not.toHaveBeenCalled();
    expect(mockRunChatMemoryExtraction).not.toHaveBeenCalled();
  });

  it("returns 200 even if enforceRetentionPolicy throws", async () => {
    mockEnforceRetentionPolicy.mockRejectedValueOnce(new Error("db error"));

    const res = await request(makeApp(OWNER_ID))
      .post("/api/agent")
      .send({ message: "find me a CS course", scheduleId: SCHEDULE_ID, stream: false });

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
        stream: false,
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
        stream: false,
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
      .send({ message: "add EN.520.433 in Fall 2026", scheduleId: SCHEDULE_ID, stream: false });

    expect(res.status).toBe(200);
    expect(res.body.scheduleChanges.failed[0].reasonCode).toBe("term_mismatch");
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("returns clarification for underspecified course follow-ups before LLM", async () => {
    const res = await request(makeApp()).post("/api/agent").send({
      message: "how hard is it?",
      stream: false,
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
      stream: false,
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
      stream: false,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "summary",
      hasData: false,
      summaryText: "No evaluation data found for this course.",
    });
  });

  it("registers getSisCourseDetails and delegates to the service", async () => {
    await request(makeApp()).post("/api/agent").send({
      message: "show me details for EN.601.226",
      stream: false,
    });

    const generateTextArgs = mockGenerateText.mock.calls[0]?.[0] as {
      tools: Record<string, { execute: (input: { courseId: string }) => Promise<unknown> }>;
    };

    const result = await generateTextArgs.tools.getSisCourseDetails.execute({
      courseId: "en-601-226-spring-2026",
    });

    expect(mockGetSisCourseDetails).toHaveBeenCalledWith("en-601-226-spring-2026");
    expect(result).toEqual({
      courseId: "en-601-226-spring-2026",
      course: {
        offeringName: "EN.601.226",
        sectionName: "01",
        title: "Data Structures",
        description: "",
        schoolName: "Whiting School of Engineering",
        department: "Computer Science",
        level: "Upper Level Undergraduate",
        timeOfDay: "afternoon",
        daysOfWeek: "Mon/Wed",
        location: "Malone Hall",
        instructors: ["Grace Hopper"],
        status: "Open",
      },
    });
  });

  it("returns a details payload when the tool produced SIS course details", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({ type: "text", message: "Here are the details." }),
      steps: [
        {
          toolResults: [
            {
              toolName: "getSisCourseDetails",
              output: {
                courseId: "en-601-226-spring-2026",
                course: {
                  offeringName: "EN.601.226",
                  sectionName: "01",
                  title: "Data Structures",
                  description: "",
                  schoolName: "Whiting School of Engineering",
                  department: "Computer Science",
                  level: "Upper Level Undergraduate",
                  timeOfDay: "afternoon",
                  daysOfWeek: "Mon/Wed",
                  location: "Malone Hall",
                  instructors: ["Grace Hopper"],
                  status: "Open",
                },
              },
            },
          ],
        },
      ],
    });

    const res = await request(makeApp()).post("/api/agent").send({
      message: "what time is EN.601.226 offered",
      stream: false,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "details",
      course: {
        offeringName: "EN.601.226",
        sectionName: "01",
        title: "Data Structures",
        description: "",
        schoolName: "Whiting School of Engineering",
        department: "Computer Science",
        level: "Upper Level Undergraduate",
        timeOfDay: "afternoon",
        daysOfWeek: "Mon/Wed",
        location: "Malone Hall",
        instructors: ["Grace Hopper"],
        status: "Open",
      },
    });
  });

  it("returns a clear user-facing message when getSisCourseDetails reports an invalid courseId", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({ type: "details", course: null }),
      steps: [
        {
          toolResults: [
            {
              toolName: "getSisCourseDetails",
              output: {
                courseId: "bad-course-id",
                course: null,
                message:
                  "Invalid courseId format. Expected values like en-553-171-spring-2026 or en-553-171-01-spring-2026.",
              },
            },
          ],
        },
      ],
    });

    const res = await request(makeApp()).post("/api/agent").send({
      message: "show me that course",
      stream: false,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "text",
      message:
        "Invalid courseId format. Expected values like en-553-171-spring-2026 or en-553-171-01-spring-2026.",
    });
  });

  it("returns Course not found when getSisCourseDetails reports no SIS match", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({ type: "details", course: null }),
      steps: [
        {
          toolResults: [
            {
              toolName: "getSisCourseDetails",
              output: {
                courseId: "en-553-171-spring-2026",
                course: null,
                message: "Course not found",
              },
            },
          ],
        },
      ],
    });

    const res = await request(makeApp()).post("/api/agent").send({
      message: "show me details for EN.553.171",
      stream: false,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "text",
      message: "Course not found",
    });
  });

  it("uses deterministic no-results guidance for overly constrained searches", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({ type: "search", results: [] }),
      steps: [],
    });

    const res = await request(makeApp()).post("/api/agent").send({
      message: "find WSE courses on Wednesday taught by Smith",
      stream: false,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "search",
      results: [],
      message:
        "I couldn't find any courses matching all of those constraints. Try relaxing one filter, such as day filters or school.",
    });
  });

  it("adds explicit preference mismatch explanations for day/time conflicts", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        type: "search",
        results: [
          {
            courseId: "en-601-226-spring-2026",
            code: "601.226",
            title: "Data Structures",
            description: "",
            sisOfferingName: "EN.601.226",
            term: "Spring 2026",
            daysOfWeek: "Mon/Wed",
            timeOfDay: "morning",
          },
          {
            courseId: "en-553-171-spring-2026",
            code: "553.171",
            title: "Discrete Mathematics",
            description: "",
            sisOfferingName: "EN.553.171",
            term: "Spring 2026",
            daysOfWeek: "Tue/Thu",
            timeOfDay: "morning",
          },
          {
            courseId: "en-520-433-spring-2026",
            code: "520.433",
            title: "Intro Probability",
            description: "",
            sisOfferingName: "EN.520.433",
            term: "Spring 2026",
            daysOfWeek: "Mon/Wed",
            timeOfDay: "evening",
          },
          {
            courseId: "en-601-433-spring-2026",
            code: "601.433",
            title: "Intro Algorithms",
            description: "",
            sisOfferingName: "EN.601.433",
            term: "Spring 2026",
            daysOfWeek: "Tue/Thu",
            timeOfDay: "evening",
          },
        ],
      }),
      steps: [],
    });

    const res = await request(makeApp()).post("/api/agent").send({
      message: "I prefer Monday morning classes. Recommend options.",
      stream: false,
    });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("search");
    const results = res.body.results as Array<Record<string, unknown>>;

    expect(results[0].preferenceAlignment).toBe("aligned");

    expect(results[1].preferenceAlignment).toBe("mismatch");
    expect(String(results[1].matchExplanation)).toContain("conflicts with preferred days");

    expect(results[2].preferenceAlignment).toBe("mismatch");
    expect(String(results[2].matchExplanation)).toContain("conflicts with preferred time window");

    expect(results[3].preferenceAlignment).toBe("mismatch");
    expect(String(results[3].matchExplanation)).toContain(
      "conflicts with preferred days and preferred time window",
    );
  });

  it("produces deterministic preference compliance across repeated runs", async () => {
    const payload = {
      type: "search",
      results: [
        {
          courseId: "en-601-226-spring-2026",
          code: "601.226",
          title: "Data Structures",
          description: "",
          sisOfferingName: "EN.601.226",
          term: "Spring 2026",
          daysOfWeek: "Tue/Thu",
          timeOfDay: "evening",
        },
      ],
    };
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: JSON.stringify(payload),
        steps: [],
      }),
    );

    const requestBody = {
      message: "I prefer Monday morning courses.",
      stream: false,
    };

    const first = await request(makeApp()).post("/api/agent").send(requestBody);
    const second = await request(makeApp()).post("/api/agent").send(requestBody);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.results).toEqual(second.body.results);
    expect(first.body.results[0].preferenceAlignment).toBe("mismatch");
    expect(String(first.body.results[0].matchExplanation)).toContain(
      "conflicts with preferred days and preferred time window",
    );
  });

  it("derives SIS meeting fields by code and still reports mismatch explicitly", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        type: "search",
        results: [
          {
            courseId: "en-601-433-spring-2026",
            code: "601.433",
            title: "Intro Algorithms",
            description: "",
            term: "Spring 2026",
          },
        ],
      }),
      steps: [
        {
          toolResults: [
            {
              toolName: "searchCoursesBySisConstraints",
              output: {
                courses: [
                  {
                    offeringName: "EN.601.433",
                    daysOfWeek: "Tue/Thu",
                    timeOfDay: "evening",
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const res = await request(makeApp()).post("/api/agent").send({
      message: "I prefer Monday morning classes.",
      stream: false,
    });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("search");
    expect(res.body.results[0].preferenceAlignment).toBe("mismatch");
    expect(String(res.body.results[0].matchExplanation)).toContain(
      "conflicts with preferred days and preferred time window",
    );
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
    expect(res.text).toContain('event: status\ndata: {"stage":"done"}');
    expect(res.text).toContain('event: final');
    expect(res.text).toContain('"stage":"done"');

    expect(mockPersistMessage).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        role: "user",
        scheduleId: "sched-1",
        content: "help me plan this schedule",
      }),
    );
    expect(mockPersistMessage).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
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
    expect(mockPersistMessage).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        role: "user",
        scheduleId: "sched-1",
      }),
    );
    expect(mockPersistMessage).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        role: "assistant",
        scheduleId: "sched-1",
        content: "Partial response",
        metadata: { aborted: true },
      }),
    );
  });

  it("loads recent messages and injects formatted history into the system prompt", async () => {
    const fakeMessages = [{ role: "user", content: "previous question" }];
    mockLoadRecentMessages.mockResolvedValueOnce(fakeMessages);
    mockFormatChatHistoryBlock.mockReturnValueOnce("\n\n--- Conversation History ---\nuser: previous question\n--- End of Conversation History ---");

    await request(makeApp(OWNER_ID))
      .post("/api/agent")
      .send({ message: "follow-up question", scheduleId: SCHEDULE_ID, stream: false });

    expect(mockLoadRecentMessages).toHaveBeenCalledWith(expect.anything(), CHAT_STATE_ID);
    expect(mockFormatChatHistoryBlock).toHaveBeenCalledWith("", fakeMessages);

    const systemArg = (mockGenerateText.mock.calls[0]?.[0] as { system?: string })?.system ?? "";
    expect(systemArg).toContain("--- Conversation History ---");
  });

  it("falls back to stateless when loadRecentMessages throws", async () => {
    mockLoadRecentMessages.mockRejectedValueOnce(new Error("db error"));

    const res = await request(makeApp(OWNER_ID))
      .post("/api/agent")
      .send({ message: "find me a course", scheduleId: SCHEDULE_ID, stream: false });

    expect(res.status).toBe(200);
    // generateText was still called (stateless fallback, not a 500)
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    // history block is empty — no history injected
    const systemArg = (mockGenerateText.mock.calls[0]?.[0] as { system?: string })?.system ?? "";
    expect(systemArg).not.toContain("--- Conversation History ---");
  });

  it("does not load history when scheduleId is absent", async () => {
    await request(makeApp(OWNER_ID))
      .post("/api/agent")
      .send({ message: "find me a course", stream: false });

    expect(mockLoadRecentMessages).not.toHaveBeenCalled();
    expect(mockFormatChatHistoryBlock).not.toHaveBeenCalled();
  });

  it("loads user memories for authenticated requests without scheduleId and injects into system prompt", async () => {
    mockLoadUserMemoryContextForAgent.mockResolvedValueOnce({
      canonicalMemories: [
        { memory_text: "Prefer afternoon sections", memory_type: "preference", source: "chat" },
      ],
      profile: null,
    });

    await request(makeApp(OWNER_ID))
      .post("/api/agent")
      .send({ message: "find me a course", stream: false });

    expect(mockLoadUserMemoryContextForAgent).toHaveBeenCalledWith(OWNER_ID);
    const systemArg = (mockGenerateText.mock.calls[0]?.[0] as { system?: string })?.system ?? "";
    expect(systemArg).toContain("Prefer afternoon sections");
    expect(systemArg).toContain("MEMORIES BLOCK");
  });

  it("does not load standalone user memories when scheduleId is present", async () => {
    await request(makeApp(OWNER_ID))
      .post("/api/agent")
      .send({ message: "find me a course", scheduleId: SCHEDULE_ID, stream: false });

    expect(mockLoadUserMemoryContextForAgent).not.toHaveBeenCalled();
  });
});
