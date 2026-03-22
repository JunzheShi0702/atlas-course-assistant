/**
 * Seed script — Issue #33
 *
 * Fetches Spring 2026 courses from the JHU SIS API, generates
 * text-embedding-3-small embeddings for each course, and upserts
 * them into the course_embeddings table.
 *
 * Usage:
 *   npm run seed
 *
 * Requires in backend/.env:
 *   DATABASE_URL, OPENAI_API_KEY, JHU_SIS_API_KEY
 *
 */

import dotenv from "dotenv";
dotenv.config();

import { pool } from "../db";
import { generateEmbeddingsBatch } from "../services/embeddings";
import { fetchSisClasses } from "../services/sis-client";
import { RawSisCourse, isUndergraduateCourse } from "../types/sis";

const TERM = "Spring 2026";
const EMBED_BATCH_SIZE = 100;
const DESC_CONCURRENCY = 10; // concurrent SIS description requests

const SCHOOLS = [
  "Krieger School of Arts and Sciences",
  "Whiting School of Engineering",
];

/** Convert SIS OfferingName + term into a stable course_id slug.
 *  e.g. "EN.553.171.01" + "Spring 2026" → "en-553-171-01-spring-2026"
 */
function toCourseId(offeringName: string, term: string): string {
  const offeringSlug = offeringName.replace(/\./g, "-").toLowerCase();
  const termSlug = term.replace(/\s+/g, "-").toLowerCase();
  return `${offeringSlug}-${termSlug}`;
}

/** Extract the base course code (without section), e.g. "EN.553.171" */
function toCourseCode(offeringName: string): string {
  const parts = offeringName.split(".");
  return parts.slice(0, 3).join(".");
}

/**
 * Fetch the description for a single course section from the SIS detail endpoint.
 * The bulk /classes/{school}/{term} endpoint does not include SectionDetails,
 * so we must call /classes/{courseNumber}/{term} individually.
 *
 * The bulk fetch returns OfferingName ("EN.500.112") and SectionName ("01") separately.
 * Concatenating them gives "EN.500.11201", then removing dots gives "EN50011201",
 * which is the format the SIS detail endpoint accepts and returns SectionDetails for.
 */
async function fetchCourseDescription(
  offeringName: string,
  sectionName: string,
  term: string,
): Promise<string> {
  const apiKey = process.env.JHU_SIS_API_KEY;
  // e.g. "EN.500.112" + "01" → "EN.500.11201" → "EN50011201"
  const courseNumber = (offeringName + sectionName).replace(/\./g, "");
  const url = `https://sis.jhu.edu/api/classes/${courseNumber}/${encodeURIComponent(term)}?key=${apiKey}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
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

/**
 * Fetch descriptions for all offerings in controlled batches to avoid
 * overwhelming the SIS API.
 */
async function fetchAllDescriptions(
  courses: Array<{ offeringName: string; sectionName: string }>,
  term: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const total = courses.length;

  for (let i = 0; i < total; i += DESC_CONCURRENCY) {
    const batch = courses.slice(i, i + DESC_CONCURRENCY);
    const results = await Promise.all(
      batch.map((c) => fetchCourseDescription(c.offeringName, c.sectionName, term)),
    );
    batch.forEach((c, j) => map.set(c.offeringName, results[j]));

    const done = Math.min(i + DESC_CONCURRENCY, total);
    process.stdout.write(`\r    Fetched descriptions: ${done}/${total}`);
  }

  process.stdout.write("\n");
  return map;
}

async function seed() {
  console.log(`Starting seed for ${TERM}…`);

  const allCourses: RawSisCourse[] = [];

  for (const school of SCHOOLS) {
    console.log(`  Fetching ${school}…`);
    try {
      const courses = await fetchSisClasses({ Term: TERM, School: school });
      console.log(`    → ${courses.length} sections`);
      allCourses.push(...courses);
    } catch (err) {
      console.error(`    ✗ Failed to fetch ${school}:`, (err as Error).message);
      console.error("    Make sure JHU_SIS_API_KEY is set.");
    }
  }

  // Filter to undergraduate-only offerings before deduplication
  const undergradOnly = allCourses.filter(isUndergraduateCourse);
  const filteredOut = allCourses.length - undergradOnly.length;
  console.log(`\nFiltered out ${filteredOut} non-undergraduate sections (graduate, independent study, etc.)`);

  // Deduplicate by OfferingName
  const seen = new Set<string>();
  const unique = undergradOnly.filter((c) => {
    if (seen.has(c.OfferingName)) return false;
    seen.add(c.OfferingName);
    return true;
  });

  console.log(`Unique undergraduate offerings to embed: ${unique.length}`);

  if (unique.length === 0) {
    console.warn("No courses fetched. Check JHU_SIS_API_KEY.");
    await pool.end();
    return;
  }

  // Fetch course descriptions from individual SIS detail endpoints
  console.log(`\nFetching course descriptions (${unique.length} requests, ~${Math.ceil(unique.length / DESC_CONCURRENCY / 2)} sec)…`);
  const descriptions = await fetchAllDescriptions(
    unique.map((c) => ({
      offeringName: c.OfferingName,
      sectionName: String(c.SectionName ?? ""),
    })),
    TERM,
  );

  const withDesc = [...descriptions.values()].filter(Boolean).length;
  console.log(`  ${withDesc}/${unique.length} courses have descriptions`);

  // Generate embeddings and upsert in batches
  let upserted = 0;
  for (let i = 0; i < unique.length; i += EMBED_BATCH_SIZE) {
    const batch = unique.slice(i, i + EMBED_BATCH_SIZE);

    // Embed title + description together for richer semantic search
    const texts = batch.map((c) => {
      const desc = descriptions.get(c.OfferingName) ?? "";
      return desc ? `${c.Title}. ${desc}` : (c.Title ?? "");
    });

    console.log(
      `  Embedding batch ${Math.floor(i / EMBED_BATCH_SIZE) + 1}/${Math.ceil(unique.length / EMBED_BATCH_SIZE)}…`,
    );
    const embeddings = await generateEmbeddingsBatch(texts);

    for (let j = 0; j < batch.length; j++) {
      const c = batch[j];
      const description = descriptions.get(c.OfferingName) ?? "";

      await pool.query(
        `INSERT INTO course_embeddings
           (course_id, code, sis_offering_name, term, title, short_description, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
         ON CONFLICT (course_id) DO UPDATE SET
           title = EXCLUDED.title,
           short_description = EXCLUDED.short_description,
           embedding = EXCLUDED.embedding`,
        [
          toCourseId(c.OfferingName, TERM),
          toCourseCode(c.OfferingName),
          c.OfferingName,
          TERM,
          c.Title ?? "",
          description,
          JSON.stringify(embeddings[j]),
        ],
      );
      upserted++;
    }

    console.log(`    → ${upserted} upserted so far`);
  }

  console.log(`\nDone. ${upserted} course embeddings upserted.`);
  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
