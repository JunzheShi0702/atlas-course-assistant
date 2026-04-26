import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { devAuthMiddleware, requireAuth, toDatabaseUserId } from "./auth";

function makeResponse() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return {
    status,
    json,
  } as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

describe("auth middleware", () => {
  it("returns 401 when requireAuth sees no user", () => {
    const req = {} as Request;
    const res = makeResponse();
    const next = vi.fn() as NextFunction;

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next when requireAuth sees an authenticated user", () => {
    const req = { user: { id: "user-1", email: "test@jhu.edu", name: "Test User" } } as Request;
    const res = makeResponse();
    const next = vi.fn() as NextFunction;

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("strips the dev-user prefix before DB writes", () => {
    expect(toDatabaseUserId("dev-user-00000000-0000-0000-0000-000000000001")).toBe(
      "00000000-0000-0000-0000-000000000001",
    );
    expect(toDatabaseUserId("00000000-0000-0000-0000-000000000001")).toBe(
      "00000000-0000-0000-0000-000000000001",
    );
  });

  it("hydrates a fixed dev user only when req.user is absent", () => {
    const req = {} as Request;
    const next = vi.fn() as NextFunction;

    devAuthMiddleware(req, {} as Response, next);

    expect(req.user).toEqual({
      id: "dev-user-00000000-0000-0000-0000-000000000001",
      email: "dev@atlas-jhu.dev",
      name: "Dev User",
    });
    expect(next).toHaveBeenCalledOnce();
  });

  it("does not overwrite an existing authenticated user in dev mode", () => {
    const req = {
      user: { id: "real-user", email: "real@jhu.edu", name: "Real User" },
    } as Request;
    const next = vi.fn() as NextFunction;

    devAuthMiddleware(req, {} as Response, next);

    expect(req.user).toEqual({
      id: "real-user",
      email: "real@jhu.edu",
      name: "Real User",
    });
    expect(next).toHaveBeenCalledOnce();
  });
});
