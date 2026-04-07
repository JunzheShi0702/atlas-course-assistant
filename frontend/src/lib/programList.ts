/**
 * Types + helpers for GET /api/program-list.
 * The canonical catalog lives on the server; the UI fetches it at runtime.
 */

export interface ProgramListEntry {
  name: string;
  hasMajor: boolean;
  hasMinor: boolean;
  isWhiting?: boolean;
}

export interface ProgramListResponse {
  schoolNa: string;
  kriegerSchoolLabel: string;
  whitingSchoolLabel: string;
  programs: ProgramListEntry[];
}

/** Convenience labels matching the API (for tests and display). */
export const KRIEGER_SCHOOL_LABEL = "Krieger School of Arts & Sciences";
export const WHITING_SCHOOL_LABEL = "Whiting School of Engineering";
export const SCHOOL_NA = "N/A";

export function getSchoolLabelForPrimaryMajor(
  programName: string | null | undefined,
  catalog: ProgramListResponse,
): string {
  if (!programName?.trim()) return catalog.schoolNa;
  const entry = catalog.programs.find((p) => p.name === programName);
  if (!entry) return catalog.schoolNa;
  return entry.isWhiting === true ? catalog.whitingSchoolLabel : catalog.kriegerSchoolLabel;
}
