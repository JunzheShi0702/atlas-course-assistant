import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentGoldenCases } from "./agent-golden-cases";

const { mockGenerateText, mockIsQueryInProductScope } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockIsQueryInProductScope: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  streamText: vi.fn(),
  stepCountIs: vi.fn(() => () => true),
  tool: vi.fn((def) => def),
}));

vi.mock("@ai-sdk/openai", () => ({
  openai: vi.fn(() => "mock-model"),
}));

vi.mock("../services/query-scope", () => ({
  isQueryInProductScope: mockIsQueryInProductScope,
  OUT_OF_SCOPE_REDIRECT_MESSAGE: "I can only help with JHU course planning right now.",
}));

vi.mock("../pool", () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

vi.mock("../services/semantic-match-explanation-backfill", () => ({
  SEMANTIC_SEARCH_FALLBACK_EXPLANATION: "Related to your search by course description.",
  backfillSemanticMatchExplanationsInResults: vi.fn(async (_msg: string, rows: unknown[]) => rows),
}));

import agentRouter from "../routes/agent";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/agent", agentRouter);
  return app;
}

describe("AI eval suite: /api/agent golden cases", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
    mockIsQueryInProductScope.mockReset();
  });

  for (const testCase of agentGoldenCases) {
    it(`${testCase.id}: ${testCase.description}`, async () => {
      mockIsQueryInProductScope.mockResolvedValueOnce(testCase.inScope);

      if (testCase.inScope) {
        mockGenerateText.mockResolvedValueOnce({
          text: testCase.modelText ?? JSON.stringify({ type: "text", message: "ok" }),
          steps: [
            {
              toolResults: testCase.toolResults ?? [],
            },
          ],
        });
      }

      const res = await request(makeApp()).post("/api/agent").send({
        message: testCase.message,
        stream: false,
      });

      expect(res.status).toBe(200);
      expect(res.body.type).toBe(testCase.expected.type);

      if (testCase.expected.minResults !== undefined) {
        expect(Array.isArray(res.body.results)).toBe(true);
        expect(res.body.results.length).toBeGreaterThanOrEqual(testCase.expected.minResults);
      }

      if (testCase.expected.hasData !== undefined) {
        expect(res.body.hasData).toBe(testCase.expected.hasData);
      }

      if (testCase.expected.summaryContains) {
        const summaryText = String(res.body.summaryText ?? "");
        for (const snippet of testCase.expected.summaryContains) {
          expect(summaryText).toContain(snippet);
        }
      }

      if (testCase.expected.messageIncludes) {
        const message = String(res.body.message ?? "");
        for (const snippet of testCase.expected.messageIncludes) {
          expect(message).toContain(snippet);
        }
      }

      if (testCase.expected.messageExcludes) {
        const message = String(res.body.message ?? "");
        for (const snippet of testCase.expected.messageExcludes) {
          expect(message).not.toContain(snippet);
        }
      }
    });
  }
});
