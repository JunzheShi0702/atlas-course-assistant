import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db");

import { pool } from "../db";
import { handleUpsertUser, handleGetProfile, handleUpsertProfile } from "./users";

const mockQuery = vi.mocked(pool.query);

function makeRes() {
  const res = { json: vi.fn(), status: vi.fn() } as unknown as import("express").Response;
  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
}

const fakeUser = {
  id: "uuid-1",
  email: "alice@jhu.edu",
  google_sub: "google-sub-123",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const fakeProfile = {
  user_id: "uuid-1",
  graduation_month: 5,
  graduation_year: 2026,
  degrees: ["B.S. Computer Science"],
  school: "Whiting School of Engineering",
  raw_text: "I'm a junior studying CS.",
  derived_memories: [],
  updated_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
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

  it("uses an upsert query with ON CONFLICT", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeUser] } as never);
    const req = { body: { email: "alice@jhu.edu", google_sub: "google-sub-123" } } as import("express").Request;
    await handleUpsertUser(req, makeRes());
    expect(mockQuery.mock.calls[0][0]).toMatch(/ON CONFLICT/i);
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
  it("returns the profile when found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeProfile] } as never);
    const req = { params: { id: "uuid-1" } } as unknown as import("express").Request;
    const res = makeRes();
    await handleGetProfile(req, res);
    expect(res.json).toHaveBeenCalledWith(fakeProfile);
  });

  it("returns 404 when no profile exists", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    const req = { params: { id: "uuid-none" } } as unknown as import("express").Request;
    const res = makeRes();
    await handleGetProfile(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("queries by user_id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeProfile] } as never);
    const req = { params: { id: "uuid-1" } } as unknown as import("express").Request;
    await handleGetProfile(req, makeRes());
    expect(mockQuery.mock.calls[0][1]).toEqual(["uuid-1"]);
  });

  it("returns 500 when the query throws", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db error") as never);
    const req = { params: { id: "uuid-1" } } as unknown as import("express").Request;
    const res = makeRes();
    await handleGetProfile(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ---------------------------------------------------------------------------
// handleUpsertProfile
// ---------------------------------------------------------------------------

describe("handleUpsertProfile", () => {
  it("returns the upserted profile", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeProfile] } as never);
    const req = {
      params: { id: "uuid-1" },
      body: { graduation_month: 5, graduation_year: 2026 },
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleUpsertProfile(req, res);
    expect(res.json).toHaveBeenCalledWith(fakeProfile);
  });

  it("passes null for omitted fields so COALESCE keeps existing values", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeProfile] } as never);
    const req = {
      params: { id: "uuid-1" },
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
      params: { id: "uuid-1" },
      body: { derived_memories: memories },
    } as unknown as import("express").Request;
    await handleUpsertProfile(req, makeRes());
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[6]).toBe(JSON.stringify(memories));
  });

  it("returns 500 when the query throws", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db error") as never);
    const req = {
      params: { id: "uuid-1" },
      body: {},
    } as unknown as import("express").Request;
    const res = makeRes();
    await handleUpsertProfile(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
