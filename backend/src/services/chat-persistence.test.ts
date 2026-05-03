import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPoolQuery, mockClientQuery, mockClientRelease, mockPoolConnect, mockGenerateText } =
  vi.hoisted(() => {
    const mockClientQuery = vi.fn();
    const mockClientRelease = vi.fn();
    const mockPoolConnect = vi.fn().mockResolvedValue({
      query: mockClientQuery,
      release: mockClientRelease,
    });
    return {
      mockPoolQuery: vi.fn(),
      mockClientQuery,
      mockClientRelease,
      mockPoolConnect,
      mockGenerateText: vi.fn(),
    };
  });

vi.mock("../pool", () => ({
  pool: { query: mockPoolQuery, connect: mockPoolConnect },
}));

vi.mock("ai", () => ({
  generateText: mockGenerateText,
}));

vi.mock("@ai-sdk/openai", () => ({
  openai: vi.fn(() => "mock-model"),
}));

import {
  getOrCreateChatState,
  getPendingClarificationState,
  upsertPendingClarificationState,
  resolvePendingClarificationState,
  persistMessage,
  enforceRetentionPolicy,
  loadRecentMessages,
  formatChatHistoryBlock,
} from "./chat-persistence";

const mockPool = { query: mockPoolQuery, connect: mockPoolConnect } as never;

const CHAT_STATE_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const SCHEDULE_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000001";

const chatStateRow = {
  id: CHAT_STATE_ID,
  schedule_id: SCHEDULE_ID,
  user_id: USER_ID,
  rolling_summary: "",
  created_at: new Date(),
  updated_at: new Date(),
};

describe("getOrCreateChatState", () => {
  beforeEach(() => vi.clearAllMocks());

  it("upserts and returns the chat state row", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [chatStateRow] });

    const result = await getOrCreateChatState(mockPool, SCHEDULE_ID, USER_ID);

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (schedule_id)"),
      [SCHEDULE_ID, USER_ID],
    );
    expect(result).toEqual(chatStateRow);
  });

  it("returns the existing row on conflict (upsert semantics)", async () => {
    const existing = { ...chatStateRow, rolling_summary: "prior summary" };
    mockPoolQuery.mockResolvedValueOnce({ rows: [existing] });

    const result = await getOrCreateChatState(mockPool, SCHEDULE_ID, USER_ID);

    expect(result.rolling_summary).toBe("prior summary");
  });
});

describe("persistMessage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts a message row and returns it", async () => {
    const msgRow = {
      id: "cccccccc-0000-0000-0000-000000000001",
      chat_state_id: CHAT_STATE_ID,
      schedule_id: SCHEDULE_ID,
      role: "user",
      content: "help me find a CS course",
      response_type: null,
      metadata: {},
      created_at: new Date(),
    };
    mockPoolQuery.mockResolvedValueOnce({ rows: [msgRow] });

    const result = await persistMessage(mockPool, {
      chatStateId: CHAT_STATE_ID,
      scheduleId: SCHEDULE_ID,
      role: "user",
      content: "help me find a CS course",
    });

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO schedule_chat_messages"),
      [CHAT_STATE_ID, SCHEDULE_ID, "user", "help me find a CS course", null, {}],
    );
    expect(result).toEqual(msgRow);
  });

  it("passes responseType and metadata when provided", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{}] });

    await persistMessage(mockPool, {
      chatStateId: CHAT_STATE_ID,
      scheduleId: SCHEDULE_ID,
      role: "assistant",
      content: "here are some courses",
      responseType: "search",
      metadata: { type: "search", results: [] },
    });

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.any(String),
      [CHAT_STATE_ID, SCHEDULE_ID, "assistant", "here are some courses", "search", { type: "search", results: [] }],
    );
  });
});

describe("clarification-state CRUD", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns pending clarification state when present", async () => {
    const row = { chat_state_id: CHAT_STATE_ID, status: "pending", missing_slots: ["addTarget"] };
    mockPoolQuery.mockResolvedValueOnce({ rows: [row] });

    const result = await getPendingClarificationState(mockPool, CHAT_STATE_ID);

    expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining("FROM schedule_clarification_state"), [
      CHAT_STATE_ID,
    ]);
    expect(result).toEqual(row);
  });

  it("upserts pending clarification state with serialized jsonb fields", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: "clar-1", status: "pending" }] });

    await upsertPendingClarificationState(mockPool, {
      chatStateId: CHAT_STATE_ID,
      scheduleId: SCHEDULE_ID,
      userId: USER_ID,
      intent: { operation: "replace" },
      missingSlots: ["dropTarget", "addTarget"],
      confirmedSlots: { dropTarget: { courseCode: "601.226" } },
      candidateOptions: { addTarget: [{ courseCode: "520.433" }] },
      nextQuestion: { slotKey: "addTarget", prompt: "Which course should I add?" },
      originalRequest: "replace class",
    });

    const params = mockPoolQuery.mock.calls[0]?.[1] as unknown[];
    expect(mockPoolQuery.mock.calls[0]?.[0]).toContain("INSERT INTO schedule_clarification_state");
    expect(params[0]).toBe(CHAT_STATE_ID);
    expect(params[1]).toBe(SCHEDULE_ID);
    expect(params[2]).toBe(USER_ID);
    expect(params[3]).toBe(JSON.stringify({ operation: "replace" }));
    expect(params[4]).toBe(JSON.stringify(["dropTarget", "addTarget"]));
    expect(params[5]).toBe(JSON.stringify({ dropTarget: { courseCode: "601.226" } }));
    expect(params[6]).toBe(JSON.stringify({ addTarget: [{ courseCode: "520.433" }] }));
    expect(params[7]).toBe(JSON.stringify({ slotKey: "addTarget", prompt: "Which course should I add?" }));
    expect(params[8]).toBe("replace class");
  });

  it("resolves pending clarification state", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    await resolvePendingClarificationState(mockPool, CHAT_STATE_ID);

    expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining("SET status = 'resolved'"), [CHAT_STATE_ID]);
  });
});

describe("enforceRetentionPolicy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is a no-op when message count is 100 or fewer", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ count: "100" }] });

    await enforceRetentionPolicy(mockPool, CHAT_STATE_ID);

    // Only the COUNT query should have been called
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("summarizes oldest 30, updates rolling_summary, and deletes them when count > 100", async () => {
    const oldMessages = Array.from({ length: 30 }, (_, i) => ({
      id: `msg-id-${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i}`,
    }));
    const oldIds = oldMessages.map((m) => m.id);

    // Pool-level queries: COUNT, fetch oldest 30, fetch rolling_summary
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ count: "101" }] });
    mockPoolQuery.mockResolvedValueOnce({ rows: oldMessages });
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ rolling_summary: "old summary" }] });

    // Client-level queries (dedicated connection for transaction): BEGIN, UPDATE, DELETE, COMMIT
    mockClientQuery.mockResolvedValueOnce({}); // BEGIN
    mockClientQuery.mockResolvedValueOnce({}); // UPDATE rolling_summary
    mockClientQuery.mockResolvedValueOnce({}); // DELETE
    mockClientQuery.mockResolvedValueOnce({}); // COMMIT

    mockGenerateText.mockResolvedValueOnce({ text: "new condensed summary" });

    await enforceRetentionPolicy(mockPool, CHAT_STATE_ID);

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    expect(mockPoolConnect).toHaveBeenCalledTimes(1);
    expect(mockClientRelease).toHaveBeenCalledTimes(1);

    // UPDATE should include the new summary
    const updateCall = mockClientQuery.mock.calls.find((c) =>
      typeof c[0] === "string" && c[0].includes("UPDATE schedule_chat_state"),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toEqual(["new condensed summary", CHAT_STATE_ID]);

    // DELETE should target exactly the 30 old IDs
    const deleteCall = mockClientQuery.mock.calls.find((c) =>
      typeof c[0] === "string" && c[0].includes("DELETE FROM schedule_chat_messages"),
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall![1]).toEqual([oldIds]);
  });

  it("rolls back transaction if update fails", async () => {
    const oldMessages = [{ id: "msg-1", role: "user", content: "hi" }];

    // Pool-level queries: COUNT, fetch oldest 30, fetch rolling_summary
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ count: "101" }] });
    mockPoolQuery.mockResolvedValueOnce({ rows: oldMessages });
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ rolling_summary: "" }] });

    // Client-level queries: BEGIN, UPDATE throws, ROLLBACK
    mockClientQuery.mockResolvedValueOnce({}); // BEGIN
    mockClientQuery.mockRejectedValueOnce(new Error("db error")); // UPDATE throws
    mockClientQuery.mockResolvedValueOnce({}); // ROLLBACK

    mockGenerateText.mockResolvedValueOnce({ text: "summary" });

    await expect(enforceRetentionPolicy(mockPool, CHAT_STATE_ID)).rejects.toThrow("db error");

    expect(mockClientRelease).toHaveBeenCalledTimes(1);

    const rollbackCall = mockClientQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0] === "ROLLBACK",
    );
    expect(rollbackCall).toBeDefined();
  });
});

describe("loadRecentMessages", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns messages in chronological order (oldest first)", async () => {
    // DB query uses ORDER BY created_at DESC, so rows arrive newest-first
    const rows = [
      { id: "msg-3", role: "assistant", content: "c", created_at: new Date("2026-01-03") },
      { id: "msg-2", role: "user",      content: "b", created_at: new Date("2026-01-02") },
      { id: "msg-1", role: "user",      content: "a", created_at: new Date("2026-01-01") },
    ];
    mockPoolQuery.mockResolvedValueOnce({ rows });

    const result = await loadRecentMessages(mockPool, CHAT_STATE_ID);

    // reverse() produces chronological order: oldest (msg-1) → newest (msg-3)
    expect(result.map((m) => m.id)).toEqual(["msg-1", "msg-2", "msg-3"]);
  });

  it("passes the limit to the query", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    await loadRecentMessages(mockPool, CHAT_STATE_ID, 10);

    expect(mockPoolQuery).toHaveBeenCalledWith(expect.any(String), [CHAT_STATE_ID, 10]);
  });

  it("defaults to limit 15", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    await loadRecentMessages(mockPool, CHAT_STATE_ID);

    expect(mockPoolQuery).toHaveBeenCalledWith(expect.any(String), [CHAT_STATE_ID, 15]);
  });

  it("returns empty array when no messages exist", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    const result = await loadRecentMessages(mockPool, CHAT_STATE_ID);

    expect(result).toEqual([]);
  });
});

describe("formatChatHistoryBlock", () => {
  it("returns empty string when no summary and no messages", () => {
    expect(formatChatHistoryBlock("", [])).toBe("");
  });

  it("includes rolling summary when present and no messages", () => {
    const block = formatChatHistoryBlock("User wants no Friday classes.", []);
    expect(block).toContain("Summary of earlier messages:");
    expect(block).toContain("User wants no Friday classes.");
    expect(block).not.toContain("Recent messages:");
  });

  it("includes recent messages in order when no summary", () => {
    const messages = [
      { role: "user" as const,      content: "find me a CS course" },
      { role: "assistant" as const, content: "Here are some options." },
    ];
    const block = formatChatHistoryBlock("", messages);
    expect(block).toContain("Recent messages:");
    expect(block).toContain("user: find me a CS course");
    expect(block).toContain("assistant: Here are some options.");
    expect(block).not.toContain("Summary of earlier messages:");
  });

  it("includes both summary and messages when both present", () => {
    const block = formatChatHistoryBlock("Prior summary.", [
      { role: "user" as const, content: "follow-up question" },
    ]);
    expect(block).toContain("Summary of earlier messages:");
    expect(block).toContain("Prior summary.");
    expect(block).toContain("Recent messages:");
    expect(block).toContain("user: follow-up question");
  });

  it("wraps content with history delimiters", () => {
    const block = formatChatHistoryBlock("s", [{ role: "user" as const, content: "q" }]);
    expect(block).toContain("--- Conversation History ---");
    expect(block).toContain("--- End of Conversation History ---");
  });
});
