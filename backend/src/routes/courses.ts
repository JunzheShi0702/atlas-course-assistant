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

const router = Router();

// GET /api/courses/:id/eval-summary
// Rachael: implement getCourseEvalSummary tool and wire it here (issue #52 / R4)
router.get("/:id/eval-summary", (req: Request, res: Response) => {
  res.json({
    courseId: req.params.id,
    summaryText: null,
    hasData: false,
    message: "eval-summary not yet implemented",
  });
});

// GET /api/courses/:id/details
// Junzhe: implement fetchSisCourseDetails tool and wire it here (R3)
router.get("/:id/details", (req: Request, res: Response) => {
  res.json({
    courseId: req.params.id,
    course: null,
    message: "course details not yet implemented",
  });
});

export default router;
