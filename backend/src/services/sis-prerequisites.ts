import type { RawSisCourse } from "../types/sis";

type SisPrerequisiteRecord = {
  Description?: unknown;
  Expression?: unknown;
  IsNegative?: unknown;
};

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePrerequisiteRecord(record: SisPrerequisiteRecord): string | null {
  const description = asNonEmptyString(record.Description);
  const expression = asNonEmptyString(record.Expression);
  // Prefer SIS Expression over Description so we keep logical operators
  // and avoid prose/restriction sentence fragments.
  const base = expression ?? description;
  if (!base) return null;
  const isNegative =
    record.IsNegative === true ||
    (typeof record.IsNegative === "string" &&
      ["y", "yes", "true", "1"].includes(record.IsNegative.trim().toLowerCase()));
  return isNegative ? `NOT (${base})` : base;
}

function extractFromSectionDetails(raw: RawSisCourse): string | null {
  const sectionDetails = raw.SectionDetails;
  if (!sectionDetails) return null;

  const detailsArray = Array.isArray(sectionDetails)
    ? sectionDetails
    : [sectionDetails];

  const prerequisiteTexts = detailsArray
    .flatMap((detail) => {
      if (!detail || typeof detail !== "object") return [];
      const prerequisites = (detail as { Prerequisites?: unknown }).Prerequisites;
      if (!Array.isArray(prerequisites)) return [];
      return prerequisites;
    })
    .map((record) =>
      normalizePrerequisiteRecord(
        (record ?? {}) as SisPrerequisiteRecord,
      ),
    )
    .filter((value): value is string => value !== null);

  if (prerequisiteTexts.length === 0) return null;
  return [...new Set(prerequisiteTexts)].join("; ");
}

function extractFromTopLevelFallback(raw: RawSisCourse): string | null {
  const candidateFields = [
    raw.Prerequisites,
    raw.Prerequisite,
    raw.PreReq,
    raw.Prereq,
    raw.Requisites,
    raw.PreRequisites,
    raw.PreRequisite,
    raw.RequisiteText,
    raw.Requirements,
  ];
  const direct = candidateFields
    .map((candidate) => asNonEmptyString(candidate))
    .find((candidate): candidate is string => candidate !== null);
  if (direct) return direct;

  const scanned = Object.entries(raw).find(([key, value]) => {
    const normalizedKey = key.toLowerCase();
    const prerequisiteLike =
      normalizedKey.includes("prereq") ||
      normalizedKey.includes("prerequisite") ||
      normalizedKey.includes("requisite");
    return prerequisiteLike && asNonEmptyString(value) !== null;
  })?.[1];

  return asNonEmptyString(scanned) ?? null;
}

export function extractPrerequisitesText(raw: RawSisCourse): string | undefined {
  return extractFromSectionDetails(raw) ?? extractFromTopLevelFallback(raw) ?? undefined;
}
