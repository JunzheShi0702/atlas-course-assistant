import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGenerateObject } = vi.hoisted(() => ({
  mockGenerateObject: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateObject: mockGenerateObject };
});

import { isQueryInProductScope } from "./query-scope";

describe("isQueryInProductScope", () => {
  beforeEach(() => {
    mockGenerateObject.mockReset();
  });

  it("returns false for whitespace-only input without calling the model", async () => {
    const result = await isQueryInProductScope("   ");
    expect(result).toBe(false);
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("returns true when the classifier marks the message in scope", async () => {
    mockGenerateObject.mockResolvedValue({ object: { inScope: true } });
    await expect(isQueryInProductScope("machine learning courses")).resolves.toBe(true);
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
  });

  it("returns false when the classifier marks the message out of scope", async () => {
    mockGenerateObject.mockResolvedValue({ object: { inScope: false } });
    await expect(isQueryInProductScope("what is the capital of France")).resolves.toBe(false);
  });

  it("returns true when classification throws (fail open)", async () => {
    mockGenerateObject.mockRejectedValue(new Error("API error"));
    await expect(isQueryInProductScope("intro to algorithms")).resolves.toBe(true);
  });
});
