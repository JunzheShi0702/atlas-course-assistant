import { Router, Request, Response } from "express";
import {
  PROGRAM_LIST,
  SCHOOL_NA,
  KRIEGER_SCHOOL_LABEL,
  WHITING_SCHOOL_LABEL,
} from "../data/program-list";

const router = Router();

/** Public catalog for onboarding program pickers (no auth). */
router.get("/program-list", (_req: Request, res: Response) => {
  res.json({
    schoolNa: SCHOOL_NA,
    kriegerSchoolLabel: KRIEGER_SCHOOL_LABEL,
    whitingSchoolLabel: WHITING_SCHOOL_LABEL,
    programs: PROGRAM_LIST,
  });
});

export default router;
