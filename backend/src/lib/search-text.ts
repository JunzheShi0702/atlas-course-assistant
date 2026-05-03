export type TimeBucket = "morning" | "afternoon" | "evening";

export function normalizeCaseAndWhitespace(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeLooseText(value: string): string {
  return normalizeCaseAndWhitespace(value).replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizeLastToken(value: string): string {
  const parts = normalizeCaseAndWhitespace(value).split(" ").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "";
}

export function tokenizeLooseText(value: string): string[] {
  return normalizeLooseText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

export function tokensLooselyMatch(a: string, b: string): boolean {
  return a === b || a.startsWith(b) || b.startsWith(a);
}

export function looseMessageIncludesValue(message: string, value: string): boolean {
  const normalizedMessage = normalizeLooseText(message);
  const normalizedValue = normalizeLooseText(value);
  if (!normalizedMessage || !normalizedValue) return false;
  return normalizedMessage.includes(normalizedValue);
}

export function normalizeDayToken(input: string): string | null {
  const value = input.toLowerCase().replace(/s$/, "");
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
  const dayRegex = /\b(mon(?:day)?s?|tue(?:s|sday)?s?|wed(?:nesday)?s?|thu(?:r|rs|rsday)?s?|fri(?:day)?s?|sat(?:urday)?s?|sun(?:day)?s?)\b/gi;
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
  if (/\bmorning\b|before\s+noon|before\s+12|before\s+11/.test(lower)) return "morning";
  if (/\bafternoon\b|after\s+noon|after\s+12/.test(lower)) return "afternoon";
  if (/\bevening\b|\bnight\b|after\s+5|after\s+6|after\s+7/.test(lower)) return "evening";
  return null;
}

export function normalizeCourseNumberConstraint(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function extractExplicitCourseCode(text: string): string | null {
  const dotted = text.match(/\b[A-Za-z]{2,4}\.\d{3}\.\d{3}\b/);
  if (dotted) return dotted[0];
  const compact = text.match(/\b[A-Za-z]{2,4}\d{6}\b/);
  if (compact) return compact[0];
  return null;
}

/** All dotted catalog codes typed in student text this turn (e.g. EN.601.226), uppercased, deduped. */
export function extractAllDottedCourseCodesFromMessage(message: string): string[] {
  const codes = [...message.matchAll(/\b[A-Za-z]{2,4}\.\d{3}\.\d{3}\b/g)].map((m) =>
    String(m[0]).toUpperCase(),
  );
  return [...new Set(codes)];
}

export function userExplicitlySpecifiedSchool(message: string): boolean {
  return (
    /(?:\bkrieger\b|\bksas\b|\bwhiting\b|\bwse\b)/i.test(message) ||
    /krieger school of arts and sciences/i.test(message) ||
    /whiting school of engineering/i.test(message)
  );
}

export function userExplicitlySpecifiedUndergradLevel(message: string): boolean {
  return /(?:lower level undergraduate|upper level undergraduate|\blower[- ]?level\b|\bupper[- ]?level\b)/i.test(
    message,
  );
}

export function userExplicitlyProvidedCourseNumber(message: string): boolean {
  return (
    /\b(?:[A-Z]{2}\.)?\d{3}\.\d{3}\b/i.test(message) ||
    /\b[A-Z]{2}\d{6}\b/i.test(message) ||
    /\b[A-Z]{2}\d{3}\b/i.test(message)
  );
}

export function userExplicitlySpecifiedTimeOfDay(message: string): boolean {
  return /\b(morning|afternoon|evening|night)\b|before\s+noon|after\s+noon|after\s+\d+/i.test(
    message,
  );
}

export function userExplicitlySpecifiedWritingIntensive(message: string): boolean {
  return /\bwriting[-\s]?intensive\b|\bnon[-\s]?writing[-\s]?intensive\b|\bwi\b/i.test(message);
}

export function userExplicitlySpecifiedDepartment(message: string, department: string): boolean {
  return looseMessageIncludesValue(message, department);
}
