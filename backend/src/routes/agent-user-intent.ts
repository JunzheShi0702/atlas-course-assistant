/**
 * User-message heuristics shared by agent response normalization and tool execute paths.
 */

export function userExplicitlyRequestedDepartmentCourseSearch(message: string): boolean {
  const mentionsCourseBucket = /\b(course|courses|class|classes|department|dept)\b/i.test(message);
  const mentionsKnownDepartment =
    /\b(cs|computer science|ece|electrical and computer engineering|math|mathematics|bio|biology)\b/i.test(message);
  return mentionsCourseBucket && mentionsKnownDepartment;
}

export function userExplicitlyRequestedGraduateScope(message: string): boolean {
  return (
    /\bgraduate(?:-level)?\b/i.test(message) ||
    /\bgrad\b/i.test(message) ||
    /\bphd\b/i.test(message) ||
    /\bmaster'?s\b/i.test(message) ||
    /\bpostgraduate\b/i.test(message) ||
    /\b(?:600|700|800)[-\s]?level\b/i.test(message) ||
    /bloomberg school of public health graduate courses/i.test(message)
  );
}

export function isNumericCourseMetricsIntent(message: string): boolean {
  return /\b(hard|difficulty|difficult|workload|overall quality|quality|respondent|evaluation metrics?)\b/i.test(
    message,
  );
}
