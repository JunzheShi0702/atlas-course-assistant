export function offeringNameToCourseId(offeringName: string, term: string): string {
  const slug = offeringName.replace(/\./g, "-").toLowerCase();
  const termSlug = term.toLowerCase().replace(/\s+/g, "-");
  return `${slug}-${termSlug}`;
}
