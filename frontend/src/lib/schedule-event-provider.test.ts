import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleEventProvider } from "./schedule-event-provider";

describe("scheduleEventProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns backend weekly events when the payload is valid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [
          {
            eventId: "evt-1",
            eventType: "course",
            dayOfWeek: "Monday",
            startTime: "09:00",
            endTime: "10:00",
            courseCode: "EN.601.226",
            courseTitle: "Data Structures",
            location: "Malone 228",
          },
        ],
      }),
    }));

    const events = await scheduleEventProvider.getWeeklyEvents("sched-1");

    expect(events).toHaveLength(1);
    expect(events[0]?.courseCode).toBe("EN.601.226");
  });

  it("normalizes legacy course events that do not include eventType", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [
          {
            eventId: "legacy-course",
            dayOfWeek: "Tuesday",
            startTime: "11:00",
            endTime: "12:00",
            courseCode: "EN.601.315",
            courseTitle: "Databases",
            location: "Hackerman 122",
          },
        ],
      }),
    }));

    const events = await scheduleEventProvider.getWeeklyEvents("sched-1");

    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("course");
    expect(events[0]?.eventId).toBe("legacy-course");
  });

  it("filters malformed event rows out of the backend payload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [
          {
            eventId: "evt-1",
            eventType: "course",
            dayOfWeek: "Monday",
            startTime: "09:00",
            endTime: "10:00",
            courseCode: "EN.601.226",
            courseTitle: "Data Structures",
            location: "Malone 228",
          },
          {
            eventId: "evt-2",
            eventType: "course",
            courseCode: "EN.601.315",
          },
          null,
        ],
      }),
    }));

    const events = await scheduleEventProvider.getWeeklyEvents("sched-1");

    expect(events).toHaveLength(1);
    expect(events[0]?.eventId).toBe("evt-1");
  });

  it("returns an empty list when the backend payload does not contain an events array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        events: { bad: true },
      }),
    }));

    const events = await scheduleEventProvider.getWeeklyEvents("sched-1");

    expect(events).toEqual([]);
  });

  it("filters rows with invalid optional field types or invalid weekdays", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [
          {
            eventId: "evt-good",
            eventType: "course",
            dayOfWeek: null,
            startTime: null,
            endTime: null,
            courseCode: "EN.601.226",
            courseTitle: "Data Structures",
            location: null,
          },
          {
            eventId: "evt-bad-day",
            eventType: "course",
            dayOfWeek: "Funday",
            startTime: "09:00",
            endTime: "10:00",
            courseCode: "EN.601.315",
            courseTitle: "Databases",
            location: "Hackerman 122",
          },
          {
            eventId: "evt-bad-location",
            eventType: "course",
            dayOfWeek: "Monday",
            startTime: "09:00",
            endTime: "10:00",
            courseCode: "EN.601.433",
            courseTitle: "Algorithms",
            location: 42,
          },
        ],
      }),
    }));

    const events = await scheduleEventProvider.getWeeklyEvents("sched-1");

    expect(events).toHaveLength(1);
    expect(events[0]?.eventId).toBe("evt-good");
  });

  it("throws the backend http status when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
    }));

    await expect(scheduleEventProvider.getWeeklyEvents("sched-1")).rejects.toThrow("HTTP 403");
  });
});
