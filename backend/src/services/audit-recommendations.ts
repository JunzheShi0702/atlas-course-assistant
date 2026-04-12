import { fetchSisClasses } from "./sis-client";
import { catalogCourseCodeFromOfferingName, type RawSisCourse } from "../types/sis";
import { type AuditEvalMetrics } from "../types/eval-summary";
import { type ScheduleAuditRecommendation } from "../types/database";

export interface AuditRecommendationCandidate extends ScheduleAuditRecommendation {
  overallQuality: number | null;
  workload: number | null;
  difficulty: number | null;
  respondentCount: number;
}

function coursePrefixFromCode(courseCode: string): string | null {
  const parts = courseCode.trim().split(".");
  if (parts.length < 2) return null;
  return `${parts[0]}${parts[1]}`.toUpperCase();
}

function recommendationCandidateFromRaw(
  raw: RawSisCourse,
  term: string,
): AuditRecommendationCandidate | null {
  const sisOfferingName = raw.OfferingName?.trim() ?? "";
  const title = raw.Title?.trim() ?? "";
  if (!sisOfferingName || !title) return null;

  return {
    courseCode: catalogCourseCodeFromOfferingName(sisOfferingName),
    sisOfferingName,
    term,
    title,
    overallQuality: null,
    workload: null,
    difficulty: null,
    respondentCount: 0,
  };
}

export function rankRecommendationCandidates(
  candidates: AuditRecommendationCandidate[],
): AuditRecommendationCandidate[] {
  return [...candidates].sort((a, b) => {
    const qualityA = a.overallQuality ?? -1;
    const qualityB = b.overallQuality ?? -1;
    if (qualityA !== qualityB) return qualityB - qualityA;

    const workloadA = a.workload ?? Number.POSITIVE_INFINITY;
    const workloadB = b.workload ?? Number.POSITIVE_INFINITY;
    if (workloadA !== workloadB) return workloadA - workloadB;

    const difficultyA = a.difficulty ?? Number.POSITIVE_INFINITY;
    const difficultyB = b.difficulty ?? Number.POSITIVE_INFINITY;
    if (difficultyA !== difficultyB) return difficultyA - difficultyB;

    return a.sisOfferingName.localeCompare(b.sisOfferingName);
  });
}

export function groundRecommendations(
  selectedOfferingNames: string[],
  candidates: AuditRecommendationCandidate[],
): ScheduleAuditRecommendation[] {
  const byOffering = new Map(
    candidates.map((candidate) => [candidate.sisOfferingName, candidate] as const),
  );

  return selectedOfferingNames
    .map((offeringName) => byOffering.get(offeringName))
    .filter((candidate): candidate is AuditRecommendationCandidate => Boolean(candidate))
    .map(({ courseCode, sisOfferingName, term, title }) => ({
      courseCode,
      sisOfferingName,
      term,
      title,
    }));
}

export async function buildAuditRecommendationCandidates(args: {
  courses: Array<{ courseCode: string }>;
  scheduleTerm: string;
  evalsByCourse: Record<string, AuditEvalMetrics | null>;
  maxCandidates?: number;
}): Promise<AuditRecommendationCandidate[]> {
  const { courses, scheduleTerm, evalsByCourse, maxCandidates = 8 } = args;
  const existingOfferings = new Set(courses.map((course) => course.courseCode));
  const prefixes = [...new Set(courses.map((course) => coursePrefixFromCode(course.courseCode)).filter(Boolean))];

  const rawResults = await Promise.all(
    prefixes.map((prefix) =>
      fetchSisClasses({
        Term: scheduleTerm,
        CourseNumber: prefix!,
      }).catch(() => [] as RawSisCourse[]),
    ),
  );

  const deduped = new Map<string, AuditRecommendationCandidate>();
  for (const rawCourses of rawResults) {
    for (const raw of rawCourses) {
      const candidate = recommendationCandidateFromRaw(raw, scheduleTerm);
      if (!candidate) continue;
      if (existingOfferings.has(candidate.courseCode)) continue;
      if (!deduped.has(candidate.sisOfferingName)) {
        deduped.set(candidate.sisOfferingName, candidate);
      }
    }
  }

  const enriched = [...deduped.values()].map((candidate) => {
    const metrics = evalsByCourse[candidate.courseCode];
    return {
      ...candidate,
      overallQuality: metrics?.overallQuality ?? null,
      workload: metrics?.workload ?? null,
      difficulty: metrics?.difficulty ?? null,
      respondentCount: metrics?.sampleSize ?? 0,
    };
  });

  return rankRecommendationCandidates(enriched).slice(0, maxCandidates);
}
