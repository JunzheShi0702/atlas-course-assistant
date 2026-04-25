import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockQuery, mockConnect } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockConnect: vi.fn(),
}));

const { mockSearchCoursesBySisConstraints } = vi.hoisted(() => ({
  mockSearchCoursesBySisConstraints: vi.fn(),
}));

vi.mock("../db", () => ({
  pool: {
    query: mockQuery,
    connect: mockConnect,
  },
}));

vi.mock("../services/parse-onboarding-responses", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../services/parse-onboarding-responses")>();
  return {
    ...mod,
    parseOnboardingResponses: vi.fn(),
  };
});

vi.mock("../tools/search-courses-by-sis-constraints", () => ({
  searchCoursesBySisConstraints: mockSearchCoursesBySisConstraints,
}));

import { parseOnboardingResponses } from "../services/parse-onboarding-responses";
import {
  handleUpsertUser,
  handleGetProfile,
  handleUpsertProfile,
  handleListMemories,
  handleDeleteMemory,
  handleClearConversationMemories,
  handleAddManualMemory,
  handleAddCourseHistoryMemory,
  handleProcessTranscript,
  handleSaveTranscript,
  handleDeleteUser,
  requireAuth,
  dbRowToClientProfile,
} from "./users";
const mockParseOnboarding = vi.mocked(parseOnboardingResponses);

const defaultParsedMemories = {
  goals: [{ value: "parsed_goal", confidence: 0.8, fromSelectedChoice: false }],
  workloadTolerance: "medium" as const,
  workloadFromSelectedChoiceOnly: false,
  workloadConfidence: 0.75,
  timePreferences: [] as Array<{ value: string; confidence: number; fromSelectedChoice: boolean }>,
  notes: [] as Array<{ value: string; confidence: number; fromSelectedChoice: boolean }>,
};

function makeRes() {
  const res = {
    json: vi.fn(),
    status: vi.fn(),
    send: vi.fn(),
  } as unknown as import("express").Response;
  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
}

const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

const fakeUser = {
  id: TEST_USER_ID,
  email: "alice@jhu.edu",
  google_sub: "google-sub-123",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const fakeDbProfileRow = {
  user_id: TEST_USER_ID,
  graduation_month: 5,
  graduation_year: 2026,
  degrees: ["B.S. Computer Science"],
  school: "Whiting School of Engineering",
  raw_goals_text: null as string | null,
  raw_workload_text: null as string | null,
  raw_preferences_text: null as string | null,
  derived_memories: [],
  updated_at: "2026-01-01T00:00:00Z",
};

const fakeClientProfile = dbRowToClientProfile(
  fakeDbProfileRow as unknown as Record<string, unknown>,
);

const authedReqBase = { user: { id: TEST_USER_ID, email: "alice@jhu.edu" } };

beforeEach(() => {
  vi.clearAllMocks();
  mockConnect.mockReset();
  mockParseOnboarding.mockResolvedValue(defaultParsedMemories);
  mockSearchCoursesBySisConstraints.mockResolvedValue({ courses: [] });
  mockQuery.mockImplementation((sql: string) => {
    const s = String(sql).toLowerCase();
    if (s.includes("delete from user_memories") && s.includes("source = 'onboarding'")) {
      return Promise.resolve({ rows: [] });
    }
    if (s.includes("insert into user_memories")) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
});

// ---------------------------------------------------------------------------
// requireAuth
// ---------------------------------------------------------------------------

describe("requireAuth", () => {
  it("calls next when req.user is set", () => {
    const req = { user: { id: TEST_USER_ID, email: "alice@jhu.edu" } } as import("express").Request;
    const res = makeRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 401 when req.user is undefined", () => {
    const req = {} as import("express").Request;
    const res = makeRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// dbRowToClientProfile (graduation month round-trip vs MONTH_NAME_TO_NUM)
// ---------------------------------------------------------------------------

describe("dbRowToClientProfile", () => {
  const emptyRest = {
    graduation_year: null,
    degrees: null,
    school: null,
    raw_goals_text: null,
    raw_workload_text: null,
    raw_preferences_text: null,
  };

  it("maps every stored graduation_month 1–12 to English month names (not numeric strings)", () => {
    expect(
      dbRowToClientProfile({ graduation_month: 1, ...emptyRest }).graduationMonth,
    ).toBe("January");
    expect(
      dbRowToClientProfile({ graduation_month: 12, ...emptyRest }).graduationMonth,
    ).toBe("December");
    expect(
      dbRowToClientProfile({ graduation_month: 5, ...emptyRest }).graduationMonth,
    ).toBe("May");
  });
});

// ---------------------------------------------------------------------------
// handleUpsertUser
// ---------------------------------------------------------------------------

describe("handleUpsertUser", () => {
  it("returns 400 when email is missing", async () => {
    const req = { body: { google_sub: "sub-123" } } as import("express").Request;
    const res = makeRes();
    await handleUpsertUser(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when google_sub is missing", async () => {
    const req = { body: { email: "alice@jhu.edu" } } as import("express").Request;
    const res = makeRes();
    await handleUpsertUser(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns the upserted user row", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeUser] } as never);
    const req = { body: { email: "alice@jhu.edu", google_sub: "google-sub-123" } } as import("express").Request;
    const res = makeRes();
    await handleUpsertUser(req, res);
    expect(res.json).toHaveBeenCalledWith(fakeUser);
  });

  it("returns 500 when the query throws", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db error") as never);
    const req = { body: { email: "alice@jhu.edu", google_sub: "google-sub-123" } } as import("express").Request;
    const res = makeRes();
    await handleUpsertUser(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ---------------------------------------------------------------------------
// handleGetProfile
// ---------------------------------------------------------------------------

describe("handleGetProfile", () => {
  it("returns 401 when unauthenticated", () => {
    const req = {} as import("express").Request;
    const res = makeRes();
    requireAuth(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
    expect(mockQuery).not.toHaveBeenCalled();
  });
  it("returns the profile as camelCase when found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeDbProfileRow] } as never);
    const req = { ...authedReqBase } as unknown as import("express").Request;
    const res = makeRes();
    await handleGetProfile(req, res);
    expect(res.json).toHaveBeenCalledWith(fakeClientProfile);
  });

  it("returns 404 when no profile exists", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    const req = { ...authedReqBase } as unknown as import("express").Request;
    const res = makeRes();
    await handleGetProfile(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("queries by the authenticated user id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeDbProfileRow] } as never);
    const req = { ...authedReqBase } as unknown as import("express").Request;
    await handleGetProfile(req, makeRes());
    expect(mockQuery.mock.calls[0][1]).toEqual([TEST_USER_ID]);
  });

  it("returns 500 when the query throws", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db error") as never);
    const req = { ...authedReqBase } as unknown as import("express").Request;
    const res = makeRes();
    await handleGetProfile(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ---------------------------------------------------------------------------
// handleUpsertProfile
// ---------------------------------------------------------------------------

describe("handleUpsertProfile", () => {
  it("returns 401 when unauthenticated", () => {
    const req = {} as import("express").Request;
    const res = makeRes();
    requireAuth(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns the upserted profile in camelCase", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeDbProfileRow] } as never);
    const req = {
      ...authedReqBase,
      body: { graduationMonth: "May", graduationYear: "2026" },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleUpsertProfile(req, res);
    expect(res.json).toHaveBeenCalledWith(fakeClientProfile);
  });

  it("uses the authenticated user id for the query", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeDbProfileRow] } as never);
    const req = {
      ...authedReqBase,
      body: { school: "Whiting School of Engineering" },
    } as unknown as import("express").Request;
    await handleUpsertProfile(req, makeRes());
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe(TEST_USER_ID);
  });

  it("passes null for omitted fields so COALESCE keeps existing values", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeDbProfileRow] } as never);
    const req = {
      ...authedReqBase,
      body: { school: "Whiting School of Engineering" },
    } as unknown as import("express").Request;
    await handleUpsertProfile(req, makeRes());
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[1]).toBeNull(); // graduation_month
    expect(params[2]).toBeNull(); // graduation_year
    expect(params[3]).toBeNull(); // degrees
    expect(params[4]).toBe("Whiting School of Engineering");
    expect(params[5]).toBeNull(); // raw_goals_text
    expect(params[6]).toBeNull(); // raw_workload_text
    expect(params[7]).toBeNull(); // raw_preferences_text
    expect(params[8]).toBeNull(); // derived_memories JSON
  });

  it("stores JSON from parseOnboardingResponses when goalsText is present", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            raw_goals_text: null,
            raw_workload_text: null,
            raw_preferences_text: null,
          },
        ],
      } as never)
      .mockResolvedValueOnce({ rows: [fakeDbProfileRow] } as never);
    const req = {
      ...authedReqBase,
      body: { goalsText: "PhD in robotics" },
    } as unknown as import("express").Request;
    await handleUpsertProfile(req, makeRes());
    expect(mockParseOnboarding).toHaveBeenCalled();
    const upsertParams = mockQuery.mock.calls[1][1] as unknown[];
    expect(upsertParams[8]).toBe(JSON.stringify(defaultParsedMemories));
  });

  it("does not recompute derived_memories when goalPresets is an empty array", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeDbProfileRow] } as never);
    const req = {
      ...authedReqBase,
      body: { school: "Krieger School of Arts and Sciences", goalPresets: [] },
    } as unknown as import("express").Request;
    await handleUpsertProfile(req, makeRes());
    expect(mockParseOnboarding).not.toHaveBeenCalled();
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[8]).toBeNull();
  });

  it("passes null for derived_memories when parse returns null (e.g. LLM failure)", async () => {
    mockParseOnboarding.mockResolvedValueOnce(null);
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            raw_goals_text: null,
            raw_workload_text: null,
            raw_preferences_text: null,
          },
        ],
      } as never)
      .mockResolvedValueOnce({ rows: [fakeDbProfileRow] } as never);
    const req = {
      ...authedReqBase,
      body: { goalsText: "PhD in robotics" },
    } as unknown as import("express").Request;
    await handleUpsertProfile(req, makeRes());
    expect(mockParseOnboarding).toHaveBeenCalled();
    const upsertParams = mockQuery.mock.calls[1][1] as unknown[];
    expect(upsertParams[8]).toBeNull();
  });

  it("loads existing raw texts for parsing when only goalPresets is sent", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            raw_goals_text: "Keep grad school",
            raw_workload_text: "Light term",
            raw_preferences_text: "Mornings",
          },
        ],
      } as never)
      .mockResolvedValueOnce({ rows: [fakeDbProfileRow] } as never);
    const req = {
      ...authedReqBase,
      body: { goalPresets: ["research_track"] },
    } as unknown as import("express").Request;
    await handleUpsertProfile(req, makeRes());
    expect(mockQuery).toHaveBeenCalledTimes(6);
    expect(mockParseOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({
        goals: "Keep grad school",
        workload: "Light term",
        preferences: "Mornings",
        goalPresets: ["research_track"],
      }),
    );
  });

  it("returns 400 when body fails schema validation", async () => {
    const req = {
      ...authedReqBase,
      body: { goalsText: "x".repeat(10001) },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleUpsertProfile(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 400 when graduationMonth is not 1–12 or a known month name", async () => {
    const req = {
      ...authedReqBase,
      body: { graduationMonth: "Smarch" },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleUpsertProfile(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 400 when graduationYear is before 2026", async () => {
    const req = {
      ...authedReqBase,
      body: { graduationYear: "2025" },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleUpsertProfile(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 400 when graduationYear is after 2100", async () => {
    const req = {
      ...authedReqBase,
      body: { graduationYear: "2101" },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleUpsertProfile(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 400 when degrees has empty segments between semicolons", async () => {
    const req = {
      ...authedReqBase,
      body: { degrees: "B.S.;;B.A." },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleUpsertProfile(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 500 when the query throws", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db error") as never);
    const req = {
      ...authedReqBase,
      body: {},
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleUpsertProfile(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("first-time PUT with minimal body succeeds when derived_memories is not provided", async () => {
    const minimalProfile = { ...fakeDbProfileRow, derived_memories: [] };
    mockQuery.mockResolvedValueOnce({ rows: [minimalProfile] } as never);
    const req = {
      ...authedReqBase,
      body: { school: "Krieger School of Arts and Sciences" },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleUpsertProfile(req, res);
    expect(res.json).toHaveBeenCalledWith(
      dbRowToClientProfile(minimalProfile as unknown as Record<string, unknown>),
    );
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[8]).toBeNull();
  });

  it("stores raw text fields from camelCase body and returns camelCase profile", async () => {
    const rowWithText = {
      ...fakeDbProfileRow,
      raw_goals_text: "Still exploring",
      raw_workload_text: "Moderate",
      raw_preferences_text: "No preference",
    };
    mockQuery.mockResolvedValueOnce({ rows: [rowWithText] } as never);
    const req = {
      ...authedReqBase,
      body: {
        goalsText: "Still exploring",
        workloadText: "Moderate",
        preferencesText: "No preference",
      },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleUpsertProfile(req, res);
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[5]).toBe("Still exploring");
    expect(params[6]).toBe("Moderate");
    expect(params[7]).toBe("No preference");
    expect(params[8]).toBe(JSON.stringify(defaultParsedMemories));
    expect(mockParseOnboarding).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      dbRowToClientProfile(rowWithText as unknown as Record<string, unknown>),
    );
  });

  it("maps May / 2026 to graduation_month and graduation_year", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeDbProfileRow] } as never);
    const req = {
      ...authedReqBase,
      body: { graduationMonth: "May", graduationYear: "2026" },
    } as unknown as import("express").Request;
    await handleUpsertProfile(req, makeRes());
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[1]).toBe(5);
    expect(params[2]).toBe(2026);
  });
});

const MEMORY_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("handleListMemories", () => {
  it("returns memories in API shape", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: MEMORY_ID,
          memory_text: "Prefer afternoon",
          memory_type: "preference",
          source: "chat",
          confidence: "0.85",
          created_at: new Date("2026-04-01T12:00:00.000Z"),
        },
      ],
    } as never);
    const req = { ...authedReqBase } as import("express").Request;
    const res = makeRes();
    await handleListMemories(req, res);
    expect(res.json).toHaveBeenCalledWith({
      memories: [
        {
          id: MEMORY_ID,
          text: "Prefer afternoon",
          type: "preference",
          source: "chat",
          confidence: 0.85,
          createdAt: "2026-04-01T12:00:00.000Z",
        },
      ],
    });
  });

  it("returns 500 when query fails", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db") as never);
    const req = { ...authedReqBase } as import("express").Request;
    const res = makeRes();
    await handleListMemories(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("uses database user id for query (strips dev- prefix)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    const devId = "dev-user-00000000-0000-0000-0000-000000000001";
    const req = { user: { id: devId, email: "dev@example.com" } } as import("express").Request;
    const res = makeRes();
    await handleListMemories(req, res);
    expect(mockQuery.mock.calls[0][1]).toEqual(["00000000-0000-0000-0000-000000000001"]);
  });
});

describe("handleDeleteMemory", () => {
  it("returns 400 for invalid id", async () => {
    const req = {
      ...authedReqBase,
      params: { id: "not-a-uuid" },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleDeleteMemory(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 404 when memory missing", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    const req = {
      ...authedReqBase,
      params: { id: MEMORY_ID },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleDeleteMemory(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 409 for onboarding source", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: MEMORY_ID, source: "onboarding" }] } as never);
    const req = {
      ...authedReqBase,
      params: { id: MEMORY_ID },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleDeleteMemory(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      message: "Edit profile preferences to change this memory.",
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("deletes and returns 204 for chat source", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: MEMORY_ID, source: "chat" }] } as never)
      .mockResolvedValueOnce({ rowCount: 1 } as never);
    const req = {
      ...authedReqBase,
      params: { id: MEMORY_ID },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleDeleteMemory(req, res);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalledWith();
    expect(mockQuery.mock.calls[1][0]).toContain("DELETE FROM user_memories");
  });

  it("deletes and returns 204 for manual source", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: MEMORY_ID, source: "manual" }] } as never)
      .mockResolvedValueOnce({ rowCount: 1 } as never);
    const req = {
      ...authedReqBase,
      params: { id: MEMORY_ID },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleDeleteMemory(req, res);
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it("deletes and returns 204 for course_history source", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: MEMORY_ID, source: "course_history" }] } as never)
      .mockResolvedValueOnce({ rowCount: 1 } as never);
    const req = {
      ...authedReqBase,
      params: { id: MEMORY_ID },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleDeleteMemory(req, res);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(mockQuery.mock.calls[1][0]).toContain("'course_history'");
  });

  it("uses database user id for delete queries (strips dev- prefix)", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: MEMORY_ID, source: "chat" }] } as never)
      .mockResolvedValueOnce({ rowCount: 1 } as never);
    const devId = "dev-user-00000000-0000-0000-0000-000000000001";
    const bare = "00000000-0000-0000-0000-000000000001";
    const req = {
      user: { id: devId, email: "dev@example.com" },
      params: { id: MEMORY_ID },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleDeleteMemory(req, res);
    expect(mockQuery.mock.calls[0][1]).toEqual([MEMORY_ID, bare]);
    expect(mockQuery.mock.calls[1][1]).toEqual([MEMORY_ID, bare]);
  });
});

describe("handleClearConversationMemories", () => {
  it("returns deleted count", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 2 } as never);
    const req = { ...authedReqBase } as import("express").Request;
    const res = makeRes();
    await handleClearConversationMemories(req, res);
    expect(mockQuery.mock.calls[0][0]).toContain("DELETE FROM user_memories");
    expect(mockQuery.mock.calls[0][0]).toContain("source IN ('chat', 'manual')");
    expect(res.json).toHaveBeenCalledWith({ deleted: 2 });
  });

  it("returns deleted 0 when no rows matched", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 } as never);
    const req = { ...authedReqBase } as import("express").Request;
    const res = makeRes();
    await handleClearConversationMemories(req, res);
    expect(res.json).toHaveBeenCalledWith({ deleted: 0 });
  });

  it("uses database user id in delete (strips dev- prefix)", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 } as never);
    const devId = "dev-user-00000000-0000-0000-0000-000000000001";
    const bare = "00000000-0000-0000-0000-000000000001";
    const req = { user: { id: devId, email: "dev@example.com" } } as import("express").Request;
    const res = makeRes();
    await handleClearConversationMemories(req, res);
    expect(mockQuery.mock.calls[0][1]).toEqual([bare]);
  });

  it("returns 500 when delete fails", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db") as never);
    const req = { ...authedReqBase } as import("express").Request;
    const res = makeRes();
    await handleClearConversationMemories(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Failed to clear conversation memories" });
  });
});

describe("handleAddManualMemory", () => {
  it("returns 400 for empty body", async () => {
    const req = { ...authedReqBase, body: {} } as unknown as import("express").Request;
    const res = makeRes();
    await handleAddManualMemory(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid memoryType", async () => {
    const req = {
      ...authedReqBase,
      body: { text: "Valid text", memoryType: "course_history" },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleAddManualMemory(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Invalid body: text (1–2000 chars) and optional memoryType.",
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("defaults memoryType to preference when omitted", async () => {
    const createdAt = new Date("2026-04-01T12:00:00.000Z");
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: MEMORY_ID,
          memory_text: "Likes proofs",
          memory_type: "preference",
          source: "manual",
          confidence: "1.00",
          created_at: createdAt,
        },
      ],
    } as never);
    const req = {
      ...authedReqBase,
      body: { text: "Likes proofs" },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleAddManualMemory(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockQuery.mock.calls[0][1]).toEqual([TEST_USER_ID, "Likes proofs", "preference"]);
  });

  it("returns 500 when INSERT throws", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db") as never);
    const req = {
      ...authedReqBase,
      body: { text: "Some memory", memoryType: "goal" },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleAddManualMemory(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Failed to add memory" });
  });

  it("returns 500 when RETURNING yields no row", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    const req = {
      ...authedReqBase,
      body: { text: "orphan", memoryType: "constraint" },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleAddManualMemory(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Failed to add memory" });
  });

  it("inserts manual row and returns 201 MemoryItem", async () => {
    const createdAt = new Date("2026-04-01T12:00:00.000Z");
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: MEMORY_ID,
          memory_text: "Prefers small seminars",
          memory_type: "preference",
          source: "manual",
          confidence: "1.00",
          created_at: createdAt,
        },
      ],
    } as never);
    const req = {
      ...authedReqBase,
      body: { text: "  Prefers small seminars  ", memoryType: "preference" },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleAddManualMemory(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        id: MEMORY_ID,
        text: "Prefers small seminars",
        type: "preference",
        source: "manual",
        confidence: 1,
      }),
    );
    const insertSql = String(mockQuery.mock.calls[0][0]);
    expect(insertSql).toContain("INSERT INTO user_memories");
    expect(insertSql).toContain("'manual'");
    expect(mockQuery.mock.calls[0][1]).toEqual([
      TEST_USER_ID,
      "Prefers small seminars",
      "preference",
    ]);
  });
});

describe("handleAddCourseHistoryMemory", () => {
  it("returns 400 when body invalid", async () => {
    const req = { ...authedReqBase, body: {} } as unknown as import("express").Request;
    const res = makeRes();
    await handleAddCourseHistoryMemory(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 400 when courseCode is not AS or EN dotted catalog form", async () => {
    const req = {
      ...authedReqBase,
      body: { courseCode: "MA.100.100" },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleAddCourseHistoryMemory(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining("AS.030.101"),
      }),
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 400 for undotted or wrong-prefix codes", async () => {
    const res = makeRes();
    await handleAddCourseHistoryMemory(
      { ...authedReqBase, body: { courseCode: "AS030101" } } as unknown as import("express").Request,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 201 when insert succeeds (inserted true)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: MEMORY_ID, inserted: true }],
    } as never);
    const req = {
      ...authedReqBase,
      body: { courseCode: "AS.030.101" },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleAddCourseHistoryMemory(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: MEMORY_ID, courseCode: "AS.030.101" });
    expect(String(mockQuery.mock.calls[0][0])).toContain("ON CONFLICT");
  });

  it("returns 200 when row already existed (inserted false)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: MEMORY_ID, inserted: false }],
    } as never);
    const req = {
      ...authedReqBase,
      body: { courseCode: "en.601.226" },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleAddCourseHistoryMemory(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ id: MEMORY_ID, courseCode: "EN.601.226" });
  });

  it("returns 500 when id missing", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: null, inserted: false }] } as never);
    const req = {
      ...authedReqBase,
      body: { courseCode: "AS.030.101" },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleAddCourseHistoryMemory(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("returns 500 when upsert query throws", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db") as never);
    const req = {
      ...authedReqBase,
      body: { courseCode: "AS.030.101" },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleAddCourseHistoryMemory(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Failed to add course history memory" });
  });

  it("uses database user id in upsert params (strips dev- prefix)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: MEMORY_ID, inserted: true }],
    } as never);
    const devId = "dev-user-00000000-0000-0000-0000-000000000001";
    const bare = "00000000-0000-0000-0000-000000000001";
    const req = {
      user: { id: devId, email: "dev@example.com" },
      body: { courseCode: "EN.500.112" },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleAddCourseHistoryMemory(req, res);
    expect(mockQuery.mock.calls[0][1]).toEqual([bare, "EN.500.112"]);
  });
});

describe("handleProcessTranscript", () => {
  it("returns 400 for invalid body", async () => {
    const req = { ...authedReqBase, body: {} } as unknown as import("express").Request;
    const res = makeRes();
    await handleProcessTranscript(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("classifies matched, ambiguous, and unmatched entries", async () => {
    mockSearchCoursesBySisConstraints
      .mockResolvedValueOnce({
        courses: [{ offeringName: "AS.030.101.01", title: "Intro Chem" }],
      })
      .mockResolvedValueOnce({
        courses: [
          { offeringName: "EN.500.112.01", title: "Gateway Python" },
          { offeringName: "EN.500.113.01", title: "Gateway Data" },
        ],
      })
      .mockResolvedValueOnce({ courses: [] });
    const req = {
      ...authedReqBase,
      body: {
        extractedCourseCodes: ["AS.030.101", "EN.500.112", "AS.001.001"],
      },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleProcessTranscript(req, res);
    expect(res.json).toHaveBeenCalledWith({
      reviewedEntries: [
        {
          rawCode: "AS.030.101",
          canonicalCode: "AS.030.101",
          status: "matched",
          options: ["AS.030.101"],
          optionDetails: [{ courseCode: "AS.030.101", title: "Intro Chem" }],
          resolvedCourseTitle: "Intro Chem",
        },
        {
          rawCode: "EN.500.112",
          canonicalCode: "EN.500.112",
          status: "ambiguous",
          options: ["EN.500.112", "EN.500.113"],
          optionDetails: [
            { courseCode: "EN.500.112", title: "Gateway Python" },
            { courseCode: "EN.500.113", title: "Gateway Data" },
          ],
          resolvedCourseTitle: null,
        },
        {
          rawCode: "AS.001.001",
          canonicalCode: "AS.001.001",
          status: "unmatched",
          options: [],
          optionDetails: [],
          resolvedCourseTitle: null,
        },
      ],
    });
  });
});

describe("handleSaveTranscript", () => {
  it("returns 409 when ambiguous entries are unresolved", async () => {
    const req = {
      ...authedReqBase,
      body: {
        reviewedEntries: [
          {
            rawCode: "EN.500.112",
            canonicalCode: "EN.500.112",
            status: "ambiguous",
            options: ["EN.500.112", "EN.500.113"],
          },
        ],
      },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleSaveTranscript(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("returns 400 when selected ambiguous option is not in options", async () => {
    const req = {
      ...authedReqBase,
      body: {
        reviewedEntries: [
          {
            rawCode: "EN.500.112",
            canonicalCode: "EN.500.112",
            status: "ambiguous",
            options: ["EN.500.112", "EN.500.113"],
            selectedCourseCode: "EN.500.999",
          },
        ],
      },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleSaveTranscript(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("saves matched/resolved entries and skips unmatched", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "m1" }] })
      .mockResolvedValueOnce({ rows: [{ id: "m2" }] });
    const req = {
      ...authedReqBase,
      body: {
        reviewedEntries: [
          {
            rawCode: "AS.030.101",
            canonicalCode: "AS.030.101",
            status: "matched",
            options: ["AS.030.101"],
          },
          {
            rawCode: "EN.500.112",
            canonicalCode: "EN.500.112",
            status: "ambiguous",
            options: ["EN.500.112", "EN.500.113"],
            selectedCourseCode: "EN.500.113",
          },
          {
            rawCode: "AS.001.001",
            canonicalCode: "AS.001.001",
            status: "unmatched",
            options: [],
          },
        ],
      },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleSaveTranscript(req, res);
    expect(res.json).toHaveBeenCalledWith({
      savedCount: 2,
      savedCourseCodes: ["AS.030.101", "EN.500.113"],
    });
  });
});

describe("handleDeleteUser", () => {
  const mockClientQuery = vi.fn();
  const mockRelease = vi.fn();

  beforeEach(() => {
    mockClientQuery.mockReset();
    mockRelease.mockReset();
    mockConnect.mockResolvedValue({
      query: mockClientQuery,
      release: mockRelease,
    });
  });

  it("returns 400 when confirm is not true", async () => {
    const req = {
      ...authedReqBase,
      body: { confirm: false },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleDeleteUser(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("deletes sessions and user, destroys session, returns 204", async () => {
    mockClientQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: TEST_USER_ID }] })
      .mockResolvedValueOnce({});
    const destroy = vi.fn((cb: (e?: Error) => void) => {
      cb();
    });
    const req = {
      ...authedReqBase,
      body: { confirm: true },
      session: { destroy },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleDeleteUser(req, res);
    expect(mockConnect).toHaveBeenCalled();
    expect(mockClientQuery.mock.calls[0][0]).toBe("BEGIN");
    expect(String(mockClientQuery.mock.calls[1][0])).toContain("DELETE FROM session");
    expect(String(mockClientQuery.mock.calls[2][0])).toContain("DELETE FROM users");
    expect(mockClientQuery.mock.calls[2][1]).toEqual([TEST_USER_ID]);
    expect(mockRelease).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalledWith();
  });

  it("returns 404 when user row is missing", async () => {
    mockClientQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({});
    const req = {
      ...authedReqBase,
      body: { confirm: true },
      session: { destroy: vi.fn() },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleDeleteUser(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
