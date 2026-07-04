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

type FakeTokenResponse = Awaited<ReturnType<OAuth2Client["getToken"]>>;
type FakeLoginTicket = Awaited<ReturnType<OAuth2Client["verifyIdToken"]>>;
import { upsertUserByGoogleSub } from "./users";
import authRouter from "./auth";
import express from "express";
import request from "supertest";

const mockUpsert = vi.mocked(upsertUserByGoogleSub);
const MockOAuth2Client = vi.mocked(OAuth2Client);

const TEST_USER = { id: "00000000-0000-0000-0000-000000000001", email: "alice@jhu.edu" };
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";

function makeApp(sessionUserId?: string, oauthState?: string, saveError?: unknown) {
  const app = express();
  app.use(express.json());
  // Minimal session stub
  app.use((req, _res, next) => {
    const session = {
      userId: sessionUserId,
      oauthState,
      save: (cb: (err?: unknown) => void) => cb(saveError),
      destroy: (cb: () => void) => cb(),
    };
    (req as express.Request & { session: typeof session }).session = session;
    if (sessionUserId) {
      (req as express.Request & { user?: typeof TEST_USER }).user = TEST_USER;
    }
    next();
  });
  app.use("/auth", authRouter);
  app.get("/api/auth/me", (req: express.Request, res) => {
    if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
    res.json(req.user);
  });
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
    vi.mocked(MockOAuth2Client.prototype.generateAuthUrl).mockReturnValue(fakeUrl);

    const res = await request(makeApp()).get("/auth/google");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(fakeUrl);
  });

  it("returns 503 instead of a raw internal server error when session save fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const fakeUrl = "https://accounts.google.com/o/oauth2/auth?fake=1";
      vi.mocked(MockOAuth2Client.prototype.generateAuthUrl).mockReturnValue(fakeUrl);

      const res = await request(makeApp(undefined, undefined, new Error("session unavailable"))).get("/auth/google");

      expect(res.status).toBe(503);
      expect(res.text).toContain("session storage is unavailable");
      expect(res.headers.location).toBeUndefined();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// GET /auth/google/callback
// ---------------------------------------------------------------------------

describe("GET /auth/google/callback", () => {
  const VALID_STATE = "valid-state-token";

  function mockOAuthSuccess() {
    vi.mocked(MockOAuth2Client.prototype.getToken).mockResolvedValue({
      tokens: { id_token: "fake-id-token" },
    } as unknown as FakeTokenResponse);
    vi.mocked(MockOAuth2Client.prototype.verifyIdToken).mockResolvedValue({
      getPayload: () => ({ sub: "google-sub-123", email: "alice@jhu.edu" }),
    } as unknown as FakeLoginTicket);
    mockUpsert.mockResolvedValue(TEST_USER);
  }

  it("creates a new user, sets session, and redirects to frontend", async () => {
    mockOAuthSuccess();

    const res = await request(makeApp(undefined, VALID_STATE)).get(
      `/auth/google/callback?code=abc123&state=${VALID_STATE}`,
    );
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(FRONTEND_URL);
    expect(mockUpsert).toHaveBeenCalledWith("alice@jhu.edu", "google-sub-123");
  });

  it("returns the same user row on second login (existing user lookup)", async () => {
    mockOAuthSuccess();

    await request(makeApp(undefined, VALID_STATE)).get(`/auth/google/callback?code=first&state=${VALID_STATE}`);
    await request(makeApp(undefined, VALID_STATE)).get(`/auth/google/callback?code=second&state=${VALID_STATE}`);

    expect(mockUpsert).toHaveBeenCalledTimes(2);
    await expect(mockUpsert.mock.results[0].value).resolves.toMatchObject({ id: TEST_USER.id });
  });

  it("redirects to the frontend root when no code is provided (cancelled login)", async () => {
    const res = await request(makeApp(undefined, VALID_STATE)).get(`/auth/google/callback?state=${VALID_STATE}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(FRONTEND_URL);
  });

  it("redirects to the frontend root when state is missing", async () => {
    const res = await request(makeApp(undefined, VALID_STATE)).get("/auth/google/callback?code=abc123");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(FRONTEND_URL);
  });

  it("redirects to the frontend root when state does not match session", async () => {
    const res = await request(makeApp(undefined, VALID_STATE)).get(
      "/auth/google/callback?code=abc123&state=wrong-state",
    );
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(FRONTEND_URL);
  });

  it("redirects to the frontend root when token exchange fails", async () => {
    vi.mocked(MockOAuth2Client.prototype.getToken).mockRejectedValue(new Error("invalid_grant"));

    const res = await request(makeApp(undefined, VALID_STATE)).get(
      `/auth/google/callback?code=bad-code&state=${VALID_STATE}`,
    );
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(FRONTEND_URL);
  });

  it("redirects to the frontend root when profile is missing email", async () => {
    vi.mocked(MockOAuth2Client.prototype.getToken).mockResolvedValue({
      tokens: { id_token: "fake-id-token" },
    } as unknown as FakeTokenResponse);
    vi.mocked(MockOAuth2Client.prototype.verifyIdToken).mockResolvedValue({
      getPayload: () => ({ sub: "google-sub-123", email: undefined }),
    } as unknown as FakeLoginTicket);

    const res = await request(makeApp(undefined, VALID_STATE)).get(
      `/auth/google/callback?code=abc&state=${VALID_STATE}`,
    );
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(FRONTEND_URL);
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
