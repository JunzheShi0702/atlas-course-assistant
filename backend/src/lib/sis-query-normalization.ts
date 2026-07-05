import { normalizeCourseNumberConstraint } from "./search-text";

/** Normalizes CourseNumber into SIS advanced-search format. */
export function normalizeSisCourseNumber(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const dottedPrefix = trimmed.match(/^([A-Z]{2})\.(\d{3})$/i);
  if (dottedPrefix) return `${dottedPrefix[1].toUpperCase()}${dottedPrefix[2]}`;
  if (/^[A-Z]{2}\.\d{3}\.\d{3}/i.test(trimmed)) return normalizeCourseNumberConstraint(trimmed);
  if (/^\d{3}$/.test(trimmed)) return `EN${trimmed}`;
  return trimmed;
}

/** SIS instructor matching is most reliable with last name only. */
export function normalizeSisInstructor(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.includes(" ") ? trimmed.split(/\s+/).pop() ?? "" : trimmed;
}
