import type { ProgramListResponse } from "@/lib/programList";
import {
  KRIEGER_SCHOOL_LABEL,
  WHITING_SCHOOL_LABEL,
  SCHOOL_NA,
} from "@/lib/programList";

/** Minimal catalog for component tests (CS + Mathematics). */
export const testProgramListResponse: ProgramListResponse = {
  schoolNa: SCHOOL_NA,
  kriegerSchoolLabel: KRIEGER_SCHOOL_LABEL,
  whitingSchoolLabel: WHITING_SCHOOL_LABEL,
  programs: [
    { name: "Computer Science", hasMajor: true, hasMinor: true, isWhiting: true },
    { name: "Mathematics", hasMajor: true, hasMinor: true },
  ],
};
