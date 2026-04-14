import { RawSisCourse } from "../types/sis";
import {
  getCachedSisCourseDetail,
  sectionKeyFromOptional,
  upsertSisCourseDetailCache,
} from "./sis-course-details-cache";

const SIS_BASE_URL = "https://sis.jhu.edu/api/classes";
const TIMEOUT_MS = 10_000;

/**
 * Parse a courseId into its SIS components.
 * CourseId format: "en-553-171-spring-2026" or "en-553-171-01-spring-2026"
 * Returns: { offeringName: "EN553171", term: "Spring 2026", sectionName?: "01" }
 * Note: SIS API expects course numbers without dots (EN553171 not EN.553.171)
 */
export function parseCourseId(courseId: string): {
  offeringName: string;
  term: string;
  sectionName?: string;
} {
  const match = courseId
    .trim()
    .match(
      /^([a-z]{2})-(\d{3})-(\d{3})(?:-(\d+))?-([a-z]+(?:-[a-z]+)*)-(\d{4})$/i,
    );

  if (!match) {
    throw new Error(
      `Invalid courseId format: ${courseId}. Expected en-553-171-spring-2026 or en-553-171-01-spring-2026.`,
    );
  }

  const [, schoolPrefix, departmentNumber, courseNumber, sectionName, termSlug, year] = match;
  const offeringName = `${schoolPrefix.toUpperCase()}${departmentNumber}${courseNumber}`;
  const term =
    `${termSlug
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ")} ${year}`;

  return { offeringName, term, sectionName };
}

/**
 * Fetch classes from the JHU SIS API.
 * @param params - Query parameters to forward (excluding the API key).
 * @returns Raw SIS course array.
 */
export async function fetchSisClasses(
  params: Record<string, string | string[]>,
): Promise<RawSisCourse[]> {
  const apiKey = process.env.JHU_SIS_API_KEY;
  if (!apiKey) {
    throw new Error("JHU_SIS_API_KEY is not set. Add it to your .env file.");
  }

  const url = new URL(SIS_BASE_URL);
  url.searchParams.set("key", apiKey);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, item);
      }
      continue;
    }
    url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      const urlForLog = url.toString().replace(/key=[^&]+/, "key=***");
      console.error(
        `[SIS API] ${response.status} ${response.statusText} | ${urlForLog} | body: ${body.slice(0, 300)}`,
      );
      throw new Error(
        `SIS API responded with status ${response.status}: ${response.statusText}`,
      );
    }

    return (await response.json()) as RawSisCourse[];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch full SIS course details from the API only (no DB cache).
 * CourseId format: "en-553-171-spring-2026" or "en-553-171-01-spring-2026"
 */
export async function fetchSisCourseDetailsFromApi(
  courseId: string,
): Promise<RawSisCourse | null> {
  const { offeringName, term, sectionName } = parseCourseId(courseId);

  const params: Record<string, string> = {
    Term: term,
    CourseNumber: offeringName,
  };

  if (sectionName) {
    params.Section = sectionName;
  }

  console.log(
    `[fetchSisCourseDetails] SIS request courseId=${courseId}, params=`,
    params,
  );
  const courses = await fetchSisClasses(params);
  console.log(`[fetchSisCourseDetails] Got ${courses.length} results`);

  if (courses.length === 0) {
    return null;
  }

  if (sectionName) {
    const match = courses.find((c) => c.SectionName === sectionName);
    return match ?? courses[0];
  }

  return courses[0];
}

/**
 * Course details for a courseId: Postgres TTL cache (weekly by default), then SIS.
 * CourseId format: "en-553-171-spring-2026" or "en-553-171-01-spring-2026"
 */
export async function fetchSisCourseDetails(
  courseId: string,
): Promise<RawSisCourse | null> {
  const { offeringName, term, sectionName } = parseCourseId(courseId);
  const sectionKey = sectionKeyFromOptional(sectionName);

  try {
    const cached = await getCachedSisCourseDetail(
      offeringName,
      term,
      sectionKey,
    );
    if (cached !== undefined) {
      return cached;
    }
  } catch (err) {
    console.warn("[SIS details cache] read failed, falling back to SIS:", err);
  }

  const course = await fetchSisCourseDetailsFromApi(courseId);

  if (course) {
    try {
      await upsertSisCourseDetailCache(
        offeringName,
        term,
        sectionKey,
        course,
      );
    } catch (err) {
      console.warn("[SIS details cache] write failed:", err);
    }
  }

  return course;
}
