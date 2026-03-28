import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGenerateText } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: mockGenerateText };
});

import { isQueryInProductScope } from "./query-scope";

describe("isQueryInProductScope", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it("returns false for whitespace-only input without calling the model", async () => {
    const result = await isQueryInProductScope("   ");
    expect(result).toBe(false);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("returns true when the classifier marks the message in scope", async () => {
    mockGenerateText.mockResolvedValue({ output: { inScope: true } });
    await expect(isQueryInProductScope("tensor decomposition topics")).resolves.toBe(true);
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });

  it("short-circuits without the classifier when the message looks course-related", async () => {
    await expect(isQueryInProductScope("machine learning courses")).resolves.toBe(true);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("returns false when the classifier marks the message out of scope", async () => {
    mockGenerateText.mockResolvedValue({ output: { inScope: false } });
    await expect(isQueryInProductScope("what is the capital of France")).resolves.toBe(false);
  });

  it("returns true when classification throws (fail open)", async () => {
    mockGenerateText.mockRejectedValue(new Error("API error"));
    await expect(isQueryInProductScope("intro to algorithms")).resolves.toBe(true);
  });

  it("returns true when output is missing (fail open)", async () => {
    mockGenerateText.mockResolvedValue({ output: undefined });
    await expect(isQueryInProductScope("anything")).resolves.toBe(true);
  });
});
