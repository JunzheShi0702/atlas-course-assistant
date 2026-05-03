import { describe, expect, it } from "vitest";
import {
  decodeDaysOfWeek,
  normalizeOptionalText,
  parseMeetingTimesTo24Hour,
  parseSisMeetingMinutesRange,
  scheduleCourseToCourseId,
  sortWeeklyEvents,
} from "./weekly-events-contract";
import { weeklyCalendarEventsResponseSchema } from "../types/database";

describe("weekly-events-contract helpers", () => {
  it("decodes SIS day bitmask values to ordered day names", () => {
    expect(decodeDaysOfWeek("5")).toEqual(["Monday", "Wednesday"]);
    expect(decodeDaysOfWeek("0")).toEqual([]);
    expect(decodeDaysOfWeek("bad")).toEqual([]);
  });

  it("parses 12-hour SIS meeting ranges into 24-hour times", () => {
    expect(parseMeetingTimesTo24Hour("M 3:30PM - 5:20PM")).toEqual({
      startTime: "15:30",
      endTime: "17:20",
    });
    expect(parseMeetingTimesTo24Hour("F 12:00AM - 1:15AM")).toEqual({
      startTime: "00:00",
      endTime: "01:15",
    });
    expect(parseMeetingTimesTo24Hour("TBA")).toEqual({
      startTime: null,
      endTime: null,
    });
  });

  it("parses compact SIS meeting ranges when the start meridian is omitted", () => {
    expect(parseMeetingTimesTo24Hour("MWF 9:00-10:15AM")).toEqual({
      startTime: "09:00",
      endTime: "10:15",
    });
    expect(parseMeetingTimesTo24Hour("Th 11:30-12:45PM")).toEqual({
      startTime: "11:30",
      endTime: "12:45",
    });
  });

  it("parseSisMeetingMinutesRange accepts single-digit hours in StartTimeEndTime", () => {
    expect(parseSisMeetingMinutesRange({ StartTimeEndTime: "9:00|10:15" })).toEqual({
      start: 9 * 60,
      end: 10 * 60 + 15,
    });
  });

  it("parseSisMeetingMinutesRange falls back to Meetings when pipe field is missing", () => {
    expect(
      parseSisMeetingMinutesRange({
        Meetings: "T 9:00-10:15AM",
      }),
    ).toEqual({ start: 9 * 60, end: 10 * 60 + 15 });
  });

  it("returns null times when SIS meeting ranges contain impossible minutes", () => {
    expect(parseMeetingTimesTo24Hour("M 3:99PM - 5:20PM")).toEqual({
      startTime: null,
      endTime: "17:20",
    });
    expect(parseMeetingTimesTo24Hour("W 3:30PM - 5:99PM")).toEqual({
      startTime: "15:30",
      endTime: null,
    });
  });

  it("normalizes optional text and courseId formatting deterministically", () => {
    expect(normalizeOptionalText("  Malone 228  ")).toBe("Malone 228");
    expect(normalizeOptionalText("   ")).toBeNull();
    expect(scheduleCourseToCourseId("EN.601.226", "Spring 2026")).toBe("en-601-226-spring-2026");
  });

  it("sorts events deterministically by day, startTime, courseCode, then eventId", () => {
    const sorted = sortWeeklyEvents([
      {
        eventId: "a:EN.601.200:Tuesday:09:00:10:00",
        dayOfWeek: "Tuesday",
        startTime: "09:00",
        endTime: "10:00",
        courseCode: "EN.601.200",
        courseTitle: "B",
        location: null,
      },
      {
        eventId: "a:EN.601.100:Monday:11:00:12:00",
        dayOfWeek: "Monday",
        startTime: "11:00",
        endTime: "12:00",
        courseCode: "EN.601.100",
        courseTitle: "A",
        location: null,
      },
      {
        eventId: "a:EN.601.050:unknown",
        dayOfWeek: null,
        startTime: null,
        endTime: null,
        courseCode: "EN.601.050",
        courseTitle: "Unknown",
        location: null,
      },
      {
        eventId: "a:EN.601.150:Monday:08:00:09:00",
        dayOfWeek: "Monday",
        startTime: "08:00",
        endTime: "09:00",
        courseCode: "EN.601.150",
        courseTitle: "C",
        location: null,
      },
    ]);

    expect(sorted.map((event) => event.eventId)).toEqual([
      "a:EN.601.150:Monday:08:00:09:00",
      "a:EN.601.100:Monday:11:00:12:00",
      "a:EN.601.200:Tuesday:09:00:10:00",
      "a:EN.601.050:unknown",
    ]);
  });

  it("rejects malformed weekly calendar DTO values at the schema boundary", () => {
    expect(
      weeklyCalendarEventsResponseSchema.safeParse({
        events: [
          {
            eventId: "evt-1",
            dayOfWeek: "Funday",
            startTime: "09:00",
            endTime: "10:15",
            courseCode: "EN.601.226",
            courseTitle: "Data Structures",
            location: "Malone 228",
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      weeklyCalendarEventsResponseSchema.safeParse({
        events: [
          {
            eventId: "evt-2",
            dayOfWeek: "Monday",
            startTime: "24:00",
            endTime: "10:15",
            courseCode: "EN.601.226",
            courseTitle: "Data Structures",
            location: "Malone 228",
          },
        ],
      }).success,
    ).toBe(false);
  });
});
