import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPoolQuery, mockGenerateText } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockGenerateText: vi.fn(),
}));

vi.mock("../pool", () => ({
  pool: { query: mockPoolQuery },
}));

vi.mock("ai", () => ({
  generateText: mockGenerateText,
}));

vi.mock("@ai-sdk/openai", () => ({
  openai: vi.fn(() => "mock-model"),
}));

import {
  getOrCreateChatState,
  persistMessage,
  enforceRetentionPolicy,
} from "./chat-persistence";

const mockPool = { query: mockPoolQuery } as never;

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

    // COUNT query
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ count: "101" }] });
    // Fetch oldest 30
    mockPoolQuery.mockResolvedValueOnce({ rows: oldMessages });
    // Fetch rolling_summary
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ rolling_summary: "old summary" }] });
    // BEGIN
    mockPoolQuery.mockResolvedValueOnce({});
    // UPDATE rolling_summary
    mockPoolQuery.mockResolvedValueOnce({});
    // DELETE
    mockPoolQuery.mockResolvedValueOnce({});
    // COMMIT
    mockPoolQuery.mockResolvedValueOnce({});

    mockGenerateText.mockResolvedValueOnce({ text: "new condensed summary" });

    await enforceRetentionPolicy(mockPool, CHAT_STATE_ID);

    expect(mockGenerateText).toHaveBeenCalledTimes(1);

    // UPDATE should include the new summary
    const updateCall = mockPoolQuery.mock.calls.find((c) =>
      typeof c[0] === "string" && c[0].includes("UPDATE schedule_chat_state"),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toEqual(["new condensed summary", CHAT_STATE_ID]);

    // DELETE should target exactly the 30 old IDs
    const deleteCall = mockPoolQuery.mock.calls.find((c) =>
      typeof c[0] === "string" && c[0].includes("DELETE FROM schedule_chat_messages"),
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall![1]).toEqual([oldIds]);
  });

  it("rolls back transaction if update fails", async () => {
    const oldMessages = [{ id: "msg-1", role: "user", content: "hi" }];

    mockPoolQuery.mockResolvedValueOnce({ rows: [{ count: "101" }] });
    mockPoolQuery.mockResolvedValueOnce({ rows: oldMessages });
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ rolling_summary: "" }] });
    mockGenerateText.mockResolvedValueOnce({ text: "summary" });
    // BEGIN
    mockPoolQuery.mockResolvedValueOnce({});
    // UPDATE throws
    mockPoolQuery.mockRejectedValueOnce(new Error("db error"));
    // ROLLBACK
    mockPoolQuery.mockResolvedValueOnce({});

    await expect(enforceRetentionPolicy(mockPool, CHAT_STATE_ID)).rejects.toThrow("db error");

    const rollbackCall = mockPoolQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0] === "ROLLBACK",
    );
    expect(rollbackCall).toBeDefined();
  });
});
