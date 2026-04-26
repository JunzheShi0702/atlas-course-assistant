import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery, mockGenerateObject } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockGenerateObject: vi.fn(),
}));

vi.mock("../pool", () => ({
  pool: {
    query: mockQuery,
  },
}));

vi.mock("ai", () => ({
  generateObject: mockGenerateObject,
}));

vi.mock("@ai-sdk/openai", () => ({
  openai: vi.fn(() => "mock-model"),
}));

import { handleCustomScheduleEventMessage } from "./custom-schedule-event-orchestrator";

describe("handleCustomScheduleEventMessage", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockGenerateObject.mockReset();
  });

  it("returns handled=false for unrelated messages", async () => {
    const result = await handleCustomScheduleEventMessage({
      userId: "user-1",
      scheduleId: "sched-1",
      message: "what course should I take next semester",
    });

    expect(result).toEqual({ handled: false });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns a schedule-not-found message when the schedule is missing", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await handleCustomScheduleEventMessage({
      userId: "user-1",
      scheduleId: "sched-1",
      message: "add gym on Tuesday from 18:00 to 19:00",
    });

    expect(result).toEqual({
      handled: true,
      payload: {
        type: "text",
        message: "I couldn't find that schedule.",
      },
    });
  });

  it("returns a forbidden message for non-owners", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: "someone-else" }] });

    const result = await handleCustomScheduleEventMessage({
      userId: "user-1",
      scheduleId: "sched-1",
      message: "add gym on Tuesday from 18:00 to 19:00",
    });

    expect(result).toEqual({
      handled: true,
      payload: {
        type: "text",
        message: "You do not have permission to edit that schedule.",
      },
    });
  });

  it("creates a custom event and requests schedule refresh", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: "user-1" }] })
      .mockResolvedValueOnce({ rows: [] });
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        operation: "create",
        targetTitle: null,
        title: "Gym",
        dayOfWeek: "Tuesday",
        startTime: "18:00",
        endTime: "19:00",
        location: "Rec Center",
      },
    });

    const result = await handleCustomScheduleEventMessage({
      userId: "user-1",
      scheduleId: "sched-1",
      message: "add gym on Tuesday from 18:00 to 19:00 at Rec Center",
    });

    expect(result).toEqual({
      handled: true,
      payload: {
        type: "text",
        message: 'Added custom event "Gym" on Tuesday from 18:00 to 19:00.',
        scheduleRefreshRequired: true,
      },
    });
    expect(mockQuery.mock.calls[1]?.[0]).toContain("INSERT INTO schedule_custom_events");
  });

  it("creates a TBA custom event when only the title is provided", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: "user-1" }] });
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        operation: "create",
        targetTitle: null,
        title: "Study Block",
        dayOfWeek: null,
        startTime: null,
        endTime: null,
        location: null,
      },
    });

    const result = await handleCustomScheduleEventMessage({
      userId: "user-1",
      scheduleId: "sched-1",
      message: "add a study block with day and time TBA",
    });

    expect(result).toEqual({
      handled: true,
      payload: {
        type: "text",
        message: 'Added custom event "study block" with day and time TBA.',
        scheduleRefreshRequired: true,
      },
    });
    expect(mockQuery.mock.calls[1]?.[1]).toEqual([
      "sched-1",
      "study block",
      null,
      null,
      null,
      null,
    ]);
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("defaults the title to Untitled when create requests omit it entirely", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: "user-1" }] })
      .mockResolvedValueOnce({ rows: [] });
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        operation: "create",
        targetTitle: null,
        title: null,
        dayOfWeek: null,
        startTime: null,
        endTime: null,
        location: null,
      },
    });

    const result = await handleCustomScheduleEventMessage({
      userId: "user-1",
      scheduleId: "sched-1",
      message: "add an event for me",
    });

    expect(result).toEqual({
      handled: true,
      payload: {
        type: "text",
        message: 'Added custom event "Untitled" with day and time TBA.',
        scheduleRefreshRequired: true,
      },
    });
    expect(mockQuery.mock.calls[1]?.[1]).toEqual([
      "sched-1",
      "Untitled",
      null,
      null,
      null,
      null,
    ]);
  });

  it("defaults the title to Untitled for a generic add-event request", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: "user-1" }] })
      .mockResolvedValueOnce({ rows: [] });
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        operation: "create",
        targetTitle: null,
        title: null,
        dayOfWeek: null,
        startTime: null,
        endTime: null,
        location: null,
      },
    });

    const result = await handleCustomScheduleEventMessage({
      userId: "user-1",
      scheduleId: "sched-1",
      message: "add a new custom event to the schedule",
    });

    expect(result).toEqual({
      handled: true,
      payload: {
        type: "text",
        message: 'Added custom event "Untitled" with day and time TBA.',
        scheduleRefreshRequired: true,
      },
    });
    expect(mockQuery.mock.calls[1]?.[1]).toEqual([
      "sched-1",
      "Untitled",
      null,
      null,
      null,
      null,
    ]);
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
  });

  it("deterministically completes a follow-up detail reply after asking for a title", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: "user-1" }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await handleCustomScheduleEventMessage({
      userId: "user-1",
      scheduleId: "sched-1",
      message: "lab, monday afternoon 3-5",
      recentMessages: [
        { role: "user", content: "add a new custom event to the schedule" },
        {
          role: "assistant",
          content:
            "Please tell me the custom event title so I can add it. Try something like \"add a lab event Monday 3pm - 6pm\" or \"add a study block with day and time TBA.\"",
        },
      ],
    });

    expect(result).toEqual({
      handled: true,
      payload: {
        type: "text",
        message: 'Added custom event "lab" on Monday from 15:00 to 17:00.',
        scheduleRefreshRequired: true,
      },
    });
    expect(mockGenerateObject).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls[1]?.[1]).toEqual([
      "sched-1",
      "lab",
      "Monday",
      "15:00",
      "17:00",
      null,
    ]);
  });

  it("uses prior TBA context when a title-only follow-up arrives", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: "user-1" }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await handleCustomScheduleEventMessage({
      userId: "user-1",
      scheduleId: "sched-1",
      message: "call it test event",
      recentMessages: [
        { role: "user", content: "add an event with time and date TBA" },
        {
          role: "assistant",
          content:
            "Please tell me the custom event title so I can add it. Try something like \"add a lab event Monday 3pm - 6pm\" or \"add a study block with day and time TBA.\"",
        },
      ],
    });

    expect(result).toEqual({
      handled: true,
      payload: {
        type: "text",
        message: 'Added custom event "test event" with day and time TBA.',
        scheduleRefreshRequired: true,
      },
    });
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("rejects create requests with an invalid time range", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: "user-1" }] });
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        operation: "create",
        targetTitle: null,
        title: "Gym",
        dayOfWeek: "Tuesday",
        startTime: "19:00",
        endTime: "18:00",
        location: null,
      },
    });

    const result = await handleCustomScheduleEventMessage({
      userId: "user-1",
      scheduleId: "sched-1",
      message: "add gym Tuesday 19:00 to 18:00",
    });

    expect(result).toEqual({
      handled: true,
      payload: {
        type: "text",
        message: "The custom event end time needs to be later than the start time.",
      },
    });
  });

  it("rejects create requests with only one time endpoint", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: "user-1" }] });
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        operation: "create",
        targetTitle: null,
        title: "Gym",
        dayOfWeek: null,
        startTime: "19:00",
        endTime: null,
        location: null,
      },
    });

    const result = await handleCustomScheduleEventMessage({
      userId: "user-1",
      scheduleId: "sched-1",
      message: "add gym starting at 19:00",
    });

    expect(result).toEqual({
      handled: true,
      payload: {
        type: "text",
        message:
          'Please provide both a start and end time, or leave both as TBA. Try something like "add a lab event Monday 3pm - 6pm."',
      },
    });
  });

  it("returns handled=false when the parser says the request is not a custom event", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: "user-1" }] });
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        operation: "none",
        targetTitle: null,
        title: null,
        dayOfWeek: null,
        startTime: null,
        endTime: null,
        location: null,
      },
    });

    const result = await handleCustomScheduleEventMessage({
      userId: "user-1",
      scheduleId: "sched-1",
      message: "schedule a thing on Tuesday",
    });

    expect(result).toEqual({ handled: false });
  });

  it("asks which event to update when no target title is available", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: "user-1" }] });
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        operation: "update",
        targetTitle: null,
        title: null,
        dayOfWeek: "Thursday",
        startTime: "20:00",
        endTime: "21:00",
        location: null,
      },
    });

    const result = await handleCustomScheduleEventMessage({
      userId: "user-1",
      scheduleId: "sched-1",
      message: "move it to Thursday night",
    });

    expect(result).toEqual({
      handled: true,
      payload: {
        type: "text",
        message: "Please tell me which custom event you want to update.",
      },
    });
  });

  it("returns not-found when the target custom event does not exist", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: "user-1" }] })
      .mockResolvedValueOnce({ rows: [] });
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        operation: "delete",
        targetTitle: "Gym",
        title: null,
        dayOfWeek: null,
        startTime: null,
        endTime: null,
        location: null,
      },
    });

    const result = await handleCustomScheduleEventMessage({
      userId: "user-1",
      scheduleId: "sched-1",
      message: "remove my gym event",
    });

    expect(result).toEqual({
      handled: true,
      payload: {
        type: "text",
        message: 'I couldn\'t find a custom event named "Gym" in this schedule.',
      },
    });
  });

  it("returns an ambiguity message when multiple events have the same title", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: "user-1" }] })
      .mockResolvedValueOnce({
        rows: [
          { id: "1", title: "Gym", day_of_week: "Tuesday", start_time: "18:00", end_time: "19:00", location: null },
          { id: "2", title: "Gym", day_of_week: "Thursday", start_time: "18:00", end_time: "19:00", location: null },
        ],
      });
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        operation: "delete",
        targetTitle: "Gym",
        title: null,
        dayOfWeek: null,
        startTime: null,
        endTime: null,
        location: null,
      },
    });

    const result = await handleCustomScheduleEventMessage({
      userId: "user-1",
      scheduleId: "sched-1",
      message: "remove gym",
    });

    expect(result).toEqual({
      handled: true,
      payload: {
        type: "text",
        message: 'I found multiple custom events named "Gym". Please clarify which one by including the day or time.',
      },
    });
  });

  it("updates a matching event and requests refresh", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: "user-1" }] })
      .mockResolvedValueOnce({
        rows: [
          { id: "1", title: "Gym", day_of_week: "Tuesday", start_time: "18:00", end_time: "19:00", location: "Rec" },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        operation: "update",
        targetTitle: "Gym",
        title: "Gym",
        dayOfWeek: "Thursday",
        startTime: "20:00",
        endTime: "21:00",
        location: "Rec",
      },
    });

    const result = await handleCustomScheduleEventMessage({
      userId: "user-1",
      scheduleId: "sched-1",
      message: "move gym to Thursday from 20:00 to 21:00",
    });

    expect(result).toEqual({
      handled: true,
      payload: {
        type: "text",
        message: 'Updated custom event "Gym" on Thursday from 20:00 to 21:00.',
        scheduleRefreshRequired: true,
      },
    });
    expect(mockQuery.mock.calls[2]?.[0]).toContain("UPDATE schedule_custom_events");
  });

  it("updates an event to TBA timing when the user asks to clear its schedule", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: "user-1" }] })
      .mockResolvedValueOnce({
        rows: [
          { id: "1", title: "Gym", day_of_week: "Tuesday", start_time: "18:00", end_time: "19:00", location: "Rec" },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        operation: "update",
        targetTitle: "Gym",
        title: "Gym",
        dayOfWeek: null,
        startTime: null,
        endTime: null,
        location: null,
      },
    });

    const result = await handleCustomScheduleEventMessage({
      userId: "user-1",
      scheduleId: "sched-1",
      message: "make the gym event day and time TBA",
    });

    expect(result).toEqual({
      handled: true,
      payload: {
        type: "text",
        message: 'Updated custom event "Gym" with day and time TBA.',
        scheduleRefreshRequired: true,
      },
    });
    expect(mockQuery.mock.calls[2]?.[1]).toEqual(["1", "Gym", null, null, null, "Rec"]);
  });

  it("uses the parsed title as the update lookup target when targetTitle is absent", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: "user-1" }] })
      .mockResolvedValueOnce({
        rows: [
          { id: "1", title: "Gym", day_of_week: "Tuesday", start_time: "18:00", end_time: "19:00", location: "Rec" },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        operation: "update",
        targetTitle: null,
        title: "Gym",
        dayOfWeek: "Wednesday",
        startTime: "18:30",
        endTime: "19:30",
        location: "   ",
      },
    });

    const result = await handleCustomScheduleEventMessage({
      userId: "user-1",
      scheduleId: "sched-1",
      message: "move gym to Wednesday from 18:30 to 19:30",
    });

    expect(result).toEqual({
      handled: true,
      payload: {
        type: "text",
        message: 'Updated custom event "Gym" on Wednesday from 18:30 to 19:30.',
        scheduleRefreshRequired: true,
      },
    });
    expect(mockQuery.mock.calls[1]?.[1]).toEqual(["sched-1", "Gym"]);
    expect(mockQuery.mock.calls[2]?.[1]).toEqual(["1", "Gym", "Wednesday", "18:30", "19:30", null]);
  });

  it("rejects invalid update time ranges", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: "user-1" }] })
      .mockResolvedValueOnce({
        rows: [
          { id: "1", title: "Gym", day_of_week: "Tuesday", start_time: "18:00", end_time: "19:00", location: "Rec" },
        ],
      });
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        operation: "update",
        targetTitle: "Gym",
        title: "Gym",
        dayOfWeek: "Thursday",
        startTime: "21:00",
        endTime: "20:00",
        location: "Rec",
      },
    });

    const result = await handleCustomScheduleEventMessage({
      userId: "user-1",
      scheduleId: "sched-1",
      message: "move gym to Thursday 21:00 to 20:00",
    });

    expect(result).toEqual({
      handled: true,
      payload: {
        type: "text",
        message: "The updated custom event end time needs to be later than the start time.",
      },
    });
  });

  it("deletes a matching custom event and requests refresh", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: "user-1" }] })
      .mockResolvedValueOnce({
        rows: [
          { id: "1", title: "Gym", day_of_week: "Tuesday", start_time: "18:00", end_time: "19:00", location: null },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        operation: "delete",
        targetTitle: "Gym",
        title: null,
        dayOfWeek: null,
        startTime: null,
        endTime: null,
        location: null,
      },
    });

    const result = await handleCustomScheduleEventMessage({
      userId: "user-1",
      scheduleId: "sched-1",
      message: "delete gym",
    });

    expect(result).toEqual({
      handled: true,
      payload: {
        type: "text",
        message: 'Removed custom event "Gym".',
        scheduleRefreshRequired: true,
      },
    });
    expect(mockQuery.mock.calls[2]?.[0]).toContain("DELETE FROM schedule_custom_events");
  });

  it("stores null location when a created custom event omits or blanks it", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: "user-1" }] })
      .mockResolvedValueOnce({ rows: [] });
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        operation: "create",
        targetTitle: null,
        title: "Office Hours",
        dayOfWeek: "Friday",
        startTime: "12:00",
        endTime: "13:00",
        location: "   ",
      },
    });

    await handleCustomScheduleEventMessage({
      userId: "user-1",
      scheduleId: "sched-1",
      message: "add office hours Friday 12:00 to 13:00",
    });

    expect(mockQuery.mock.calls[1]?.[1]).toEqual([
      "sched-1",
      "Office Hours",
      "Friday",
      "12:00",
      "13:00",
      null,
    ]);
  });
});
