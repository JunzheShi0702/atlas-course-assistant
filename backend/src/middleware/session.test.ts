import { afterEach, describe, expect, it, vi } from "vitest";

const mockSessionFactory = vi.fn((options) => ({ kind: "session-middleware", options }));
const mockPgStoreCtor = vi.fn(function MockPgStore(this: { options?: unknown }, options: unknown) {
  this.options = options;
});
const mockPoolQuery = vi.fn();

vi.mock("express-session", () => ({
  default: mockSessionFactory,
}));

vi.mock("connect-pg-simple", () => ({
  default: vi.fn(() => mockPgStoreCtor),
}));

vi.mock("../db", () => ({
  pool: { __pool: true, query: mockPoolQuery },
}));

async function importSessionModule() {
  vi.resetModules();
  return import("./session");
}

describe("session middleware", () => {
  afterEach(() => {
    delete process.env.BACKEND_URL;
    delete process.env.VERCEL_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.SESSION_SECRET;
    mockSessionFactory.mockClear();
    mockPgStoreCtor.mockClear();
    mockPoolQuery.mockReset();
  });

  it("uses relaxed local cookie settings when BACKEND_URL is absent or non-https", async () => {
    process.env.BACKEND_URL = "http://localhost:3001";
    process.env.SESSION_SECRET = "local-secret";

    await importSessionModule();

    const options = mockSessionFactory.mock.calls[0]?.[0];
    expect(options.secret).toBe("local-secret");
    expect(options.rolling).toBe(true);
    expect(options.resave).toBe(false);
    expect(options.saveUninitialized).toBe(false);
    expect(options.cookie).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 2 * 60 * 60 * 1000,
    });
    expect(mockPgStoreCtor).toHaveBeenCalledWith({
      pool: { __pool: true, query: mockPoolQuery },
      tableName: "session",
      createTableIfMissing: false,
    });
  });

  it("creates the session table using inline application SQL", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    const { ensureSessionTable } = await importSessionModule();
    await ensureSessionTable();

    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    expect(String(mockPoolQuery.mock.calls[0]?.[0])).toContain('CREATE TABLE IF NOT EXISTS "session"');
    expect(String(mockPoolQuery.mock.calls[0]?.[0])).toContain('CREATE INDEX IF NOT EXISTS "IDX_session_expire"');
  });

  it("uses secure cross-site cookies when BACKEND_URL is https", async () => {
    process.env.BACKEND_URL = "https://atlas-backend.example.com";

    await importSessionModule();

    const options = mockSessionFactory.mock.calls[0]?.[0];
    expect(options.secret).toBe("dev-secret-change-me");
    expect(options.cookie).toMatchObject({
      secure: true,
      sameSite: "none",
    });
  });

  it("uses secure cookies on Vercel when BACKEND_URL is absent", async () => {
    process.env.VERCEL_URL = "atlas-preview.vercel.app";

    await importSessionModule();

    const options = mockSessionFactory.mock.calls[0]?.[0];
    expect(options.cookie).toMatchObject({
      secure: true,
      sameSite: "none",
    });
  });
});
