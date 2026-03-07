import { Router, Request, Response } from "express";
import { fetchSisCourseDetails } from "../services/sis-client";
import { mapRawToSisCourse } from "../tools/filter-sis-courses";

const router = Router();

// GET /api/courses/:id/details
router.get("/:id/details", async (req: Request, res: Response) => {
  const courseId = req.params.id;

  try {
    // First try to fetch from SIS API
    const rawCourse = await fetchSisCourseDetails(courseId);

    if (rawCourse) {
      // Convert raw SIS course to our trimmed format
      const course = mapRawToSisCourse(rawCourse);

      res.json({
        courseId,
        details: course,
      });
      return;
    }

    // If SIS returns nothing, return  placeholder with basic info from courseId parse
    // This allows the frontend to still show something
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
