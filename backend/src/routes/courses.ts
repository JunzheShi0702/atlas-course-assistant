import { Router, Request, Response } from "express";
import { getCourseEvalSummary } from "../tools/get-course-eval-summary";

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

export default router;
