import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db");
vi.mock("google-auth-library");
vi.mock("./users", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./users")>();
  return {
    ...actual,
    upsertUserByGoogleSub: vi.fn(),
  };
});

import { OAuth2Client } from "google-auth-library";
import { upsertUserByGoogleSub } from "./users";
import authRouter from "./auth";
import express from "express";
import request from "supertest";

const mockUpsert = vi.mocked(upsertUserByGoogleSub);
const MockOAuth2Client = vi.mocked(OAuth2Client);

const TEST_USER = { id: "00000000-0000-0000-0000-000000000001", email: "alice@jhu.edu" };

function makeApp(sessionUserId?: string) {
  const app = express();
  app.use(express.json());
  // Minimal session stub
  app.use((req, _res, next) => {
    (req as express.Request & {
      session: { userId?: string; destroy: (cb: () => void) => void };
    }).session = {
      userId: sessionUserId,
      destroy: (cb) => cb(),
    };
    if (sessionUserId) {
      (req as express.Request & { user?: typeof TEST_USER }).user = TEST_USER;
    }
    next();
  });
  app.use("/auth", authRouter);
  app.use("/api/auth", authRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /auth/google
// ---------------------------------------------------------------------------

describe("GET /auth/google", () => {
  it("redirects to the Google OAuth consent URL", async () => {
    const fakeUrl = "https://accounts.google.com/o/oauth2/auth?fake=1";
    MockOAuth2Client.prototype.generateAuthUrl = vi.fn().mockReturnValue(fakeUrl);

    const res = await request(makeApp()).get("/auth/google");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(fakeUrl);
  });
});

// ---------------------------------------------------------------------------
// GET /auth/google/callback
// ---------------------------------------------------------------------------

describe("GET /auth/google/callback", () => {
  it("creates a new user, sets session, and redirects to frontend", async () => {
    MockOAuth2Client.prototype.getToken = vi.fn().mockResolvedValue({
      tokens: { id_token: "fake-id-token" },
    });
    MockOAuth2Client.prototype.verifyIdToken = vi.fn().mockResolvedValue({
      getPayload: () => ({ sub: "google-sub-123", email: "alice@jhu.edu" }),
    });
    mockUpsert.mockResolvedValue(TEST_USER);

    const res = await request(makeApp()).get("/auth/google/callback?code=abc123");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/localhost:5173/);
    expect(mockUpsert).toHaveBeenCalledWith("alice@jhu.edu", "google-sub-123");
  });

  it("returns the same user row on second login (existing user lookup)", async () => {
    MockOAuth2Client.prototype.getToken = vi.fn().mockResolvedValue({
      tokens: { id_token: "fake-id-token" },
    });
    MockOAuth2Client.prototype.verifyIdToken = vi.fn().mockResolvedValue({
      getPayload: () => ({ sub: "google-sub-123", email: "alice@jhu.edu" }),
    });
    // upsert returns the same existing row both times
    mockUpsert.mockResolvedValue(TEST_USER);

    await request(makeApp()).get("/auth/google/callback?code=first");
    await request(makeApp()).get("/auth/google/callback?code=second");

    expect(mockUpsert).toHaveBeenCalledTimes(2);
    expect(mockUpsert.mock.results[0].value).resolves.toMatchObject({ id: TEST_USER.id });
  });

  it("redirects to /login when no code is provided (cancelled login)", async () => {
    const res = await request(makeApp()).get("/auth/google/callback");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/login/);
  });

  it("redirects to /login when token exchange fails", async () => {
    MockOAuth2Client.prototype.getToken = vi.fn().mockRejectedValue(new Error("invalid_grant"));

    const res = await request(makeApp()).get("/auth/google/callback?code=bad-code");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/login/);
  });

  it("redirects to /login when profile is missing email", async () => {
    MockOAuth2Client.prototype.getToken = vi.fn().mockResolvedValue({
      tokens: { id_token: "fake-id-token" },
    });
    MockOAuth2Client.prototype.verifyIdToken = vi.fn().mockResolvedValue({
      getPayload: () => ({ sub: "google-sub-123", email: undefined }),
    });

    const res = await request(makeApp()).get("/auth/google/callback?code=abc");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/login/);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/logout
// ---------------------------------------------------------------------------

describe("POST /auth/logout", () => {
  it("destroys the session and responds with { ok: true }", async () => {
    const res = await request(makeApp("some-user-id")).post("/auth/logout");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------

describe("GET /api/auth/me", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(makeApp()).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });

  it("returns the user object when authenticated", async () => {
    const res = await request(makeApp(TEST_USER.id)).get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: TEST_USER.id, email: TEST_USER.email });
  });
});
