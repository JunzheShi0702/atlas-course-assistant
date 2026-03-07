import { Router, Request, Response } from "express";
import { fetchSisCourseDetails } from "../services/sis-client";
import { mapRawToSisCourse } from "../tools/filter-sis-courses";

const router = Router();

// GET /api/courses/:id/details
router.get("/:id/details", async (req: Request, res: Response) => {
  const courseId = req.params.id;

  try {
    const rawCourse = await fetchSisCourseDetails(courseId);

    if (!rawCourse) {
      res.status(404).json({
        error: "Course not found",
        courseId,
        details: null,
      });
      return;
    }

    // Convert raw SIS course to our trimmed format
    const course = mapRawToSisCourse(rawCourse);

    res.json({
      courseId,
      details: course,
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

// GET /api/courses/:id/summary
router.get("/:id/summary", (req: Request, res: Response) => {
  res.json({
    message: "summary endpoint — not yet implemented",
    courseId: req.params.id,
    summary: null,
  });
});

// GET /api/courses/:id/metrics
router.get("/:id/metrics", (req: Request, res: Response) => {
  res.json({
    message: "metrics endpoint — not yet implemented",
    courseId: req.params.id,
    metrics: null,
  });
});

export default router;
