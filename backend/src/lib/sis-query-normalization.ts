import { normalizeCourseNumberConstraint } from "./search-text";

/** Normalizes CourseNumber into SIS advanced-search format. */
export function normalizeSisCourseNumber(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/^[A-Z]{2}\.\d/i.test(trimmed)) return normalizeCourseNumberConstraint(trimmed);
  if (/^\d{3}$/.test(trimmed)) return `EN${trimmed}`;
  return trimmed;
}

/** SIS instructor matching is most reliable with last name only. */
export function normalizeSisInstructor(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.includes(" ") ? trimmed.split(/\s+/).pop() ?? "" : trimmed;
}
