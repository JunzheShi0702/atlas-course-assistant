import { describe, expect, it } from "vitest";
import {
  extractFirstJsonObjectString,
  normalizeAgentApiPayload,
  parseAgentPayloadFromModelText,
  stripMarkdownJsonFence,
} from "./parseAgentPayload";

describe("parseAgentPayload utils", () => {
  it("strips fenced json blocks", () => {
    const input = "```json\n{\"type\":\"text\",\"message\":\"ok\"}\n```";
    expect(stripMarkdownJsonFence(input)).toBe("{\"type\":\"text\",\"message\":\"ok\"}");
  });

  it("extracts the first complete json object from prose", () => {
    const text = 'Answer: {"type":"search","results":[{"title":"A"}]} trailing text';
    expect(extractFirstJsonObjectString(text)).toBe('{"type":"search","results":[{"title":"A"}]}');
  });

  it("parses model text that includes prose around json", () => {
    const parsed = parseAgentPayloadFromModelText(
      'Here you go:\n{"type":"summary","summaryText":"Great class"}',
    ) as { type: string; summaryText: string };

    expect(parsed.type).toBe("summary");
    expect(parsed.summaryText).toBe("Great class");
  });

  it("normalizes type=text payload when message contains json", () => {
    const normalized = normalizeAgentApiPayload({
      type: "text",
      message: "```json\n{\"type\":\"search\",\"results\":[]}\n```",
    }) as { type: string; results?: unknown[] };

    expect(normalized.type).toBe("search");
    expect(normalized.results).toEqual([]);
  });

  it("keeps original payload when message is not parsable json", () => {
    const payload = { type: "text", message: "just plain text" };
    expect(normalizeAgentApiPayload(payload)).toEqual(payload);
  });
});
