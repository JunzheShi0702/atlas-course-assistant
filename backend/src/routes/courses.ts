/**
 * REST endpoints for on-demand UI actions.
 *
 * These are thin HTTP wrappers over tool logic that the course card UI
 * calls directly (not via the agent), as specified in the iteration plan.
 *
 * GET /api/courses/:id/eval-summary  — Rachael's getCourseEvalSummary (R4)
 * GET /api/courses/:id/details       — Sis details lookup via getSisCourseDetails (R3)
 */

import { Router, Request, Response } from "express";
import { getCourseEvalSummary } from "../tools/get-course-eval-summary";
import { getSisCourseDetails } from "../services/get-sis-course-details";
import {
  searchCoursesBySisConstraints,
  type SisCourse,
} from "../tools/search-courses-by-sis-constraints";

const router = Router();

/** Dept + number with no school letters (e.g. `110.411`, `110.3`): SIS matches concatenated keys like `AS110411`, not `110.411`. */
function isNumericDeptCourseQuery(upper: string): boolean {
  return /^\d{3}\.\d{1,3}$/.test(upper);
}

async function searchSisCourseAutocomplete(
  upper: string,
  normalized: string,
  limit: number,
): Promise<{ courses: SisCourse[]; error?: string }> {
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

function deriveFallbackOfferingName(courseId: string): string {
  const dotted = courseId.match(/^([A-Za-z]{2})\.(\d{3})\.(\d{3})/);
  if (dotted) {
    return `${dotted[1].toUpperCase()}.${dotted[2]}.${dotted[3]}`;
  }

  const slug = courseId.match(/^([A-Za-z]{2})-(\d{3})-(\d{3})/);
  if (slug) {
    return `${slug[1].toUpperCase()}.${slug[2]}.${slug[3]}`;
  }

  const coarse = courseId.split("-").slice(0, 3).join(".").toUpperCase();
  return coarse || "UNKNOWN.COURSE";
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
    const result = await getSisCourseDetails(courseId);

    if (result.course) {
      res.json({ courseId, details: result.course });
      return;
    }

    res.json({
      courseId,
      details: {
        offeringName: deriveFallbackOfferingName(courseId),
        sectionName: "",
        title: "Course details unavailable",
        description: result.message ?? "SIS API data not available for this course",
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
