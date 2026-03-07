import { RawSisCourse } from "../types/sis";

const SIS_BASE_URL = "https://sis.jhu.edu/api/classes";
const TIMEOUT_MS = 10_000;

/**
 * Fetch classes from the JHU SIS API.
 * @param params - Query parameters to forward (excluding the API key).
 * @returns Raw SIS course array.
 */
export async function fetchSisClasses(
  params: Record<string, string>,
): Promise<RawSisCourse[]> {
  const apiKey = process.env.JHU_SIS_API_KEY;
  if (!apiKey) {
    throw new Error("JHU_SIS_API_KEY is not set. Add it to your .env file.");
  }

  const url = new URL(SIS_BASE_URL);
  url.searchParams.set("key", apiKey);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  url.searchParams.append("School", "Krieger School of Arts and Sciences");
  url.searchParams.append("School", "Whiting School of Engineering");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `SIS API responded with status ${response.status}: ${response.statusText}`,
      );
    }

    return (await response.json()) as RawSisCourse[];
  } finally {
    clearTimeout(timeout);
  }
}

const DETAIL_TIMEOUT_MS = 6_000;

/**
 * Fetch course description from the SIS class detail endpoint.
 * The list endpoint does not include SectionDetails/Description.
 * @param offeringName - e.g. "EN.601.226"
 * @param sectionName - e.g. "01"
 * @param term - e.g. "Spring 2026"
 */
export async function fetchSisCourseDescription(
  offeringName: string,
  sectionName: string,
  term: string,
): Promise<string> {
  const apiKey = process.env.JHU_SIS_API_KEY;
  if (!apiKey) return "";

  const courseNumber = (offeringName + sectionName).replace(/\./g, "");
  const url = `https://sis.jhu.edu/api/classes/${courseNumber}/${encodeURIComponent(term)}?key=${apiKey}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DETAIL_TIMEOUT_MS);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return "";

    const data = (await response.json()) as Array<{
      SectionDetails?: { Description?: string }[];
    }>;
    return data[0]?.SectionDetails?.[0]?.Description?.trim() ?? "";
  } catch {
    return "";
  }
}
