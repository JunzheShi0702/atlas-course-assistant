import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const {
  mockGenerateText,
  mockStreamText,
  mockIsQueryInProductScope,
  mockSearchCourseDescriptions,
  mockSearchCoursesBySisConstraints,
  mockPoolQuery,
  mockHandleScheduleEditMessage,
  mockGetSisCourseDetails,
  mockQueryCourseMetrics,
} = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockStreamText: vi.fn(),
  mockIsQueryInProductScope: vi.fn(),
  mockSearchCourseDescriptions: vi.fn(),
  mockSearchCoursesBySisConstraints: vi.fn(),
  mockPoolQuery: vi.fn(),
  mockHandleScheduleEditMessage: vi.fn(),
  mockGetSisCourseDetails: vi.fn(),
  mockQueryCourseMetrics: vi.fn(),
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
  OUT_OF_SCOPE_REDIRECT_MESSAGE: "I can only help with JHU course planning right now.",
}));

vi.mock("../services/schedule-context", () => ({
  loadScheduleContextForAgent: vi.fn(),
  buildScheduleContextBlock: vi.fn(() => ""),
  loadUserMemoryContextForAgent: vi.fn(() => Promise.resolve({ canonicalMemories: [] })),
  buildUserMemoriesOnlyBlock: vi.fn(() => ""),
}));

vi.mock("../pool", () => ({
  pool: { query: mockPoolQuery },
}));

vi.mock("../services/chat-persistence", () => ({
  getOrCreateChatState: vi.fn(),
  persistMessage: vi.fn(),
  enforceRetentionPolicy: vi.fn(),
  loadRecentMessages: vi.fn(() => Promise.resolve([])),
  formatChatHistoryBlock: vi.fn(() => ""),
}));

vi.mock("../services/chat-memory-extraction", () => ({
  runChatMemoryExtraction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/schedule-edit-orchestrator", () => ({
  handleScheduleEditMessage: mockHandleScheduleEditMessage,
}));

vi.mock("../services/get-sis-course-details", () => ({
  getSisCourseDetails: mockGetSisCourseDetails,
}));

vi.mock("../tools/query-course-metrics", () => ({
  queryCourseMetrics: mockQueryCourseMetrics,
}));

vi.mock("../tools/search-course-descriptions", () => ({
  searchCourseDescriptions: mockSearchCourseDescriptions,
}));

vi.mock("../tools/search-courses-by-sis-constraints", () => ({
  searchCoursesBySisConstraints: mockSearchCoursesBySisConstraints,
}));

import agentRouter from "./agent";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/agent", agentRouter);
  return app;
}

describe("POST /api/agent unified search integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPoolQuery.mockResolvedValue({ rows: [] });
    mockIsQueryInProductScope.mockResolvedValue(true);
    mockHandleScheduleEditMessage.mockResolvedValue({ handled: false });
    mockGetSisCourseDetails.mockResolvedValue({ courseId: null, course: null });
    mockQueryCourseMetrics.mockResolvedValue({ courseCode: "", term: "All terms", metrics: null });
    mockStreamText.mockReturnValue({
      text: Promise.resolve(JSON.stringify({ type: "text", message: "hello" })),
      steps: Promise.resolve([]),
    });
  });

  it("executes unified search through /api/agent and caps merged rows to limit", async () => {
    mockSearchCourseDescriptions.mockResolvedValueOnce({
      results: Array.from({ length: 5 }, (_, index) => ({
        courseId: `semantic-${index + 1}`,
        sisOfferingName: `EN.601.22${index + 1}.01`,
        code: `EN.601.22${index + 1}`,
        title: `Semantic Course ${index + 1}`,
        description: "semantic description",
        term: "Spring 2026",
        daysOfWeek: "Mon/Wed",
        rank: index + 1,
        relevanceScore: 0.9 - index * 0.05,
      })),
    });
    mockSearchCoursesBySisConstraints.mockResolvedValueOnce({
      courses: Array.from({ length: 5 }, (_, index) => ({
        offeringName: `AS.100.10${index + 1}.01`,
        sectionName: "01",
        title: `Structured Course ${index + 1}`,
        description: "",
        schoolName: "Krieger School of Arts and Sciences",
        department: "AS Something",
        level: "Lower Level Undergraduate",
        timeOfDay: "morning",
        daysOfWeek: "Tue/Thu",
        location: "Homewood",
        instructors: ["Instructor"],
        status: "Open",
      })),
    });

    mockGenerateText.mockImplementationOnce(async (args: { tools: Record<string, { execute: (input: unknown) => Promise<unknown> }> }) => {
      const out = (await args.tools.searchCourses.execute({
        query: "machine learning",
        Term: "Spring 2026",
        School: "Whiting School of Engineering",
        limit: 5,
      })) as { results: unknown[] };

      return {
        text: JSON.stringify({
          type: "search",
          results: out.results,
        }),
        steps: [],
      };
    });

    const res = await request(makeApp()).post("/api/agent").send({
      message: "find machine learning classes in WSE",
      stream: false,
    });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("search");
    expect(res.body.results).toHaveLength(5);
    expect(res.body.results.map((row: { rank: number }) => row.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(mockSearchCourseDescriptions).toHaveBeenCalledWith({
      query: "machine learning",
      limit: 5,
    });
    expect(mockSearchCoursesBySisConstraints).toHaveBeenCalledWith(
      expect.objectContaining({
        Term: "Spring 2026",
        School: ["Whiting School of Engineering"],
        Level: ["Lower Level Undergraduate", "Upper Level Undergraduate"],
      }),
      5,
    );
  });
});
