import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db");

vi.mock("../services/parse-onboarding-responses", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../services/parse-onboarding-responses")>();
  return {
    ...mod,
    parseOnboardingResponses: vi.fn(),
  };
});

import { pool } from "../db";
import { parseOnboardingResponses } from "../services/parse-onboarding-responses";
import {
  handleUpsertUser,
  handleGetProfile,
  handleUpsertProfile,
  requireAuth,
  dbRowToClientProfile,
} from "./users";

const mockQuery = vi.mocked(pool.query);
const mockParseOnboarding = vi.mocked(parseOnboardingResponses);

const defaultParsedMemories = {
  goals: ["parsed_goal"],
  workloadTolerance: "medium" as const,
  timePreferences: [] as string[],
  notes: [] as string[],
};

function makeRes() {
  const res = { json: vi.fn(), status: vi.fn() } as unknown as import("express").Response;
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
  mockParseOnboarding.mockResolvedValue(defaultParsedMemories);
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
    expect(mockQuery).toHaveBeenCalledTimes(2);
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
