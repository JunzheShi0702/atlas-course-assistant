import { afterEach, describe, expect, it, vi } from "vitest";

const mockPool = vi.fn();

vi.mock("pg", () => ({
  Pool: mockPool,
}));

async function importPoolModule() {
  vi.resetModules();
  return import("./pool");
}

describe("databaseSslConfig", () => {
  afterEach(() => {
    delete process.env.DATABASE_SSL;
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_CONNECTION_TIMEOUT_MS;
    delete process.env.VERCEL;
    mockPool.mockClear();
  });

  it("keeps local Postgres connections non-SSL", async () => {
    const { databaseSslConfig } = await importPoolModule();

    expect(databaseSslConfig("postgres://user:pass@localhost:5432/atlas")).toBe(false);
    expect(databaseSslConfig("postgres://user:pass@127.0.0.1:5432/atlas")).toBe(false);
  });

  it("honors sslmode=require from the database URL", async () => {
    const { databaseSslConfig } = await importPoolModule();

    expect(
      databaseSslConfig("postgres://user:pass@db.example.com:5432/atlas?sslmode=require"),
    ).toEqual({ rejectUnauthorized: false });
  });

  it("enables SSL for common hosted Postgres providers", async () => {
    const { databaseSslConfig } = await importPoolModule();

    expect(databaseSslConfig("postgres://user:pass@aws-0-us-east-1.pooler.supabase.com/db")).toEqual({
      rejectUnauthorized: false,
    });
    expect(databaseSslConfig("postgres://user:pass@ep-green-tree.us-east-1.aws.neon.tech/db")).toEqual({
      rejectUnauthorized: false,
    });
  });

  it("lets DATABASE_SSL override URL detection", async () => {
    const { databaseSslConfig } = await importPoolModule();

    expect(databaseSslConfig("postgres://user:pass@localhost:5432/atlas", "true")).toEqual({
      rejectUnauthorized: false,
    });
    expect(
      databaseSslConfig("postgres://user:pass@db.example.com:5432/atlas?sslmode=require", "false"),
    ).toBe(false);
  });

  it("configures the shared pool with SSL and a finite connection timeout", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@db.example.com:5432/atlas?sslmode=require";

    await importPoolModule();

    expect(mockPool).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 5_000,
      }),
    );
  });
});
