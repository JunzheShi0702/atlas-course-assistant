export interface ScrapedMetrics {
  overall_quality: number | null;
  teaching_effectiveness: number | null;
  intellectual_challange: number | null;
  ta_quality: number | null;
  feedback_quality: number | null;
  work_load: number | null;
}

/** Parse catalog course code from full offering string (e.g. EN.550.310.11.SU15 -> EN.550.310). */
export function toCatalogCourseCode(fullCode: string): string {
  const match = fullCode.trim().match(/^([A-Z]{2}\.\d+\.\d+)/);
  return match ? match[1] : fullCode.trim();
}

/**
 * Parse section number from full offering string when present (e.g. EN.550.310.11.SU15 -> 11).
 * Returns null when there is no clear section segment.
 */
export function toSectionNumber(fullCode: string): string | null {
  const parts = fullCode.trim().split(".");
  return parts.length >= 5 ? parts[3]?.trim() || null : null;
}

/** Parse respondent count from text like "18 of 19 responded (94.74%)" -> 18 or null. */
export function parseNumRespondents(text: string): number | null {
  const match = text.match(/^(\d+)\s+of\s+\d+/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function parseFirstNonEmptyLine(text: string | null): string | null {
  if (!text) return null;
  return text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? null;
}

export function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function emptyMetrics(): ScrapedMetrics {
  return {
    overall_quality: null,
    teaching_effectiveness: null,
    intellectual_challange: null,
    ta_quality: null,
    feedback_quality: null,
    work_load: null,
  };
}

export function getMetricCount(metrics: ScrapedMetrics): number {
  return Object.values(metrics).filter((v) => v !== null).length;
}
