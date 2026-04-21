import type { WeeklyCalendarEvent } from "../types/database";

const DOW_CODE_TO_NAME: Array<{ code: number; name: string }> = [
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

export function decodeDaysOfWeek(dow: string): Array<string> {
  const value = Number.parseInt(dow, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return [];
  }

  return DOW_CODE_TO_NAME
    .filter((entry) => (value & entry.code) === entry.code)
    .map((entry) => entry.name);
}

export function parseMeetingTimesTo24Hour(meetings: string): { startTime: string | null; endTime: string | null } {
  const match = meetings.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (!match) {
    return { startTime: null, endTime: null };
  }

  const [, startRaw, endRaw] = match;
  return {
    startTime: to24HourTime(startRaw),
    endTime: to24HourTime(endRaw),
  };
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
