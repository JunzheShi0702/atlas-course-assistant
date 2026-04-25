/**
 * REST endpoints for on-demand UI actions.
 *
 * These are thin HTTP wrappers over tool logic that the course card UI
 * calls directly (not via the agent), as specified in the iteration plan.
 *
 * GET /api/courses/:id/eval-summary  — Rachael's getCourseEvalSummary (R4)
 * GET /api/courses/:id/details       — Junzhe's fetchSisCourseDetails (R3)
 */

import { Router, Request, Response } from "express";
import { pool } from "../db";
import { getCourseEvalSummary } from "../tools/get-course-eval-summary";
import { fetchSisCourseDetails } from "../services/sis-client";
import {
  mapRawToSisCourse,
  searchCoursesBySisConstraints,
  type SisCourse,
} from "../tools/search-courses-by-sis-constraints";

const router = Router();

/** Dept + number with no school letters (e.g. `110.411`, `110.3`): SIS matches concatenated keys like `AS110411`, not `110.411`. */
function isNumericDeptCourseQuery(upper: string): boolean {
  return /^\d{3}\.\d{1,3}$/.test(upper);
}

async function searchDbCourseAutocomplete(
  normalized: string,
  limit: number,
): Promise<{ courses: SisCourse[] }> {
  const q = normalized.trim();
  if (!q) return { courses: [] };
  const pattern = `%${q}%`;
  const { rows } = await pool.query<{ code: string; title: string }>(
    `SELECT code, title
     FROM course_embeddings
     WHERE code ILIKE $1 OR sis_offering_name ILIKE $1 OR title ILIKE $1
     ORDER BY code
     LIMIT $2`,
    [pattern, Math.max(1, Math.min(200, limit * 4))],
  );
  const seen = new Set<string>();
  const courses: SisCourse[] = [];
  for (const row of rows) {
    const code = row.code.trim().toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    courses.push({
      offeringName: code,
      sectionName: "",
      title: row.title ?? "",
      description: "",
      schoolName: "",
      department: "",
      level: "",
      timeOfDay: "",
      daysOfWeek: "",
      location: "",
      instructors: [],
      status: "",
    });
    if (courses.length >= limit) break;
  }
  return { courses };
}

async function searchSisCourseAutocomplete(
  upper: string,
  normalized: string,
  limit: number,
): Promise<{ courses: SisCourse[]; error?: string }> {
  try {
    // Step 1: local DB lookup for already-seeded offerings/titles.
    const dbResult = await searchDbCourseAutocomplete(normalized, limit);
    if (dbResult.courses.length > 0) {
      return dbResult;
    }
  } catch (err) {
    console.warn("[courses autocomplete] DB lookup failed, falling back to SIS:", err);
  }

  // Step 2: SIS fallback when DB has no results.
  if (!looksLikeCourseNumberFragment(upper)) {
    return searchCoursesBySisConstraints({ CourseTitle: normalized }, limit);
  }
  if (isNumericDeptCourseQuery(upper)) {
    const nodot = upper.replace(/\./g, "");
    const seen = new Set<string>();
    const merged: SisCourse[] = [];
    for (const prefix of ["AS", "EN"] as const) {
      const part = await searchCoursesBySisConstraints({ CourseNumber: `${prefix}${nodot}` }, limit);
      for (const c of part.courses) {
        if (!seen.has(c.offeringName)) {
          seen.add(c.offeringName);
          merged.push(c);
        }
      }
    }
    return { courses: merged.slice(0, limit) };
  }
  return searchCoursesBySisConstraints({ CourseNumber: upper }, limit);
}

function looksLikeCourseNumberFragment(input: string): boolean {
  const upper = input.trim().toUpperCase();
  if (!upper) return false;

  // Full codes (existing behavior)
  if (
    /^[A-Z]{2}\.\d{3}\.\d{2,3}$/.test(upper) || // AS.110.41, AS.110.411
    /^[A-Z]{2}\d{5,6}$/.test(upper) || // AS11041, AS110411
    /^\d{3}\.\d{2,3}$/.test(upper) // 110.41, 110.411
  ) {
    return true;
  }

  // Prefix fragments (new): allow partial trailing digits so "AS.110.3" works.
  if (
    /^[A-Z]{2}\.\d{3}$/.test(upper) || // AS.110
    /^[A-Z]{2}\.\d{3}\.\d{1,3}$/.test(upper) || // AS.110.3, AS.110.31
    /^[A-Z]{2}\d{2,6}$/.test(upper) || // AS1103, AS11031
    /^\d{3}$/.test(upper) || // 110
    /^\d{3}\.\d{1,3}$/.test(upper) // 110.3, 110.31
  ) {
    return true;
  }

  return false;
}

// GET /api/courses/sis-search?query=...&limit=...
// Lightweight SIS-backed search for autocomplete: returns { courses: [{ code, title }] }.
router.get("/sis-search", async (req: Request, res: Response) => {
  const query = String(req.query.query ?? "").trim();
  const limitParam = Number(req.query.limit ?? 8);
  const limit = Number.isFinite(limitParam)
    ? Math.max(1, Math.min(50, Math.floor(limitParam)))
    : 8;

  if (!query) {
    res.status(400).json({ error: "query is required" });
    return;
  }

  try {
    const normalized = query.trim();
    const upper = normalized.toUpperCase();

    const result = await searchSisCourseAutocomplete(upper, normalized, limit);

    res.json({
      courses: result.courses.map((course) => ({
        code: course.offeringName, // e.g. "AS.110.411"
        title: course.title,
      })),
    });
  } catch (error) {
    console.error("Error searching SIS courses:", error);
    const message = error instanceof Error ? error.message : "Failed to search courses";
    res.status(500).json({
      error: "Failed to search courses",
      detail: message,
      courses: [],
    });
  }
});

// GET /api/courses/sis-search-raw?query=...&limit=...
// Direct SIS proxy: returns the full mapped SIS course objects from searchCoursesBySisConstraints.
router.get("/sis-search-raw", async (req: Request, res: Response) => {
  const query = String(req.query.query ?? "").trim();
  const limitParam = Number(req.query.limit ?? 20);
  const limit = Number.isFinite(limitParam)
    ? Math.max(1, Math.min(100, Math.floor(limitParam)))
    : 20;

  if (!query) {
    res.status(400).json({ error: "query is required" });
    return;
  }

  try {
    const normalized = query.trim();
    const upper = normalized.toUpperCase();
    const result = await searchSisCourseAutocomplete(upper, normalized, limit);
    res.json(result);
  } catch (error) {
    console.error("Error in sis-search-raw:", error);
    const message = error instanceof Error ? error.message : "Failed to search courses";
    res.status(500).json({
      error: "Failed to search courses",
      detail: message,
    });
  }
});

// GET /api/courses/:id/eval-summary
router.get("/:id/eval-summary", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await getCourseEvalSummary(id);
    res.json(result);
  } catch (err) {
    console.error("Eval summary error:", err);
    res.status(500).json({ error: "Failed to generate evaluation summary." });
  }
});

// GET /api/courses/:id/details
router.get("/:id/details", async (req: Request, res: Response) => {
  const courseId = req.params.id;

  try {
    const rawCourse = await fetchSisCourseDetails(courseId);

    if (rawCourse) {
      const course = mapRawToSisCourse(rawCourse);
      res.json({ courseId, details: course });
      return;
    }

    res.json({
      courseId,
      details: {
        offeringName: courseId.split("-").slice(0, 3).join(".").toUpperCase(),
        sectionName: "",
        title: "Course details unavailable",
        description: "SIS API data not available for this course",
        schoolName: "",
        department: "",
        level: "",
        timeOfDay: "",
        daysOfWeek: "",
        location: "",
        instructors: [],
        status: "",
      },
    });
  } catch (error) {
    console.error("Error fetching course details:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch course details";
    res.status(500).json({
      error: "Failed to fetch course details",
      detail: message,
      courseId,
      details: null,
    });
  }
});

export default router;
