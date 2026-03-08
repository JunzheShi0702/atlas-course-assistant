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
import { getCourseEvalSummary } from "../tools/get-course-eval-summary";
import { fetchSisCourseDetails } from "../services/sis-client";
import { mapRawToSisCourse } from "../tools/filter-sis-courses";

const router = Router();

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
