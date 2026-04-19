import type { RawSisCourse } from "../types/sis";
import { fetchSisCourseDetails } from "./sis-client";
import type { ScheduleAgentContext } from "./schedule-context";
import type { AuditEvalMetrics } from "../types/eval-summary";
import type {
  ScheduleAuditFinding,
  ScheduleAuditFindingCategory,
  ScheduleAuditRecommendation,
} from "../types/database";
import { calculateWorkloadRange } from "../tools/analyze-schedule-workload";

type TimeBucket = "morning" | "afternoon" | "evening";

type PreferenceConstraints = {
  preferredDays: Set<string>;
  preferredTimeBucket: TimeBucket | null;
};

type NormalizedAuditCheckResult = {
  category: ScheduleAuditFindingCategory;
  findings: ScheduleAuditFinding[];
};

type ParallelAuditWorkflowArgs = {
  context: ScheduleAgentContext;
  evalsByCourse: Record<string, AuditEvalMetrics | null>;
  recommendationCandidates: ScheduleAuditRecommendation[];
};

export type ParallelAuditWorkflowResult = {
  findings: ScheduleAuditFinding[];
  workloadRange: { min: number; max: number } | null;
};

function normalizeDayToken(input: string): string | null {
  const value = input.toLowerCase();
  if (/(^|\b)(mon|monday)(\b|$)/.test(value)) return "monday";
  if (/(^|\b)(tue|tues|tuesday)(\b|$)/.test(value)) return "tuesday";
  if (/(^|\b)(wed|wednesday)(\b|$)/.test(value)) return "wednesday";
  if (/(^|\b)(thu|thur|thurs|thursday)(\b|$)/.test(value)) return "thursday";
  if (/(^|\b)(fri|friday)(\b|$)/.test(value)) return "friday";
  if (/(^|\b)(sat|saturday)(\b|$)/.test(value)) return "saturday";
  if (/(^|\b)(sun|sunday)(\b|$)/.test(value)) return "sunday";
  return null;
}

function parseDaysFromText(text: string): Set<string> {
  const out = new Set<string>();
  const dayRegex =
    /\b(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = dayRegex.exec(text)) !== null) {
    const normalized = normalizeDayToken(match[1]);
    if (normalized) out.add(normalized);
  }
  return out;
}

function parseTimeBucketFromText(text: string): TimeBucket | null {
  const lower = text.toLowerCase();
  if (/\bmorning\b|before\s+noon|before\s+12|before\s+11/.test(lower)) return "morning";
  if (/\bafternoon\b|after\s+noon|after\s+12/.test(lower)) return "afternoon";
  if (/\bevening\b|\bnight\b|after\s+5|after\s+6|after\s+7/.test(lower)) return "evening";
  return null;
}

function parsePreferenceConstraints(context: ScheduleAgentContext): PreferenceConstraints {
  const parts = [
    context.profile?.rawPreferencesText ?? "",
    ...context.canonicalMemories
      .filter((memory) => memory.memory_type === "preference" || memory.memory_type === "constraint")
      .map((memory) => memory.memory_text),
  ].filter((part) => part.trim().length > 0);
  const text = parts.join("\n");
  return {
    preferredDays: parseDaysFromText(text),
    preferredTimeBucket: parseTimeBucketFromText(text),
  };
}

function courseIdFromOfferingName(offeringName: string, term: string): string {
  const offeringSlug = offeringName.replace(/\./g, "-").toLowerCase();
  const termSlug = term.replace(/\s+/g, "-").toLowerCase();
  return `${offeringSlug}-${termSlug}`;
}

function parseDows(raw: RawSisCourse): Set<string> {
  const out = new Set<string>();
  const numeric = parseInt(String(raw.DOW ?? ""), 10);
  if (Number.isNaN(numeric)) return out;
  if (numeric & 1) out.add("monday");
  if (numeric & 2) out.add("tuesday");
  if (numeric & 4) out.add("wednesday");
  if (numeric & 8) out.add("thursday");
  if (numeric & 16) out.add("friday");
  if (numeric & 32) out.add("saturday");
  if (numeric & 64) out.add("sunday");
  return out;
}

function parseTimeRange(raw: RawSisCourse): { start: number; end: number } | null {
  const value = typeof raw.StartTimeEndTime === "string" ? raw.StartTimeEndTime : "";
  const match = value.match(/^(\d{2}):(\d{2})\|(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, startHour, startMinute, endHour, endMinute] = match;
  return {
    start: Number(startHour) * 60 + Number(startMinute),
    end: Number(endHour) * 60 + Number(endMinute),
  };
}

function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatCourseEvidence(raw: RawSisCourse): string {
  const range = parseTimeRange(raw);
  const days = [...parseDows(raw)];
  const dayLabel = days.length > 0 ? days.join("/") : "unknown days";
  if (!range) return `${raw.OfferingName}: ${dayLabel}`;
  return `${raw.OfferingName}: ${dayLabel} ${formatMinutes(range.start)}-${formatMinutes(range.end)}`;
}

function hasIntersection(a: Set<string>, b: Set<string>): boolean {
  for (const value of a) {
    if (b.has(value)) return true;
  }
  return false;
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

async function loadCourseDetails(
  context: ScheduleAgentContext,
): Promise<Map<string, RawSisCourse>> {
  const entries = await Promise.all(
    context.courses.map(async (course) => {
      const courseId = courseIdFromOfferingName(course.sisOfferingName, course.term);
      const detail = await fetchSisCourseDetails(courseId);
      return detail ? [course.sisOfferingName, detail] as const : null;
    }),
  );

  return new Map(
    entries.filter((entry): entry is readonly [string, RawSisCourse] => Boolean(entry)),
  );
}

function buildWorkloadCheck(
  context: ScheduleAgentContext,
  evalsByCourse: Record<string, AuditEvalMetrics | null>,
): NormalizedAuditCheckResult & { workloadRange: { min: number; max: number } | null } {
  const workloadRange = calculateWorkloadRange(context.courses, evalsByCourse);
  const findings: ScheduleAuditFinding[] = [];

  if (workloadRange) {
    const severity =
      workloadRange.max >= 30 ? "critical" : workloadRange.max >= 24 ? "warning" : "info";
    findings.push({
      category: "workload",
      severity,
      title: "Weekly workload estimate",
      summary:
        severity === "critical"
          ? `The projected workload is high at ${workloadRange.min}-${workloadRange.max} hours per week.`
          : severity === "warning"
            ? `The projected workload is moderately heavy at ${workloadRange.min}-${workloadRange.max} hours per week.`
            : `The projected workload is manageable at ${workloadRange.min}-${workloadRange.max} hours per week.`,
      evidence: [`Deterministic estimate from schedule credits and evaluation workload metrics: ${workloadRange.min}-${workloadRange.max} hrs/week.`],
    });
  }

  const heavyCourses = context.courses
    .map((course) => ({
      course,
      metrics: evalsByCourse[course.courseCode],
    }))
    .filter(({ metrics }) =>
      Boolean(metrics && ((metrics.workload ?? 0) >= 4.2 || (metrics.difficulty ?? 0) >= 4.2)),
    );

  if (heavyCourses.length >= 2) {
    findings.push({
      category: "workload",
      severity: "warning",
      title: "Heavy-course concentration",
      summary: `Multiple courses carry elevated workload or difficulty signals in the same schedule.`,
      evidence: heavyCourses.map(({ course, metrics }) =>
        `${course.courseCode}: workload ${metrics?.workload ?? "n/a"}, difficulty ${metrics?.difficulty ?? "n/a"}`,
      ),
    });
  }

  return {
    category: "workload",
    findings,
    workloadRange,
  };
}

function buildConflictCheck(
  context: ScheduleAgentContext,
  detailsByOffering: Map<string, RawSisCourse>,
): NormalizedAuditCheckResult {
  const findings: ScheduleAuditFinding[] = [];
  for (let i = 0; i < context.courses.length; i++) {
    for (let j = i + 1; j < context.courses.length; j++) {
      const first = context.courses[i];
      const second = context.courses[j];
      const firstDetail = detailsByOffering.get(first.sisOfferingName);
      const secondDetail = detailsByOffering.get(second.sisOfferingName);
      if (!firstDetail || !secondDetail) continue;

      const firstDays = parseDows(firstDetail);
      const secondDays = parseDows(secondDetail);
      const firstRange = parseTimeRange(firstDetail);
      const secondRange = parseTimeRange(secondDetail);
      if (!firstRange || !secondRange) continue;
      if (!hasIntersection(firstDays, secondDays)) continue;
      if (!overlaps(firstRange, secondRange)) continue;

      findings.push({
        category: "schedule_conflicts",
        severity: "critical",
        title: "Meeting-time overlap detected",
        summary: `${first.courseCode} and ${second.courseCode} overlap in the current schedule.`,
        evidence: [formatCourseEvidence(firstDetail), formatCourseEvidence(secondDetail)],
        courseCode: first.courseCode,
        sisOfferingName: first.sisOfferingName,
      });
    }
  }

  return {
    category: "schedule_conflicts",
    findings,
  };
}

function buildPreferenceAlignmentCheck(
  context: ScheduleAgentContext,
  detailsByOffering: Map<string, RawSisCourse>,
): NormalizedAuditCheckResult {
  const constraints = parsePreferenceConstraints(context);
  const findings: ScheduleAuditFinding[] = [];
  const hasDayPreference = constraints.preferredDays.size > 0;
  const hasTimePreference = constraints.preferredTimeBucket !== null;
  if (!hasDayPreference && !hasTimePreference) {
    return { category: "preference_alignment", findings };
  }

  for (const course of context.courses) {
    const detail = detailsByOffering.get(course.sisOfferingName);
    if (!detail) continue;
    const courseDays = parseDows(detail);
    const courseTime = parseTimeBucketFromText(detail.TimeOfDay ?? "");

    const satisfiedPreferences: string[] = [];
    const violatedPreferences: string[] = [];

    if (hasDayPreference && courseDays.size > 0) {
      if (hasIntersection(constraints.preferredDays, courseDays)) {
        satisfiedPreferences.push("preferred days");
      } else {
        violatedPreferences.push("preferred days");
      }
    }

    if (hasTimePreference && courseTime) {
      if (courseTime === constraints.preferredTimeBucket) {
        satisfiedPreferences.push("preferred time window");
      } else {
        violatedPreferences.push("preferred time window");
      }
    }

    if (satisfiedPreferences.length === 0 && violatedPreferences.length === 0) continue;

    findings.push({
      category: "preference_alignment",
      severity: violatedPreferences.length > 0 ? "warning" : "info",
      title:
        violatedPreferences.length > 0
          ? "Preference mismatch detected"
          : "Preference-aligned section",
      summary:
        violatedPreferences.length > 0
          ? `${course.courseCode} conflicts with one or more captured schedule preferences.`
          : `${course.courseCode} matches the captured schedule preferences that were evaluated.`,
      evidence: [formatCourseEvidence(detail)],
      courseCode: course.courseCode,
      sisOfferingName: course.sisOfferingName,
      satisfiedPreferences,
      violatedPreferences,
    });
  }

  return {
    category: "preference_alignment",
    findings,
  };
}

function buildPrerequisiteCheck(
  context: ScheduleAgentContext,
): NormalizedAuditCheckResult {
  const findings: ScheduleAuditFinding[] = [];
  if (context.courses.length > 0) {
    findings.push({
      category: "prerequisites",
      severity: "info",
      title: "Prerequisite check is provisional",
      summary:
        "Prerequisite readiness is included in the parallel audit contract, but completed-course history integration is still provisional in this phase.",
      evidence: [
        "This audit run reserves a prerequisite check slot and stable findings shape.",
        "Final prerequisite fulfillment wiring will use the completed-course history flow from Iteration 4 R2.",
      ],
    });
  }

  return {
    category: "prerequisites",
    findings,
  };
}

function severityRank(severity: ScheduleAuditFinding["severity"]): number {
  switch (severity) {
    case "critical":
      return 3;
    case "warning":
      return 2;
    case "info":
      return 1;
  }
}

function synthesizeFindings(results: NormalizedAuditCheckResult[]): ScheduleAuditFinding[] {
  return results
    .flatMap((result) => result.findings)
    .sort((a, b) => {
      const severityDelta = severityRank(b.severity) - severityRank(a.severity);
      if (severityDelta !== 0) return severityDelta;
      return a.category.localeCompare(b.category);
    });
}

export async function runParallelAuditWorkflow(
  args: ParallelAuditWorkflowArgs,
): Promise<ParallelAuditWorkflowResult> {
  const { context, evalsByCourse } = args;
  const detailsByOffering = await loadCourseDetails(context);

  const [workloadResult, conflictResult, preferenceResult, prerequisiteResult] = await Promise.all([
    Promise.resolve(buildWorkloadCheck(context, evalsByCourse)),
    Promise.resolve(buildConflictCheck(context, detailsByOffering)),
    Promise.resolve(buildPreferenceAlignmentCheck(context, detailsByOffering)),
    Promise.resolve(buildPrerequisiteCheck(context)),
  ]);

  return {
    findings: synthesizeFindings([
      workloadResult,
      conflictResult,
      preferenceResult,
      prerequisiteResult,
    ]),
    workloadRange: workloadResult.workloadRange,
  };
}
