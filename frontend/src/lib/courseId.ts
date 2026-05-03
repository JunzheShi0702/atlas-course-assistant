type CourseIdLike = {
  courseId?: string | null;
  sisOfferingName?: string | null;
  term?: string | null;
};

export function courseIdFromOfferingAndTerm(
  sisOfferingName?: string | null,
  term?: string | null,
): string | null {
  const offering = sisOfferingName?.trim();
  const termValue = term?.trim();
  if (!offering || !termValue) return null;

  const offeringSlug = offering.replace(/\./g, "-").toLowerCase();
  const termSlug = termValue.toLowerCase().replace(/\s+/g, "-");
  return `${offeringSlug}-${termSlug}`;
}

export function resolveCourseId(input: CourseIdLike): string | null {
  const direct = input.courseId?.trim();
  if (direct) return direct;
  return courseIdFromOfferingAndTerm(input.sisOfferingName, input.term);
}
