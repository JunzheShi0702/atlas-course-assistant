export type TimeBucket = "morning" | "afternoon" | "evening";

/** Half-open [start, end) in minutes from midnight; max end is 24 * 60. */
export type MinuteInterval = { start: number; end: number };

export const MINUTES_PER_DAY = 24 * 60;

const ALL_CALENDAR_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

/**
 * Time-range chip labels from `CLASS_TIME_RANGE_OPTIONS` in ClassTimePreference.tsx /
 * `buildUserProfilePayloadFromSurvey` — must stay in sync.
 * Each chip maps to allowed meeting clock times (local same-day window).
 */
const SURVEY_TIME_CHIP_TO_ALLOWED_RANGE: Record<string, MinuteInterval> = {
  "Early Morning (before 10am)": { start: 0, end: 10 * 60 },
  "Morning (10am-12pm)": { start: 10 * 60, end: 12 * 60 },
  "Mid Day (12pm-3pm)": { start: 12 * 60, end: 15 * 60 },
  "Afternoon (3pm-6pm)": { start: 15 * 60, end: 18 * 60 },
  "Evening (after 6pm)": { start: 18 * 60, end: MINUTES_PER_DAY },
};

function resolveSurveyTimeChipLabel(seg: string): string | null {
  const normalized = seg.trim().replace(/\s+/g, " ");
  if (SURVEY_TIME_CHIP_TO_ALLOWED_RANGE[normalized]) return normalized;
  const lower = normalized.toLowerCase();
  for (const key of Object.keys(SURVEY_TIME_CHIP_TO_ALLOWED_RANGE)) {
    if (key.toLowerCase() === lower) return key;
  }
  return null;
}

/** `Days: Mon, Tue, …` tokens from onboarding (case-insensitive). */
function parseSurveyDayToken(raw: string): string | null {
  const t = raw.trim().replace(/\.$/, "").toLowerCase();
  const map: Record<string, string> = {
    mon: "monday",
    monday: "monday",
    tue: "tuesday",
    tues: "tuesday",
    tuesday: "tuesday",
    wed: "wednesday",
    wednesday: "wednesday",
    thu: "thursday",
    thur: "thursday",
    thurs: "thursday",
    thursday: "thursday",
    fri: "friday",
    friday: "friday",
    sat: "saturday",
    saturday: "saturday",
    sun: "sunday",
    sunday: "sunday",
  };
  return map[t] ?? null;
}

/**
 * Days the user explicitly asks to avoid in free text (e.g. "no class on Friday").
 * Used when there is no structured `Times: …; Days: …` line.
 */
export function parseAvoidIntentDays(text: string): Set<string> {
  const out = new Set<string>();
  const re =
    /\b(?:no|avoid|skip|never)\s+(?:class(?:es)?\s+)?(?:on\s+)?(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const day = normalizeDayToken(m[1]);
    if (day) out.add(day);
  }
  return out;
}

export function mergeMinuteIntervals(intervals: MinuteInterval[]): MinuteInterval[] {
  const valid = intervals.filter(
    (i) => i.start < i.end && i.start >= 0 && i.end <= MINUTES_PER_DAY,
  );
  if (valid.length === 0) return [];
  valid.sort((a, b) => a.start - b.start);
  const out: MinuteInterval[] = [];
  for (const cur of valid) {
    const prev = out[out.length - 1];
    if (!prev || cur.start > prev.end) out.push({ start: cur.start, end: cur.end });
    else prev.end = Math.max(prev.end, cur.end);
  }
  return out;
}

/** Complement of merged `allowed` within [dayStart, dayEnd) — the clock windows the user did not select. */
export function complementMinuteIntervals(
  allowed: MinuteInterval[],
  dayStart = 0,
  dayEnd = MINUTES_PER_DAY,
): MinuteInterval[] {
  const merged = mergeMinuteIntervals(allowed);
  const out: MinuteInterval[] = [];
  let cursor = dayStart;
  for (const a of merged) {
    if (cursor < a.start) out.push({ start: cursor, end: a.start });
    cursor = Math.max(cursor, a.end);
  }
  if (cursor < dayEnd) out.push({ start: cursor, end: dayEnd });
  return out;
}

export function intervalsOverlapHalfOpen(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Unwanted meeting days and unwanted clock windows (complement of selected survey chips).
 * `null` means there is no usable preference signal (skip this audit).
 */
export type UnwantedSchedule = {
  unwantedDays: Set<string>;
  unwantedTimeIntervals: MinuteInterval[];
};

/**
 * Build unwanted days and unwanted time-of-day intervals from profile + memory text.
 *
 * - Structured line `Times: …; Days: …` (onboarding): unwanted weekdays are the complement of
 *   listed days among all seven calendar days; unwanted times are the complement of the union of
 *   selected time chips.
 * - Free text: additional unwanted days from phrases like "no class on Friday".
 */
export function parseUnwantedScheduleFromText(text: string): UnwantedSchedule | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^\s*no preference\s*$/i.test(trimmed)) return null;

  const unwantedDays = new Set<string>();
  const wantedDaysFromSurvey = new Set<string>();
  const allowedRanges: MinuteInterval[] = [];
  let sawStructuredLine = false;

  for (const rawLine of trimmed.split(/\n/)) {
    const line = rawLine.trim();
    const m = line.match(/^Times:\s*(.+?);\s*Days:\s*(.+)$/i);
    if (!m) continue;
    sawStructuredLine = true;

    const timesPart = m[1].trim();
    const daysPart = m[2].trim();

    if (daysPart.length > 0) {
      for (const token of daysPart.split(/,\s*/)) {
        const d = parseSurveyDayToken(token);
        if (d) wantedDaysFromSurvey.add(d);
      }
    }

    if (timesPart.length > 0) {
      for (const seg of timesPart.split(/,\s*/).map((s) => s.trim()).filter(Boolean)) {
        const label = resolveSurveyTimeChipLabel(seg);
        const range = label ? SURVEY_TIME_CHIP_TO_ALLOWED_RANGE[label] : undefined;
        if (range) allowedRanges.push({ ...range });
      }
    }
  }

  if (wantedDaysFromSurvey.size > 0) {
    for (const d of ALL_CALENDAR_DAYS) {
      if (!wantedDaysFromSurvey.has(d)) unwantedDays.add(d);
    }
  }

  for (const d of parseAvoidIntentDays(trimmed)) {
    unwantedDays.add(d);
  }

  let unwantedTimeIntervals: MinuteInterval[] = [];
  if (sawStructuredLine && allowedRanges.length > 0) {
    unwantedTimeIntervals = complementMinuteIntervals(allowedRanges);
  }

  if (unwantedDays.size === 0 && unwantedTimeIntervals.length === 0) {
    return null;
  }

  return { unwantedDays, unwantedTimeIntervals };
}

export function normalizeDayToken(input: string): string | null {
  const value = input.toLowerCase();
  if (/(^|\b)(mon|monday)(\b|$)/.test(value)) return "monday";
  if (/(^|\b)(tue|tues|tuesday)(\b|$)/.test(value)) return "tuesday";
  if (/(^|\b)(wed|wednesday)(\b|$)/.test(value)) return "wednesday";
  if (/(^|\b)(thu|thur|thurs|thursday)(\b|$)/.test(value)) return "thursday";
  if (/(^|\b)(fri|friday)(\b|$)/.test(value)) return "friday";
  if (/(^|\b)(sat|saturday)(\b|$)/.test(value)) return "saturday";
  if (/(^|\b)(sun|sunday)(\b|$)/.test(value)) return "sunday";
  return null;
}

export function parseDaysFromText(text: string): Set<string> {
  const dayRegex =
    /\b(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi;
  const out = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = dayRegex.exec(text)) !== null) {
    const normalized = normalizeDayToken(match[1]);
    if (normalized) out.add(normalized);
  }
  return out;
}

export function parseTimeBucketFromText(text: string): TimeBucket | null {
  const lower = text.toLowerCase();
  if (/\bmornings?\b|before\s+noon|before\s+12|before\s+11/.test(lower)) return "morning";
  if (/\bafternoon\b|after\s+noon|after\s+12/.test(lower)) return "afternoon";
  if (/\bevening\b|\bnight\b|after\s+5|after\s+6|after\s+7/.test(lower)) return "evening";
  return null;
}
