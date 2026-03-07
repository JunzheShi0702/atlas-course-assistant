import { Router, Request, Response } from "express";
import { searchCourseDescriptions } from "../tools/search-course-descriptions";

const router = Router();

// POST /api/search
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

export default router;
