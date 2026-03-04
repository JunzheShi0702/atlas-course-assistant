/**
 * Seed script — Issue #33
 *
 * Fetches Spring 2026 courses from the JHU SIS API, generates
 * text-embedding-3-small embeddings for each course, and upserts
 * them into the course_embeddings table.
 *
 * Usage:
 *   npx ts-node src/scripts/seed-embeddings.ts
 *   npm run seed
 *
 * Requires in backend/.env:
 *   DATABASE_URL, OPENAI_API_KEY, JHU_SIS_API_KEY
 */

import dotenv from "dotenv";
dotenv.config();

import { pool } from "../db";
import { generateEmbeddingsBatch } from "../services/embeddings";
import { fetchSisClasses } from "../services/sis-client";
import { RawSisCourse } from "../types/sis";

const TERM = "Spring 2026";
const BATCH_SIZE = 100; // embeddings API batch size

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

/** Build the text used for embedding: title + description */
function toEmbeddingText(course: RawSisCourse): string {
  const parts: string[] = [course.Title ?? ""];
  const details = (course as Record<string, unknown>)["SectionDetails"] as
    | { Description?: string }[]
    | undefined;
  const desc = details?.[0]?.Description?.trim();
  if (desc) parts.push(desc);
  return parts.filter(Boolean).join(". ");
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
      console.error(
        "    If you see a 403, the SIS API may be behind Cloudflare protection (issue #56).",
      );
    }
  }

  // Deduplicate by OfferingName (each section appears once)
  const seen = new Set<string>();
  const unique = allCourses.filter((c) => {
    if (seen.has(c.OfferingName)) return false;
    seen.add(c.OfferingName);
    return true;
  });

  console.log(`\nUnique offerings to embed: ${unique.length}`);

  if (unique.length === 0) {
    console.warn(
      "No courses fetched. Check JHU_SIS_API_KEY and network access to sis.jhu.edu.",
    );
    await pool.end();
    return;
  }

  // Process in batches
  let upserted = 0;
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const texts = batch.map(toEmbeddingText);

    console.log(
      `  Embedding batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(unique.length / BATCH_SIZE)}…`,
    );
    const embeddings = await generateEmbeddingsBatch(texts);

    // Upsert into DB
    for (let j = 0; j < batch.length; j++) {
      const c = batch[j];
      const details = (c as Record<string, unknown>)["SectionDetails"] as
        | { Description?: string }[]
        | undefined;
      const shortDescription = details?.[0]?.Description?.trim() ?? "";

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
          shortDescription,
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
