import { Router, Request, Response } from "express";

const router = Router();

// GET /api/courses/:id/details
router.get("/:id/details", (req: Request, res: Response) => {
  res.json({
    message: "SIS details endpoint — not yet implemented (see issue #39)",
    courseId: req.params.id,
    details: null,
  });
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
