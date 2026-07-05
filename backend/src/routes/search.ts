import { Router, Request, Response } from "express";
import { searchCourseDescriptions } from "../tools/search-course-descriptions";

const router = Router();

// GET /api/search?query=...&limit=...
router.get("/", async (req: Request, res: Response) => {
  const query = req.query.query as string | undefined;
  const limitParam = req.query.limit;
  const limit = limitParam ? Number(limitParam) : undefined;

  if (!query || typeof query !== "string") {
    res.status(400).json({ error: "query is required" });
    return;
  }

  try {
    const output = await searchCourseDescriptions({ query, limit: limit ?? 10 });
    res.json(output);
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Search failed. Please try again." });
  }
});

export default router;
