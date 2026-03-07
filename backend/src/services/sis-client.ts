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
