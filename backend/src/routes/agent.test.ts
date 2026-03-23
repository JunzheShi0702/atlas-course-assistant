import { describe, it, expect, vi } from "vitest";

// Hoisted mocks so vi.mock factory can reference them.
const { mockGenerateText } = vi.hoisted(() => {
  return {
    mockGenerateText: vi.fn(),
  };
});

vi.mock("ai", () => {
  return {
    generateText: mockGenerateText,
    // These are invoked while building the `tools` object; keep them inert.
    tool: vi.fn((definition: unknown) => definition),
    stepCountIs: vi.fn(() => ({})),
  };
});

vi.mock("@ai-sdk/openai", () => {
  return {
    openai: vi.fn(() => ({})),
  };
});

import agentRouter from "./agent";

const getPostHandler = () => {
  type ReqLike = { body?: unknown };
  type ResLike = {
    status: (code: number) => ResLike;
    json: (v: unknown) => void;
  };
  type RouteStackLayer = { handle?: unknown };
  type RouteLike = {
    path?: string;
    methods?: Record<string, boolean>;
    stack?: RouteStackLayer[];
  };
  type ExpressLayerLike = { route?: RouteLike };

  const routerWithStack = agentRouter as unknown as { stack?: ExpressLayerLike[] };
  const layer = routerWithStack.stack?.find((l) => {
    const methods = l.route?.methods;
    return l.route?.path === "/" && methods?.post === true;
  });

  if (!layer?.route?.stack?.length) {
    throw new Error("Could not locate POST handler for agent router");
  }

  const handle = layer.route.stack[0].handle;
  if (typeof handle !== "function") {
    throw new Error("Could not locate POST handler function for agent router");
  }

  return handle as (req: ReqLike, res: ResLike) => Promise<void>;
};

const expectFallbackMessage = (message: unknown) => {
  expect(typeof message).toBe("string");
  // Avoid asserting the full string verbatim (punctuation/Unicode).
  expect(message).toContain("Try relaxing filters");
};

describe("POST /api/agent fallback behavior", () => {
  it("adds fallback message when type=search and results=[]", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({ type: "search", results: [] }),
    });

    const handler = getPostHandler();
    const resJson = vi.fn();
    const res = {
      status: vi.fn().mockReturnThis(),
      json: resJson,
    };
    const req = { body: { message: "some query" } };

    await handler(req, res);

    expect(resJson).toHaveBeenCalledOnce();
    const payload = resJson.mock.calls[0][0];
    expect(payload).toMatchObject({ type: "search", results: [] });
    expectFallbackMessage(payload.message);
  });

  it("adds fallback message when type=search and results is missing", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({ type: "search" }),
    });

    const handler = getPostHandler();
    const resJson = vi.fn();
    const res = {
      status: vi.fn().mockReturnThis(),
      json: resJson,
    };
    const req = { body: { message: "some query" } };

    await handler(req, res);

    expect(resJson).toHaveBeenCalledOnce();
    const payload = resJson.mock.calls[0][0];
    expect(payload).toMatchObject({ type: "search", results: [] });
    expectFallbackMessage(payload.message);
  });

  it("does not override message when type=search and results are non-empty", async () => {
    const results = [{ courseId: "en-601-226", title: "Data Structures", code: "EN.601.226" }];

    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({ type: "search", results }),
    });

    const handler = getPostHandler();
    const resJson = vi.fn();
    const res = {
      status: vi.fn().mockReturnThis(),
      json: resJson,
    };
    const req = { body: { message: "some query" } };

    await handler(req, res);

    expect(resJson).toHaveBeenCalledOnce();
    const payload = resJson.mock.calls[0][0];
    expect(payload).toMatchObject({ type: "search", results });
    // If model provided a non-empty results array, we should not inject a message.
    expect(payload).not.toHaveProperty("message");
  });

  it("adds fallback message when type=text and message is empty", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({ type: "text", message: "" }),
    });

    const handler = getPostHandler();
    const resJson = vi.fn();
    const res = {
      status: vi.fn().mockReturnThis(),
      json: resJson,
    };
    const req = { body: { message: "some query" } };

    await handler(req, res);

    expect(resJson).toHaveBeenCalledOnce();
    const payload = resJson.mock.calls[0][0];
    expect(payload).toMatchObject({ type: "text" });
    expectFallbackMessage(payload.message);
  });

  it("wraps invalid JSON output as type=text with raw message", async () => {
    const raw = "NOT JSON";
    mockGenerateText.mockResolvedValueOnce({ text: raw });

    const handler = getPostHandler();
    const resJson = vi.fn();
    const res = {
      status: vi.fn().mockReturnThis(),
      json: resJson,
    };
    const req = { body: { message: "some query" } };

    await handler(req, res);

    expect(resJson).toHaveBeenCalledOnce();
    const payload = resJson.mock.calls[0][0];
    expect(payload).toEqual({ type: "text", message: raw });
  });
});

