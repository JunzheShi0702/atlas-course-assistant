import type { WeeklyCalendarEvent } from "../types/database";

type WeeklyCalendarDay = NonNullable<WeeklyCalendarEvent["dayOfWeek"]>;

const DOW_CODE_TO_NAME: Array<{ code: number; name: WeeklyCalendarDay }> = [
  { code: 1, name: "Monday" },
  { code: 2, name: "Tuesday" },
  { code: 4, name: "Wednesday" },
  { code: 8, name: "Thursday" },
  { code: 16, name: "Friday" },
  { code: 32, name: "Saturday" },
  { code: 64, name: "Sunday" },
];

const DAY_ORDER = new Map(DOW_CODE_TO_NAME.map((entry, index) => [entry.name, index]));

function to24HourTime(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (!match) {
    return null;
  }

  const [, hourPart, minutePart, meridian] = match;
  const hour12 = Number.parseInt(hourPart, 10);
  const minute = Number.parseInt(minutePart, 10);
  if (
    !Number.isFinite(hour12)
    || !Number.isFinite(minute)
    || hour12 < 1
    || hour12 > 12
    || minute < 0
    || minute > 59
  ) {
    return null;
  }

  const isPm = meridian.toUpperCase() === "PM";
  const hour24 = (hour12 % 12) + (isPm ? 12 : 0);
  return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function inferMissingStartMeridian(
  startTime: string,
  endTime: string,
  endMeridian: string,
): string | null {
  const assumedSameMeridian = to24HourTime(`${startTime}${endMeridian}`);
  const resolvedEndTime = to24HourTime(`${endTime}${endMeridian}`);
  if (assumedSameMeridian === null || resolvedEndTime === null) {
    return null;
  }

  if (assumedSameMeridian <= resolvedEndTime) {
    return assumedSameMeridian;
  }

  const toggledMeridian = endMeridian.toUpperCase() === "AM" ? "PM" : "AM";
  return to24HourTime(`${startTime}${toggledMeridian}`);
}

export function decodeDaysOfWeek(dow: string): WeeklyCalendarDay[] {
  const value = Number.parseInt(dow, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return [];
  }

  return DOW_CODE_TO_NAME
    .filter((entry) => (value & entry.code) === entry.code)
    .map((entry) => entry.name);
}

export function parseMeetingTimesTo24Hour(meetings: string): { startTime: string | null; endTime: string | null } {
  const match = meetings.match(/(\d{1,2}:\d{2})(?:\s*([AP]M))?\s*-\s*(\d{1,2}:\d{2})\s*([AP]M)/i);
  if (!match) {
    return { startTime: null, endTime: null };
  }

  const [, startTimeRaw, startMeridianRaw, endTimeRaw, endMeridianRaw] = match;
  const endMeridian = endMeridianRaw.toUpperCase();
  const startTime = startMeridianRaw
    ? to24HourTime(`${startTimeRaw}${startMeridianRaw}`)
    : inferMissingStartMeridian(startTimeRaw, endTimeRaw, endMeridian);

  return {
    startTime,
    endTime: to24HourTime(`${endTimeRaw}${endMeridian}`),
  };
}

function clockToMinutes(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number.parseInt(m[1], 10);
  const min = Number.parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return null;
  }
  return h * 60 + min;
}

/**
 * Same-calendar-day meeting window in minutes from midnight, for audits and checks.
 * Tries `StartTimeEndTime` (pipe-separated 24h) first — 1- or 2-digit hours allowed — then the SIS
 * `Meetings` string (same parser as weekly calendar events).
 */
export function parseSisMeetingMinutesRange(sis: {
  StartTimeEndTime?: unknown;
  Meetings?: unknown;
}): { start: number; end: number } | null {
  const ste = typeof sis.StartTimeEndTime === "string" ? sis.StartTimeEndTime.trim() : "";
  const pipe = ste.match(/^(\d{1,2}):(\d{2})\|(\d{1,2}):(\d{2})$/);
  if (pipe) {
    const sh = Number.parseInt(pipe[1], 10);
    const sm = Number.parseInt(pipe[2], 10);
    const eh = Number.parseInt(pipe[3], 10);
    const em = Number.parseInt(pipe[4], 10);
    if (![sh, sm, eh, em].every((n) => Number.isFinite(n))) return null;
    if (sm < 0 || sm > 59 || em < 0 || em > 59) return null;
    if (sh < 0 || sh > 23 || eh < 0 || eh > 23) return null;
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    if (end > start) return { start, end };
    return null;
  }

  const meetings = typeof sis.Meetings === "string" ? sis.Meetings : "";
  const { startTime, endTime } = parseMeetingTimesTo24Hour(meetings);
  const start = clockToMinutes(startTime);
  const end = clockToMinutes(endTime);
  if (start === null || end === null) return null;
  if (end <= start) return null;
  return { start, end };
}

export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function scheduleCourseToCourseId(sisOfferingName: string, term: string): string {
  const courseSlug = sisOfferingName.trim().replace(/\./g, "-").toLowerCase();
  const termSlug = term.trim().replace(/\s+/g, "-").toLowerCase();
  return `${courseSlug}-${termSlug}`;
}

export function sortWeeklyEvents(events: WeeklyCalendarEvent[]): WeeklyCalendarEvent[] {
  return [...events].sort((a, b) => {
    const dayA = a.dayOfWeek === null ? Number.MAX_SAFE_INTEGER : (DAY_ORDER.get(a.dayOfWeek) ?? Number.MAX_SAFE_INTEGER);
    const dayB = b.dayOfWeek === null ? Number.MAX_SAFE_INTEGER : (DAY_ORDER.get(b.dayOfWeek) ?? Number.MAX_SAFE_INTEGER);
    if (dayA !== dayB) {
      return dayA - dayB;
    }

    const startA = a.startTime ?? "99:99";
    const startB = b.startTime ?? "99:99";
    if (startA !== startB) {
      return startA.localeCompare(startB);
    }

    if (a.courseCode !== b.courseCode) {
      return a.courseCode.localeCompare(b.courseCode);
    }

    return a.eventId.localeCompare(b.eventId);
  });
}
