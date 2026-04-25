import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mockFetch);

import {
  searchRedditForCourse,
  mapTavilyResult,
  type TavilyResult,
} from "./search-reddit-for-course";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTavilyResult(overrides: Partial<TavilyResult> = {}): TavilyResult {
  return {
    title: "Is EN.601.226 worth it?",
    url: "https://reddit.com/r/jhu/comments/abc123",
    content: "Great course, highly recommend.",
    ...overrides,
  };
}

function mockOkResponse(results: TavilyResult[]) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ results }),
  });
}

// ── mapTavilyResult ───────────────────────────────────────────────────────────

describe("mapTavilyResult", () => {
  it("maps title, url, and content as snippet", () => {
    const raw = makeTavilyResult();
    const thread = mapTavilyResult(raw);
    expect(thread.title).toBe(raw.title);
    expect(thread.url).toBe(raw.url);
    expect(thread.snippet).toBe(raw.content);
  });

  it("truncates content longer than 300 chars with ...", () => {
    const long = "x".repeat(350);
    const thread = mapTavilyResult(makeTavilyResult({ content: long }));
    expect(thread.snippet).toHaveLength(303); // 300 + "..."
    expect(thread.snippet.endsWith("...")).toBe(true);
  });

  it("maps missing content to empty snippet", () => {
    const raw = makeTavilyResult({ content: undefined });
    const thread = mapTavilyResult(raw);
    expect(thread.snippet).toBe("");
  });

  it("extracts subreddit from URL", () => {
    const thread = mapTavilyResult(makeTavilyResult({ url: "https://www.reddit.com/r/jhu/comments/abc123" }));
    expect(thread.subreddit).toBe("r/jhu");
  });

  it("leaves subreddit undefined for non-subreddit URLs", () => {
    const thread = mapTavilyResult(makeTavilyResult({ url: "https://reddit.com/user/someone" }));
    expect(thread.subreddit).toBeUndefined();
  });

  it("maps published_date to publishedDate", () => {
    const thread = mapTavilyResult(makeTavilyResult({ published_date: "2024-02-15" }));
    expect(thread.publishedDate).toBe("2024-02-15");
  });
});

// ── searchRedditForCourse ─────────────────────────────────────────────────────

describe("searchRedditForCourse", () => {
  const originalApiKey = process.env.TAVILY_API_KEY;

  beforeEach(() => {
    mockFetch.mockReset();
    process.env.TAVILY_API_KEY = "tvly-test-key";
  });

  afterEach(() => {
    process.env.TAVILY_API_KEY = originalApiKey;
    vi.clearAllMocks();
  });

  it("returns found:true with mapped threads on success", async () => {
    mockOkResponse([makeTavilyResult()]);
    const result = await searchRedditForCourse("EN.601.226");
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.query).toBe("EN.601.226");
      expect(result.threads).toHaveLength(1);
      expect(result.threads[0].url).toContain("reddit.com");
    }
  });

  it("returns found:false when Tavily returns empty results", async () => {
    mockOkResponse([]);
    const result = await searchRedditForCourse("EN.601.226");
    expect(result.found).toBe(false);
  });

  it("returns at most 5 threads", async () => {
    mockOkResponse(Array.from({ length: 8 }, (_, i) => makeTavilyResult({ url: `https://reddit.com/${i}` })));
    const result = await searchRedditForCourse("EN.601.226");
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.threads).toHaveLength(5);
    }
  });

  it("returns found:false on network error", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));
    const result = await searchRedditForCourse("EN.601.226");
    expect(result.found).toBe(false);
    expect((result as { message: string }).message).toContain("unavailable");
  });

  it("returns found:false on non-ok HTTP response", async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) });
    const result = await searchRedditForCourse("EN.601.226");
    expect(result.found).toBe(false);
  });

  it("returns found:false without making a fetch call when TAVILY_API_KEY is missing", async () => {
    delete process.env.TAVILY_API_KEY;
    const result = await searchRedditForCourse("EN.601.226");
    expect(result.found).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
