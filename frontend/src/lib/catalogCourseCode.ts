/**
 * Catalog code from SIS offering name (first three segments).
 * e.g. "AS.110.304.01" → "AS.110.304"
 */
export function catalogCourseCodeFromOfferingName(offeringName: string): string {
  const parts = offeringName.trim().split(".");
  if (parts.length >= 3) {
    return parts.slice(0, 3).join(".");
  }
  return offeringName.trim();
}

const FULL_CATALOG = /^[A-Za-z]{2}\.\d{3}\.\d{3}$/;
const BARE_NUMERIC = /^\d{3}\.\d{3}$/;

/**
 * Prefer full catalog codes (AS. / EN.) for display and eval API calls.
 * When `code` is bare "###.###" and `sisOfferingName` is present, derive the prefix from it.
 */
export function ensureCatalogCourseCode(code: string, sisOfferingName?: string): string {
  const c = code.trim();
  if (c === "" || c === "N/A") {
    if (sisOfferingName?.includes(".")) {
      return catalogCourseCodeFromOfferingName(sisOfferingName);
    }
    return c;
  }
  if (FULL_CATALOG.test(c)) {
    const [a, b, d] = c.split(".");
    return `${a!.toUpperCase()}.${b}.${d}`;
  }
  if (BARE_NUMERIC.test(c) && sisOfferingName && sisOfferingName.includes(".")) {
    return catalogCourseCodeFromOfferingName(sisOfferingName);
  }
  return c;
}
