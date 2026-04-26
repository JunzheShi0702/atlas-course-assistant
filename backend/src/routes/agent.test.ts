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
  mockGetPendingClarificationState,
  mockPersistMessage,
  mockResolvePendingClarificationState,
  mockUpsertPendingClarificationState,
  mockEnforceRetentionPolicy,
  mockHandleCustomScheduleEventMessage,
  mockHandleScheduleEditMessage,
  mockSearchCoursesBySisConstraints,
  mockGetSisCourseDetails,
  mockQueryCourseMetrics,
  mockClampCourseMetricsTermToAllowedWindow,
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
  mockGetPendingClarificationState: vi.fn(),
  mockPersistMessage: vi.fn(),
  mockResolvePendingClarificationState: vi.fn(),
  mockUpsertPendingClarificationState: vi.fn(),
  mockEnforceRetentionPolicy: vi.fn(),
  mockHandleCustomScheduleEventMessage: vi.fn(),
  mockHandleScheduleEditMessage: vi.fn(),
  mockSearchCoursesBySisConstraints: vi.fn(),
  mockGetSisCourseDetails: vi.fn(),
  mockQueryCourseMetrics: vi.fn(),
  mockClampCourseMetricsTermToAllowedWindow: vi.fn((term?: string) => term),
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
  getPendingClarificationState: mockGetPendingClarificationState,
  persistMessage: mockPersistMessage,
  resolvePendingClarificationState: mockResolvePendingClarificationState,
  upsertPendingClarificationState: mockUpsertPendingClarificationState,
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

vi.mock("../tools/search-courses-by-sis-constraints", () => ({
  searchCoursesBySisConstraints: mockSearchCoursesBySisConstraints,
}));

vi.mock("../services/custom-schedule-event-orchestrator", () => ({
  handleCustomScheduleEventMessage: mockHandleCustomScheduleEventMessage,
}));

vi.mock("../services/get-sis-course-details", () => ({
  getSisCourseDetails: mockGetSisCourseDetails,
}));

vi.mock("../tools/query-course-metrics", () => ({
  queryCourseMetrics: mockQueryCourseMetrics,
  clampCourseMetricsTermToAllowedWindow: mockClampCourseMetricsTermToAllowedWindow,
  buildQueryCourseMetricsNoDataMessage: vi.fn((courseCode: string, term?: string) =>
    term
      ? `No course evaluation metrics were found for ${courseCode} in ${term}.`
      : `No course evaluation metrics were found for ${courseCode} across all terms.`,
  ),
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
    mockGenerateText.mockReset();
    mockStreamText.mockReset();
    mockIsQueryInProductScope.mockReset();
    mockLoadScheduleContextForAgent.mockReset();
    mockLoadUserMemoryContextForAgent.mockReset();
    mockPoolQuery.mockReset();
    mockGetOrCreateChatState.mockReset();
    mockPersistMessage.mockReset();
    mockEnforceRetentionPolicy.mockReset();
    mockHandleCustomScheduleEventMessage.mockReset();
    mockHandleScheduleEditMessage.mockReset();
    mockGetSisCourseDetails.mockReset();
    mockQueryCourseMetrics.mockReset();
    mockRunChatMemoryExtraction.mockReset();
    mockLoadRecentMessages.mockReset();
    mockFormatChatHistoryBlock.mockReset();
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
    mockGetPendingClarificationState.mockResolvedValue(null);
    mockPersistMessage.mockResolvedValue({
      id: "cccccccc-0000-0000-0000-000000000001",
    });
    mockEnforceRetentionPolicy.mockResolvedValue(undefined);
    mockHandleCustomScheduleEventMessage.mockResolvedValue({ handled: false });
    mockHandleScheduleEditMessage.mockResolvedValue({ handled: false });
    mockSearchCoursesBySisConstraints.mockResolvedValue({ courses: [] });
    mockClampCourseMetricsTermToAllowedWindow.mockImplementation((term?: string) => term);
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
    mockQueryCourseMetrics.mockResolvedValue({
      courseCode: "EN.601.226",
      requestedTerm: "Spring 2026",
      evaluationsTermRange: "Fall 2024 – Spring 2025",
      metricsSource: "historical_offerings",
      term: "Spring 2026",
      scope: "term-specific",
      meta: {
        semestersIncluded: ["Spring 2026"],
        evaluationRowCount: 2,
        termFilterApplied: "Spring 2026",
      },
      metrics: {
        workload: 3.25,
        difficulty: 3.75,
        overallQuality: 4.1,
        respondentCount: 40,
      },
    });
    mockRunChatMemoryExtraction.mockResolvedValue(undefined);
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

  it("returns deterministic grad-scope refusal without invoking generateText", async () => {
    const res = await request(makeApp()).post("/api/agent").send({
      message: "show me graduate computer science courses",
      stream: false,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "text",
      message: "I can only help with undergraduate course planning at JHU. Graduate-level courses are outside my scope.",
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

  it("sanitizes inappropriate source-like text in final message output", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        type: "text",
        message: "Hovemeyer is low key a silver fox.",
      }),
      steps: [],
    });

    const res = await request(makeApp()).post("/api/agent").send({
      message: "how is prof. Hovemeyer",
      stream: false,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "text",
      message:
        "Some source phrasing was removed for safety. I can still summarize teaching clarity, workload, and course fit from academic feedback.",
      redactionNote: "Note: 1 source line was redacted due to inappropriate content.",
    });
  });

  it("sanitizes inappropriate source-like text in summary output", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        type: "summary",
        hasData: true,
        summaryText: "He is low key hot and students call him a silver fox.",
      }),
      steps: [],
    });

    const res = await request(makeApp()).post("/api/agent").send({
      message: "summarize EN.601.226 feedback",
      stream: false,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "summary",
      hasData: true,
      summaryText:
        "Some source phrasing was removed for safety. I can still summarize teaching clarity, workload, and course fit from academic feedback.",
      redactionNote: "Note: 1 source line was redacted due to inappropriate content.",
    });
  });

  it("removes only flagged lines and preserves safe markdown structure", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        type: "text",
        message:
          "- Students say grading is fair and expectations are clear.\n- Some people call him low key hot.",
      }),
      steps: [],
    });

    const res = await request(makeApp()).post("/api/agent").send({
      message: "how is prof. Hovemeyer",
      stream: false,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "text",
      message: "- Students say grading is fair and expectations are clear.",
      redactionNote: "Note: 1 source line was redacted due to inappropriate content.",
    });
  });

  it("sanitizes typo variants like sliver fox", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        type: "text",
        message: "He explains concepts well.\nStudents call him a sliver fox.",
      }),
      steps: [],
    });

    const res = await request(makeApp()).post("/api/agent").send({
      message: "how is prof. Hovemeyer",
      stream: false,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "text",
      message: "He explains concepts well.",
      redactionNote: "Note: 1 source line was redacted due to inappropriate content.",
    });
  });

  it("removes markdown and raw links from text output", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        type: "text",
        message:
          "See [CSF Feedback](https://www.reddit.com/r/jhu/comments/itm3qk/csf/) and https://www.reddit.com/r/jhu/comments/example for details.",
      }),
      steps: [],
    });

    const res = await request(makeApp()).post("/api/agent").send({
      message: "how is prof. Hovemeyer",
      stream: false,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "text",
      message: "See CSF Feedback and for details.",
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

  it("short-circuits custom schedule events before schedule edits and LLM generation", async () => {
    mockHandleCustomScheduleEventMessage.mockResolvedValueOnce({
      handled: true,
      payload: {
        type: "text",
        message: 'Added custom event "Gym" on Tuesday from 18:00 to 19:00.',
        scheduleRefreshRequired: true,
      },
    });

    const res = await request(makeApp(OWNER_ID))
      .post("/api/agent")
      .send({
        message: "add gym on Tuesday from 18:00 to 19:00",
        scheduleId: SCHEDULE_ID,
        stream: false,
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      type: "text",
      message: 'Added custom event "Gym" on Tuesday from 18:00 to 19:00.',
      scheduleRefreshRequired: true,
    });
    expect(mockHandleCustomScheduleEventMessage).toHaveBeenCalledWith({
      userId: OWNER_ID,
      scheduleId: SCHEDULE_ID,
      message: "add gym on Tuesday from 18:00 to 19:00",
      recentMessages: [],
    });
    expect(mockHandleScheduleEditMessage).not.toHaveBeenCalled();
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("still handles schedule-scoped custom events even if the scope classifier says out-of-scope", async () => {
    mockIsQueryInProductScope.mockResolvedValueOnce(false);
    mockHandleCustomScheduleEventMessage.mockResolvedValueOnce({
      handled: true,
      payload: {
        type: "text",
        message: 'Added custom event "Study Block" with day and time TBA.',
        scheduleRefreshRequired: true,
      },
    });

    const res = await request(makeApp(OWNER_ID))
      .post("/api/agent")
      .send({
        message: "add an event with time and date TBA",
        scheduleId: SCHEDULE_ID,
        stream: false,
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      type: "text",
      message: 'Added custom event "Study Block" with day and time TBA.',
      scheduleRefreshRequired: true,
    });
    expect(mockHandleCustomScheduleEventMessage).toHaveBeenCalledWith({
      userId: OWNER_ID,
      scheduleId: SCHEDULE_ID,
      message: "add an event with time and date TBA",
      recentMessages: [],
    });
    expect(mockHandleScheduleEditMessage).not.toHaveBeenCalled();
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
    expect(res.body.type).toBe("clarification");
    expect(Array.isArray(res.body.options)).toBe(true);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("consumes structured clarification selection and resumes edit handling", async () => {
    mockGetPendingClarificationState.mockResolvedValueOnce({
      intent: { operation: "drop" },
      missing_slots: ["dropTarget"],
      candidate_options: {
        dropTarget: [{ sisOfferingName: "AS.030.205", courseCode: "030.205", term: "Spring 2026" }],
      },
      next_question: { slotKey: "dropTarget", prompt: "Which course should I drop?" },
      original_request: "drop AS.030.205",
    });
    mockHandleScheduleEditMessage.mockResolvedValueOnce({
      handled: true,
      payload: {
        type: "text",
        message: "Dropped 1 course from your schedule.",
        scheduleChanges: {
          operation: "drop",
          added: [],
          removed: [{ courseCode: "030.205", sisOfferingName: "AS.030.205", term: "Spring 2026" }],
          failed: [],
        },
      },
    });

    const res = await request(makeApp(OWNER_ID))
      .post("/api/agent")
      .send({
        message: "find ai electives",
        scheduleId: SCHEDULE_ID,
        stream: false,
        clarificationSelection: {
          slotKey: "dropTarget",
          choice: {
            sisOfferingName: "AS.030.205",
            courseCode: "030.205",
            term: "Spring 2026",
          },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "text",
      message: "Dropped 1 course from your schedule.",
      scheduleChanges: {
        operation: "drop",
        added: [],
        removed: [{ courseCode: "030.205", sisOfferingName: "AS.030.205", term: "Spring 2026" }],
        failed: [],
      },
    });
    expect(mockHandleScheduleEditMessage).toHaveBeenCalledWith({
      userId: OWNER_ID,
      scheduleId: SCHEDULE_ID,
      message: "drop AS.030.205 in Spring 2026",
    });
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("resolves empty-option pending clarification and continues with fresh parsing", async () => {
    mockGetPendingClarificationState.mockResolvedValueOnce({
      intent: { operation: "drop" },
      missing_slots: ["courseTarget"],
      candidate_options: {},
      next_question: {
        slotKey: "courseTarget",
        prompt: "Please clarify which course(s) you want to add or drop.",
      },
      original_request: "remove the course",
    });
    mockHandleScheduleEditMessage.mockResolvedValueOnce({
      handled: true,
      payload: {
        type: "text",
        message: "Dropped 1 course from your schedule.",
        scheduleChanges: {
          operation: "drop",
          added: [],
          removed: [{ courseCode: "601.226", sisOfferingName: "EN.601.226", term: "Spring 2026" }],
          failed: [],
        },
      },
    });

    const res = await request(makeApp(OWNER_ID))
      .post("/api/agent")
      .send({
        message: "drop EN.601.226",
        scheduleId: SCHEDULE_ID,
        stream: false,
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "text",
      message: "Dropped 1 course from your schedule.",
      scheduleChanges: {
        operation: "drop",
        added: [],
        removed: [{ courseCode: "601.226", sisOfferingName: "EN.601.226", term: "Spring 2026" }],
        failed: [],
      },
    });
    expect(mockResolvePendingClarificationState).toHaveBeenCalledWith(expect.anything(), CHAT_STATE_ID);
    expect(mockHandleScheduleEditMessage).toHaveBeenCalledWith({
      userId: OWNER_ID,
      scheduleId: SCHEDULE_ID,
      message: "drop EN.601.226",
    });
  });

  it("upserts pending clarification state for ambiguous schedule-edit payloads", async () => {
    mockHandleScheduleEditMessage.mockResolvedValueOnce({
      handled: true,
      payload: {
        type: "search",
        message: "I found multiple matching courses to add. Please choose one.",
        results: [
          {
            courseId: "en-601-226-spring-2026",
            code: "601.226",
            title: "Data Structures",
            description: "Core data structures and algorithms.",
            sisOfferingName: "EN.601.226",
            term: "Spring 2026",
          },
        ],
        scheduleChanges: {
          operation: "add",
          added: [],
          removed: [],
          failed: [
            {
              action: "add",
              reasonCode: "ambiguous_reference",
              message: "I found multiple matching courses to add. Please choose one.",
              candidates: [{ courseCode: "601.226", sisOfferingName: "EN.601.226", term: "Spring 2026" }],
            },
          ],
        },
      },
    });

    const res = await request(makeApp(OWNER_ID))
      .post("/api/agent")
      .send({ message: "add data structures", scheduleId: SCHEDULE_ID, stream: false });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("clarification");
    expect(mockUpsertPendingClarificationState).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        chatStateId: CHAT_STATE_ID,
        scheduleId: SCHEDULE_ID,
        userId: OWNER_ID,
        missingSlots: ["addTarget"],
        candidateOptions: {
          addTarget: [
            expect.objectContaining({
              code: "601.226",
              title: "Data Structures",
              sisOfferingName: "EN.601.226",
              term: "Spring 2026",
            }),
          ],
        },
        originalRequest: "add data structures",
      }),
    );
  });

  it("tracks both slots for mixed replace failures and prioritizes slot with options", async () => {
    mockHandleScheduleEditMessage.mockResolvedValueOnce({
      handled: true,
      payload: {
        type: "text",
        message: "I couldn't apply that schedule change yet.",
        scheduleChanges: {
          operation: "replace",
          added: [],
          removed: [],
          failed: [
            {
              action: "drop",
              reasonCode: "not_in_schedule",
              message: "That course is not currently in this schedule.",
            },
            {
              action: "add",
              reasonCode: "ambiguous_reference",
              message: "I found multiple matching courses. Please choose one.",
              candidates: [{ courseCode: "540.202", sisOfferingName: "EN.540.202", term: "Spring 2026" }],
            },
          ],
        },
      },
    });

    const res = await request(makeApp(OWNER_ID))
      .post("/api/agent")
      .send({ message: "replace wood with chemistry", scheduleId: SCHEDULE_ID, stream: false });

    expect(res.status).toBe(200);
    expect(mockUpsertPendingClarificationState).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        missingSlots: ["addTarget", "dropTarget"],
        nextQuestion: expect.objectContaining({ slotKey: "addTarget" }),
      }),
    );
  });

  it("upserts text-only clarification slots when ambiguous payload has no candidates", async () => {
    mockHandleScheduleEditMessage.mockResolvedValueOnce({
      handled: true,
      payload: {
        type: "text",
        message: "Please clarify which course(s) you want to add or drop.",
        scheduleChanges: {
          operation: "drop",
          added: [],
          removed: [],
          failed: [
            {
              action: "drop",
              reasonCode: "ambiguous_reference",
              message: "Please clarify which course(s) you want to add or drop.",
            },
          ],
        },
      },
    });

    const res = await request(makeApp(OWNER_ID))
      .post("/api/agent")
      .send({ message: "remove the course", scheduleId: SCHEDULE_ID, stream: false });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "clarification",
      question: "Please clarify which course(s) you want to add or drop.",
      message: "Please clarify which course(s) you want to add or drop.",
      slotKey: "dropTarget",
      options: [],
    });
    expect(mockUpsertPendingClarificationState).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        missingSlots: ["dropTarget"],
        candidateOptions: {},
      }),
    );
  });

  it("accepts multiple structured clarification selections for add disambiguation", async () => {
    mockGetPendingClarificationState.mockResolvedValueOnce({
      intent: { operation: "add" },
      missing_slots: ["addTarget"],
      confirmed_slots: {},
      candidate_options: {
        addTarget: [
          {
            id: "en-601-226-spring-2026",
            code: "601.226",
            title: "Data Structures",
            sisOfferingName: "EN.601.226",
            term: "Spring 2026",
          },
          {
            id: "en-601-229-spring-2026",
            code: "601.229",
            title: "Computer Systems Fundamentals",
            sisOfferingName: "EN.601.229",
            term: "Spring 2026",
          },
        ],
      },
      next_question: { slotKey: "addTarget", prompt: "Which course should I add?" },
      original_request: "add data structures and systems",
    });
    mockHandleScheduleEditMessage.mockResolvedValueOnce({
      handled: true,
      payload: {
        type: "text",
        message: "Added 2 courses to your schedule.",
        scheduleChanges: {
          operation: "add",
          added: [
            { courseCode: "601.226", sisOfferingName: "EN.601.226", term: "Spring 2026" },
            { courseCode: "601.229", sisOfferingName: "EN.601.229", term: "Spring 2026" },
          ],
          removed: [],
          failed: [],
        },
      },
    });

    const res = await request(makeApp(OWNER_ID))
      .post("/api/agent")
      .send({
        message: "select both",
        scheduleId: SCHEDULE_ID,
        stream: false,
        clarificationSelection: {
          slotKey: "addTarget",
          choices: [
            {
              sisOfferingName: "EN.601.226",
              courseCode: "601.226",
              term: "Spring 2026",
            },
            {
              sisOfferingName: "EN.601.229",
              courseCode: "601.229",
              term: "Spring 2026",
            },
          ],
        },
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "text",
      message: "Added 2 courses to your schedule.",
      scheduleChanges: {
        operation: "add",
        added: [
          { courseCode: "601.226", sisOfferingName: "EN.601.226", term: "Spring 2026" },
          { courseCode: "601.229", sisOfferingName: "EN.601.229", term: "Spring 2026" },
        ],
        removed: [],
        failed: [],
      },
    });
    expect(mockHandleScheduleEditMessage).toHaveBeenCalledWith({
      userId: OWNER_ID,
      scheduleId: SCHEDULE_ID,
      message: "add EN.601.226 in Spring 2026 and EN.601.229 in Spring 2026",
    });
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

  it("does not let getCourseEvalSummary no-data override queryCourseMetrics output in the same turn", async () => {
    const metricsMessage =
      "For EN.601.220 in Spring 2026, workload is 4.28, difficulty is 4.4, and overall quality is 3.93 (historical offerings).";
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        type: "text",
        message: metricsMessage,
      }),
      steps: [
        {
          toolResults: [
            {
              toolName: "queryCourseMetrics",
              output: {
                courseCode: "EN.601.220",
                requestedTerm: "Spring 2026",
                evaluationsTermRange: "2022 Spring – 2025 Fall",
                metricsSource: "historical_offerings",
                term: "Spring 2026",
                scope: "term-specific",
                meta: {
                  semestersIncluded: ["2025 Fall", "2025 Spring", "2024 Fall", "2024 Spring"],
                  evaluationRowCount: 31,
                  termFilterApplied: "Spring 2026",
                },
                metrics: {
                  workload: 4.28,
                  difficulty: 4.4,
                  overallQuality: 3.93,
                  respondentCount: 1072,
                },
              },
            },
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
      message: "how hard is EN.601.220 in Spring 2026",
      stream: false,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "text",
      message: metricsMessage,
    });
  });

  it("returns clarification disambiguation instead of course cards for ambiguous 'how hard' queries", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        type: "text",
        message: "EN.553.101 is 3.2 workload and EN.553.111 is 3.8 workload.",
      }),
      steps: [
        {
          toolResults: [
            {
              toolName: "searchCoursesBySisConstraints",
              output: {
                courses: [
                  {
                    offeringName: "AS.553.101",
                    sectionName: "01",
                    title: "Calculus I",
                    description: "",
                    schoolName: "Krieger School of Arts and Sciences",
                    department: "Mathematics",
                    level: "Lower Level Undergraduate",
                    timeOfDay: "morning",
                    daysOfWeek: "Mon/Wed/Fri",
                    location: "Gilman 50",
                    instructors: ["Prof. A"],
                    status: "Open",
                  },
                  {
                    offeringName: "AS.553.111",
                    sectionName: "01",
                    title: "Calculus II",
                    description: "",
                    schoolName: "Krieger School of Arts and Sciences",
                    department: "Mathematics",
                    level: "Lower Level Undergraduate",
                    timeOfDay: "afternoon",
                    daysOfWeek: "Tue/Thu",
                    location: "Gilman 132",
                    instructors: ["Prof. B"],
                    status: "Open",
                  },
                ],
              },
            },
            {
              toolName: "queryCourseMetrics",
              output: {
                courseCode: "AS.553.101",
                term: "Spring 2026",
                scope: "term-specific",
                metrics: { workload: 3.2, difficulty: 3.6, overallQuality: 4.1, respondentCount: 120 },
              },
            },
            {
              toolName: "queryCourseMetrics",
              output: {
                courseCode: "AS.553.111",
                term: "Spring 2026",
                scope: "term-specific",
                metrics: { workload: 3.8, difficulty: 4.0, overallQuality: 3.9, respondentCount: 98 },
              },
            },
          ],
        },
      ],
    });

    const res = await request(makeApp()).post("/api/agent").send({
      message: "how hard is che in spring 2026",
      stream: false,
    });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("clarification");
    expect(res.body.message).toBe(
      "I found multiple matching courses. Please choose one to see workload and difficulty metrics.",
    );
    expect(res.body.slotKey).toBe("metricsCourseTarget");
    expect(Array.isArray(res.body.options)).toBe(true);
    expect(res.body.options).toHaveLength(2);
    expect(res.body.options[0]).toMatchObject({
      code: "AS.553.101",
      sisOfferingName: "AS.553.101",
      title: "Calculus I",
      term: "Spring 2026",
    });
    expect(String(res.body.options[0].courseId)).toContain("spring-2026");
  });

  it("returns metrics clarification when only semantic search produced multiple ambiguous matches", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        type: "search",
        results: [
          {
            courseId: "en-600-101-spring-2026",
            sisOfferingName: "EN.600.101",
            code: "EN.600.101",
            title: "Intro Science",
            description: "Foundations of scientific thinking.",
            term: "Spring 2026",
          },
          {
            courseId: "as-030-205-spring-2026",
            sisOfferingName: "AS.030.205",
            code: "AS.030.205",
            title: "Science and Society",
            description: "Intersections between science and public life.",
            term: "Spring 2026",
          },
        ],
      }),
      steps: [
        {
          toolResults: [
            {
              toolName: "searchCourseDescriptions",
              output: {
                results: [
                  {
                    courseId: "en-600-101-spring-2026",
                    sisOfferingName: "EN.600.101",
                    code: "EN.600.101",
                    title: "Intro Science",
                    description: "Foundations of scientific thinking.",
                    term: "Spring 2026",
                    rank: 1,
                    relevanceScore: 0.84,
                    clearlyMatches: false,
                  },
                  {
                    courseId: "as-030-205-spring-2026",
                    sisOfferingName: "AS.030.205",
                    code: "AS.030.205",
                    title: "Science and Society",
                    description: "Intersections between science and public life.",
                    term: "Spring 2026",
                    rank: 2,
                    relevanceScore: 0.79,
                    clearlyMatches: false,
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const res = await request(makeApp()).post("/api/agent").send({
      message: "how hard is science",
      stream: false,
    });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("clarification");
    expect(res.body.slotKey).toBe("metricsCourseTarget");
    expect(res.body.message).toBe(
      "I found multiple matching courses. Please choose one to see workload and difficulty metrics.",
    );
    expect(Array.isArray(res.body.options)).toBe(true);
    expect(res.body.options).toHaveLength(2);
    expect(res.body.options[0]).toMatchObject({
      courseCode: "EN.600.101",
      sisOfferingName: "EN.600.101",
      title: "Intro Science",
      term: "Spring 2026",
    });
    expect(String(res.body.options[0].courseId)).toContain("spring-2026");
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

  it("registers queryCourseMetrics and delegates to the tool implementation", async () => {
    await request(makeApp()).post("/api/agent").send({
      message: "how hard is EN.601.226 in Spring 2026",
      stream: false,
    });

    const generateTextArgs = mockGenerateText.mock.calls[0]?.[0] as {
      tools: Record<string, { execute: (input: { courseCode: string; term: string }) => Promise<unknown> }>;
    };

    const result = await generateTextArgs.tools.queryCourseMetrics.execute({
      courseCode: "EN.601.226",
      term: "Spring 2026",
    });

    expect(mockQueryCourseMetrics).toHaveBeenCalledWith("EN.601.226", "Spring 2026");
    expect(result).toEqual({
      courseCode: "EN.601.226",
      requestedTerm: "Spring 2026",
      evaluationsTermRange: "Fall 2024 – Spring 2025",
      metricsSource: "historical_offerings",
      term: "Spring 2026",
      scope: "term-specific",
      meta: {
        semestersIncluded: ["Spring 2026"],
        evaluationRowCount: 2,
        termFilterApplied: "Spring 2026",
      },
      metrics: {
        workload: 3.25,
        difficulty: 3.75,
        overallQuality: 4.1,
        respondentCount: 40,
      },
    });
  });

  it("short-circuits queryCourseMetrics until metrics ambiguity is resolved", async () => {
    mockSearchCoursesBySisConstraints.mockResolvedValueOnce({
      courses: [
        {
          offeringName: "AS.553.101",
          title: "Calculus I",
          daysOfWeek: "Mon/Wed/Fri",
          timeOfDay: "morning",
          instructors: ["Prof. A"],
          status: "Open",
        },
        {
          offeringName: "AS.553.111",
          title: "Calculus II",
          daysOfWeek: "Tue/Thu",
          timeOfDay: "afternoon",
          instructors: ["Prof. B"],
          status: "Open",
        },
      ],
    });

    await request(makeApp()).post("/api/agent").send({
      message: "how hard is calculus in spring 2026",
      stream: false,
    });

    const generateTextArgs = mockGenerateText.mock.calls[0]?.[0] as {
      tools: {
        searchCoursesBySisConstraints: { execute: (input: unknown) => Promise<{ courses: unknown[] }> };
        queryCourseMetrics: { execute: (input: { courseCode: string; term: string }) => Promise<Record<string, unknown>> };
      };
    };

    await generateTextArgs.tools.searchCoursesBySisConstraints.execute({
      Term: "Spring 2026",
      CourseTitle: "calculus",
      limit: 5,
    });

    const result = await generateTextArgs.tools.queryCourseMetrics.execute({
      courseCode: "AS.553.101",
      term: "Spring 2026",
    });

    expect(mockQueryCourseMetrics).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      disambiguationRequired: true,
      scope: "cross-term",
      term: "All terms",
    });
    expect(Array.isArray(result.disambiguationCandidates)).toBe(true);
  });

  it("handles multiple metrics clarification selections in one response", async () => {
    mockQueryCourseMetrics
      .mockResolvedValueOnce({
        courseCode: "AS.553.101",
        requestedTerm: "Spring 2026",
        evaluationsTermRange: "Fall 2024 – Spring 2025",
        metricsSource: "historical_offerings",
        term: "Spring 2026",
        scope: "term-specific",
        meta: {
          semestersIncluded: ["Spring 2026"],
          evaluationRowCount: 2,
          termFilterApplied: "Spring 2026",
        },
        metrics: {
          workload: 3.25,
          difficulty: 3.75,
          overallQuality: 4.1,
          respondentCount: 40,
        },
      })
      .mockResolvedValueOnce({
        courseCode: "EN.601.226",
        requestedTerm: "All terms",
        evaluationsTermRange: "Fall 2023 – Spring 2025",
        metricsSource: "all_available",
        term: "All terms",
        scope: "cross-term",
        meta: {
          semestersIncluded: ["Fall 2023", "Spring 2025"],
          evaluationRowCount: 4,
          termFilterApplied: null,
        },
        metrics: {
          workload: 3.5,
          difficulty: 3.9,
          overallQuality: 4.2,
          respondentCount: 87,
        },
      });

    const res = await request(makeApp()).post("/api/agent").send({
      message: "these two",
      stream: false,
      clarificationSelection: {
        slotKey: "metricsCourseTarget",
        choices: [
          {
            courseCode: "AS.553.101",
            term: "Spring 2026",
            sisOfferingName: "AS.553.101",
          },
          {
            courseCode: "EN.601.226",
            term: "All terms",
            sisOfferingName: "EN.601.226",
          },
        ],
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("text");
    expect(res.body.message).toContain("AS.553.101 (for Spring 2026)");
    expect(res.body.message).toContain("EN.601.226 (across all terms)");
    expect(mockQueryCourseMetrics).toHaveBeenNthCalledWith(1, "AS.553.101", "Spring 2026");
    expect(mockQueryCourseMetrics).toHaveBeenNthCalledWith(2, "EN.601.226", undefined);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("sanitizes metrics clarification term before invoking queryCourseMetrics", async () => {
    mockClampCourseMetricsTermToAllowedWindow.mockReturnValueOnce("Fall 2025");

    const res = await request(makeApp()).post("/api/agent").send({
      message: "AS.553.101",
      stream: false,
      clarificationSelection: {
        slotKey: "metricsCourseTarget",
        choice: {
          courseCode: "AS.553.101",
          term: "Spring 2026",
          sisOfferingName: "AS.553.101",
        },
      },
    });

    expect(res.status).toBe(200);
    expect(mockClampCourseMetricsTermToAllowedWindow).toHaveBeenCalledWith("Spring 2026");
    expect(mockQueryCourseMetrics).toHaveBeenCalledWith("AS.553.101", "Fall 2025");
  });

  it("returns queryCourseMetrics output with metrics: null when no evaluation rows exist", async () => {
    mockQueryCourseMetrics.mockResolvedValueOnce({
      courseCode: "EN.601.226",
      requestedTerm: "Spring 2026",
      evaluationsTermRange: null,
      metricsSource: null,
      term: "Spring 2026",
      scope: "term-specific",
      meta: {
        semestersIncluded: [],
        evaluationRowCount: 0,
        termFilterApplied: "Spring 2026",
      },
      metrics: null,
    });

    await request(makeApp()).post("/api/agent").send({
      message: "how hard is EN.601.226 in Spring 2026",
      stream: false,
    });

    const generateTextArgs = mockGenerateText.mock.calls[0]?.[0] as {
      tools: Record<string, { execute: (input: { courseCode: string; term: string }) => Promise<unknown> }>;
    };

    await expect(
      generateTextArgs.tools.queryCourseMetrics.execute({
        courseCode: "EN.601.226",
        term: "Spring 2026",
      }),
    ).resolves.toEqual({
      courseCode: "EN.601.226",
      requestedTerm: "Spring 2026",
      evaluationsTermRange: null,
      metricsSource: null,
      term: "Spring 2026",
      scope: "term-specific",
      meta: {
        semestersIncluded: [],
        evaluationRowCount: 0,
        termFilterApplied: "Spring 2026",
      },
      metrics: null,
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

  it("does not use ambiguous normalized code fallback across schools", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        type: "search",
        results: [
          {
            courseId: "unknown-course",
            code: "110.125",
            title: "Linear Algebra",
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
                    offeringName: "AS.110.125",
                    daysOfWeek: "Mon/Wed",
                    timeOfDay: "morning",
                  },
                  {
                    offeringName: "EN.110.125",
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
    expect(res.body.results[0].preferenceAlignment).toBeUndefined();
    expect(res.body.results[0].daysOfWeek).toBeUndefined();
    expect(res.body.results[0].timeOfDay).toBeUndefined();
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
