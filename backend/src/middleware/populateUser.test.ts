import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock("../db", () => ({
  pool: { query: mockQuery },
}));

import { populateUser } from "./populateUser";

describe("populateUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips db lookup when there is no session userId", async () => {
    const req = { session: {} } as unknown as import("express").Request;
    const next = vi.fn();

    await populateUser(req, {} as import("express").Response, next);

    expect(mockQuery).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it("attaches req.user when user row exists", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "00000000-0000-0000-0000-000000000001", email: "alice@jhu.edu" }],
    });
    const req = {
      session: { userId: "00000000-0000-0000-0000-000000000001" },
    } as unknown as import("express").Request;
    const next = vi.fn();

    await populateUser(req, {} as import("express").Response, next);

    expect(mockQuery).toHaveBeenCalledOnce();
    expect(req.user).toEqual({
      id: "00000000-0000-0000-0000-000000000001",
      email: "alice@jhu.edu",
    });
    expect(next).toHaveBeenCalledOnce();
  });

  it("does not throw when db query fails", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const req = {
      session: { userId: "00000000-0000-0000-0000-000000000001" },
    } as unknown as import("express").Request;
    const next = vi.fn();

    await populateUser(req, {} as import("express").Response, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });
});
