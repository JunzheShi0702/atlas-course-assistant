import { pool } from "../pool";
import type { RawSisCourse } from "../types/sis";
import { extractPrerequisitesText } from "./sis-prerequisites";

export function getSisDetailsCacheTtlMs(): number {
  const raw = process.env.SIS_DETAILS_CACHE_TTL_MS;
  if (raw !== undefined && raw !== "") {
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n) && n > 0) {
      return n;
    }
  }
  return 7 * 24 * 60 * 60 * 1000;
}

export function sectionKeyFromOptional(sectionName?: string): string {
  return sectionName ?? "";
}

/**
 * Returns cached SIS course row when present and younger than TTL; otherwise undefined.
 */
export async function getCachedSisCourseDetail(
  offeringName: string,
  term: string,
  sectionKey: string,
): Promise<RawSisCourse | undefined> {
  const ttlMs = getSisDetailsCacheTtlMs();
  const res = await pool.query<{ payload: RawSisCourse; fetched_at: Date }>(
    `SELECT payload, fetched_at FROM sis_course_details_cache
     WHERE sis_offering_name = $1 AND term = $2 AND section_name = $3`,
    [offeringName, term, sectionKey],
  );
  const row = res.rows[0];
  if (!row) {
    console.log(
      `[SIS details cache] miss (absent) offering=${offeringName} term=${term} section=${sectionKey || "(none)"}`,
    );
    return undefined;
  }
  const age = Date.now() - new Date(row.fetched_at).getTime();
  if (age >= ttlMs) {
    console.log(
      `[SIS details cache] miss (stale) offering=${offeringName} term=${term} section=${sectionKey || "(none)"}`,
    );
    return undefined;
  }
  console.log(
    `[SIS details cache] hit offering=${offeringName} term=${term} section=${sectionKey || "(none)"}`,
  );
  return row.payload;
}

export async function upsertSisCourseDetailCache(
  offeringName: string,
  term: string,
  sectionKey: string,
  payload: RawSisCourse,
): Promise<void> {
  const prerequisites = extractPrerequisitesText(payload) ?? null;

  try {
    await pool.query(
      `INSERT INTO sis_course_details_cache
         (sis_offering_name, term, section_name, payload, prerequisites, fetched_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, NOW(), NOW())
       ON CONFLICT (sis_offering_name, term, section_name)
       DO UPDATE SET
         payload = EXCLUDED.payload,
         prerequisites = EXCLUDED.prerequisites,
         fetched_at = NOW(),
         updated_at = NOW()`,
      [offeringName, term, sectionKey, JSON.stringify(payload), prerequisites],
    );
  } catch (error) {
    const pgCode =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";

    // Backward-compatible fallback for environments where migration adding
    // `prerequisites` has not yet been applied.
    if (pgCode === "42703") {
      await pool.query(
        `INSERT INTO sis_course_details_cache
           (sis_offering_name, term, section_name, payload, fetched_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())
         ON CONFLICT (sis_offering_name, term, section_name)
         DO UPDATE SET
           payload = EXCLUDED.payload,
           fetched_at = NOW(),
           updated_at = NOW()`,
        [offeringName, term, sectionKey, JSON.stringify(payload)],
      );
      return;
    }

    throw error;
  }
}
