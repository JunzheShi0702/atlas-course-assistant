import { afterEach, describe, expect, it, vi } from "vitest";

const mockSessionFactory = vi.fn((options) => ({ kind: "session-middleware", options }));
const mockPgStoreCtor = vi.fn(function MockPgStore(this: { options?: unknown }, options: unknown) {
  this.options = options;
});

vi.mock("express-session", () => ({
  default: mockSessionFactory,
}));

vi.mock("connect-pg-simple", () => ({
  default: vi.fn(() => mockPgStoreCtor),
}));

vi.mock("../db", () => ({
  pool: { __pool: true },
}));

async function importSessionModule() {
  vi.resetModules();
  return import("./session");
}

describe("session middleware", () => {
  afterEach(() => {
    delete process.env.BACKEND_URL;
    delete process.env.SESSION_SECRET;
    mockSessionFactory.mockClear();
    mockPgStoreCtor.mockClear();
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
      pool: { __pool: true },
      tableName: "session",
      createTableIfMissing: true,
    });
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
});
