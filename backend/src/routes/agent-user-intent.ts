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

/**
 * True when the student is tying workload/eval-style difficulty questions to THIS opened schedule,
 * versus asking metrics for arbitrary courses while schedule chat UI is mounted.
 */
export function isWorkloadOrMetricsQuestionAboutThisSchedule(message: string): boolean {
  const scheduleFocus =
    /\b(this|my|the)\s+(current\s+)?schedule\b/i.test(message) ||
    /\b(on|with|for|from)\s+(this|my)\s+(schedule|plan)\b/i.test(message) ||
    /\bon\s+(this|that|my)\s+schedule\b/i.test(message) ||
    /\b(classes|courses)\s+(above|below|listed|shown|here|on\s+(this|my)\s+schedule)\b/i.test(message) ||
    /\brest\s+(?:on\s+)?(this|my)\s+schedule\b|\brest\s+of\s+(?:the\s+)?(this|my)\s+schedule\b/i.test(message) ||
    /\bcompared\s+to\s+.+\s+(on\s+)?(this\s+schedule|my\s+schedule)\b/i.test(message);

  const workloadOrEvalAdj =
    isNumericCourseMetricsIntent(message) ||
    /\b(workload|course\s+load|credits?|overload|manageable|rigorous|balancing|overall\s+demand|doable|too\s+much|\bgrind\b|\bstress\b|\bheavy\b|\bbusy\b(?:\s+schedule)?|balanced|reasonable\b)/i.test(
      message,
    ) ||
    /\bhow\s+(?:heavy|hard|busy|rigorous|demanding)/i.test(message) ||
    /\b(?:heavy|busy|busywork)\s+/i.test(message);

  return scheduleFocus && workloadOrEvalAdj;
}
