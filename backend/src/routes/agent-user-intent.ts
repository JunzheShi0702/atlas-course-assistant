/**
 * User-message heuristics shared by agent response normalization and tool execute paths.
 */

export function userExplicitlyRequestedDepartmentCourseSearch(message: string): boolean {
  const mentionsCourseBucket = /\b(course|courses|class|classes|department|dept)\b/i.test(message);
  const mentionsKnownDepartment =
    /\b(cs|computer science|ece|electrical and computer engineering|math|mathematics|bio|biology)\b/i.test(message);
  return mentionsCourseBucket && mentionsKnownDepartment;
}

const UNDERGRAD_PLANNING_SIGNAL =
  /\b(?:undergrad|undergraduate|upper[- ]level|lower[- ]level|electives?|bachelor|major|minor|prereq|catalog|distribution|requirements?|underclass|freshman|sophomore|junior|senior)\b/i;

/** User is asking about undergrad choices with future grad education as a goal, not for grad-level catalog rows. */
function isUndergradPlanningWithFutureGradEducationMention(message: string): boolean {
  if (!/\b(?:grad|graduate)\s+school\b|\bgraduate\s+program\b/i.test(message)) {
    return false;
  }
  return UNDERGRAD_PLANNING_SIGNAL.test(message);
}

/** Explicit ask for offerings tagged to the graduate school (still out of undergrad tool scope). */
function asksGradSchoolCatalogOfferings(message: string): boolean {
  return /\b(?:grad|graduate)\s+school\s+(?:courses?|classes?|offerings?)\b/i.test(message);
}

/**
 * True when the user is asking for graduate-level / graduate-catalog scope (blocked from ugrad tools).
 * Avoid treating "grad school" / "graduate school" as graduate scope — that's usually career intent on undergrad paths.
 */
export function userExplicitlyRequestedGraduateScope(message: string): boolean {
  if (isUndergradPlanningWithFutureGradEducationMention(message)) {
    return false;
  }
  if (asksGradSchoolCatalogOfferings(message)) {
    return true;
  }
  return (
    /\bgraduate(?:-level)?\b(?!\s+school)/i.test(message) ||
    /\bgrad\b(?!\s+school)/i.test(message) ||
    /\bphd[- ]level\b/i.test(message) ||
    /\bphd\s+courses?\b/i.test(message) ||
    /\bphd\s+classes?\b/i.test(message) ||
    /\bmaster'?s[- ]level\b/i.test(message) ||
    /\bmaster'?s\s+courses?\b/i.test(message) ||
    /\bmaster'?s\s+classes?\b/i.test(message) ||
    /\bpostgraduate\s+courses?\b/i.test(message) ||
    /\bpostgraduate\s+level\b/i.test(message) ||
    /\b(?:600|700|800)[-\s]?level\b/i.test(message) ||
    /bloomberg school of public health graduate courses/i.test(message)
  );
}

export function isNumericCourseMetricsIntent(message: string): boolean {
  return /\b(hard|difficulty|difficult|workload|overall quality|quality|respondent|evaluation metrics?)\b/i.test(
    message,
  );
}
