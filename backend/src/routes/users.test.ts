import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db");

import { pool } from "../db";
import { handleUpsertUser, handleGetProfile, handleUpsertProfile, requireAuth } from "./users";

const mockQuery = vi.mocked(pool.query);

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

const fakeProfile = {
  user_id: TEST_USER_ID,
  graduation_month: 5,
  graduation_year: 2026,
  degrees: ["B.S. Computer Science"],
  school: "Whiting School of Engineering",
  raw_text: "I'm a junior studying CS.",
  derived_memories: [],
  updated_at: "2026-01-01T00:00:00Z",
};

const authedReqBase = { user: { id: TEST_USER_ID, email: "alice@jhu.edu" } };

beforeEach(() => {
  vi.clearAllMocks();
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
  it("returns the profile when found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeProfile] } as never);
    const req = { ...authedReqBase } as unknown as import("express").Request;
    const res = makeRes();
    await handleGetProfile(req, res);
    expect(res.json).toHaveBeenCalledWith(fakeProfile);
  });

  it("returns 404 when no profile exists", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    const req = { ...authedReqBase } as unknown as import("express").Request;
    const res = makeRes();
    await handleGetProfile(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("queries by the authenticated user id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeProfile] } as never);
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

  it("returns the upserted profile", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeProfile] } as never);
    const req = {
      ...authedReqBase,
      body: { graduation_month: 5, graduation_year: 2026 },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleUpsertProfile(req, res);
    expect(res.json).toHaveBeenCalledWith(fakeProfile);
  });

  it("uses the authenticated user id for the query", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeProfile] } as never);
    const req = {
      ...authedReqBase,
      body: { school: "Whiting School of Engineering" },
    } as unknown as import("express").Request;
    await handleUpsertProfile(req, makeRes());
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe(TEST_USER_ID);
  });

  it("passes null for omitted fields so COALESCE keeps existing values", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeProfile] } as never);
    const req = {
      ...authedReqBase,
      body: { school: "Whiting School of Engineering" },
    } as unknown as import("express").Request;
    await handleUpsertProfile(req, makeRes());
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[1]).toBeNull(); // graduation_month
    expect(params[2]).toBeNull(); // graduation_year
    expect(params[3]).toBeNull(); // degrees
    expect(params[5]).toBeNull(); // raw_text
    expect(params[6]).toBeNull(); // derived_memories
    expect(params[4]).toBe("Whiting School of Engineering");
  });

  it("serializes derived_memories as a JSON string", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeProfile] } as never);
    const memories = [{ fact: "likes morning classes" }];
    const req = {
      ...authedReqBase,
      body: { derived_memories: memories },
    } as unknown as import("express").Request;
    await handleUpsertProfile(req, makeRes());
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[6]).toBe(JSON.stringify(memories));
  });

  it("returns 400 when body fails schema validation", async () => {
    const req = {
      ...authedReqBase,
      body: { graduation_month: 13 }, // out of range
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
    const minimalProfile = { ...fakeProfile, derived_memories: [] };
    mockQuery.mockResolvedValueOnce({ rows: [minimalProfile] } as never);
    const req = {
      ...authedReqBase,
      body: { school: "Krieger School of Arts and Sciences" },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleUpsertProfile(req, res);
    expect(res.json).toHaveBeenCalledWith(minimalProfile);
    // derived_memories omitted → null passed to query; DB-side COALESCE supplies '[]'
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[6]).toBeNull();
  });
});
