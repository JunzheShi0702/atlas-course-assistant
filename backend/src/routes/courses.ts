import { Router, Request, Response } from "express";
import { searchCourseDescriptions } from "../tools/search-course-descriptions";

const router = Router();

// POST /api/search  (mounted at /api/search, so path here is "/")
router.post("/", async (req: Request, res: Response) => {
  const { query, limit } = req.body as { query?: string; limit?: number };

  if (!query || typeof query !== "string") {
    res.status(400).json({ error: "query is required" });
    return;
  }

  try {
    const output = await searchCourseDescriptions({ query, limit: limit ?? 5 });
    res.json(output);
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Search failed. Please try again." });
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
