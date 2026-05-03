import { describe, expect, it } from "vitest";
import {
  complementMinuteIntervals,
  mergeMinuteIntervals,
  parseAvoidIntentDays,
  parseUnwantedScheduleFromText,
  parseTimeBucketFromText,
} from "./course-preference-parsing";

describe("parseUnwantedScheduleFromText", () => {
  it("treats unlisted calendar days as unwanted for structured Days line", () => {
    const text =
      "Times: Morning (10am-12pm); Days: Mon, Tue, Wed, Thu, Fri";
    const m = parseUnwantedScheduleFromText(text);
    expect(m).not.toBeNull();
    expect(m!.unwantedDays.has("saturday")).toBe(true);
    expect(m!.unwantedDays.has("sunday")).toBe(true);
    expect(m!.unwantedDays.has("monday")).toBe(false);
  });

  it("builds unwanted clock windows as the complement of selected time chips", () => {
    const text =
      "Times: Early Morning (before 10am), Afternoon (3pm-6pm); Days: Mon, Tue, Wed, Thu, Fri";
    const m = parseUnwantedScheduleFromText(text)!;
    const forbidden = m.unwantedTimeIntervals;
    expect(forbidden.some((i) => i.start === 10 * 60 && i.end === 15 * 60)).toBe(true);
    expect(forbidden.some((i) => i.start === 18 * 60 && i.end === 24 * 60)).toBe(true);
  });

  it("returns null when there is no structured line and no avoid-intent days", () => {
    expect(parseUnwantedScheduleFromText("I like interesting seminars.")).toBeNull();
  });

  it("returns null for No preference", () => {
    expect(parseUnwantedScheduleFromText("No preference")).toBeNull();
  });

  it("still returns a model when only free-text avoid phrases are present", () => {
    const m = parseUnwantedScheduleFromText("Please avoid class on Friday.");
    expect(m).not.toBeNull();
    expect(m!.unwantedDays.has("friday")).toBe(true);
    expect(m!.unwantedTimeIntervals).toEqual([]);
  });
});

describe("mergeMinuteIntervals / complementMinuteIntervals", () => {
  it("merges overlapping and adjacent intervals", () => {
    expect(
      mergeMinuteIntervals([
        { start: 100, end: 200 },
        { start: 150, end: 250 },
      ]),
    ).toEqual([{ start: 100, end: 250 }]);
  });

  it("complements allowed windows into forbidden gaps", () => {
    const forbidden = complementMinuteIntervals([
      { start: 0, end: 600 },
      { start: 900, end: 1080 },
    ]);
    expect(forbidden).toEqual([
      { start: 600, end: 900 },
      { start: 1080, end: 24 * 60 },
    ]);
  });
});

describe("parseAvoidIntentDays", () => {
  it("extracts days from avoid-style phrases", () => {
    const s = parseAvoidIntentDays("No class on Tuesday or skip Friday labs");
    expect(s.has("tuesday")).toBe(true);
    expect(s.has("friday")).toBe(true);
  });
});

describe("parseTimeBucketFromText", () => {
  it("treats plural mornings like morning", () => {
    expect(parseTimeBucketFromText("MWF mornings only")).toBe("morning");
  });
});
