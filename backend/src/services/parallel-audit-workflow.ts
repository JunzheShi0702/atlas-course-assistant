import type { RawSisCourse } from "../types/sis";
import { fetchSisCourseDetails } from "./sis-client";
import type { ScheduleAgentContext } from "./schedule-context";
import type { AuditEvalMetrics } from "../types/eval-summary";
import type {
  ScheduleAuditFinding,
  ScheduleAuditFindingCategory,
  ScheduleAuditIncompleteCheck,
  ScheduleAuditRecommendation,
} from "../types/database";
import { calculateWorkloadRange } from "../tools/analyze-schedule-workload";
import { offeringNameToCourseId } from "./course-id";
import {
  intervalsOverlapHalfOpen,
  parseUnwantedScheduleFromText,
  type MinuteInterval,
  type UnwantedSchedule,
} from "./course-preference-parsing";
import { parseSisMeetingMinutesRange } from "./weekly-events-contract";

type NormalizedAuditCheckResult = {
  category: ScheduleAuditFindingCategory;
  findings: ScheduleAuditFinding[];
};

type WorkloadAuditCheckResult = NormalizedAuditCheckResult & {
  category: "workload";
  workloadRange: { min: number; max: number } | null;
};

type NormalizedAuditCheckFailure = {
  category: ScheduleAuditFindingCategory;
  incompleteCheck: ScheduleAuditIncompleteCheck;
};

type AuditCheckExecutionResult = NormalizedAuditCheckResult | NormalizedAuditCheckFailure;

type ParallelAuditWorkflowArgs = {
  context: ScheduleAgentContext;
  evalsByCourse: Record<string, AuditEvalMetrics | null>;
  recommendationCandidates: ScheduleAuditRecommendation[];
  checkRunners?: Partial<Record<ScheduleAuditFindingCategory, () => Promise<NormalizedAuditCheckResult>>>;
};

export type ParallelAuditWorkflowResult = {
  findings: ScheduleAuditFinding[];
  workloadRange: { min: number; max: number } | null;
  incompleteChecks: ScheduleAuditIncompleteCheck[];
};

function parseUnwantedScheduleFromContext(context: ScheduleAgentContext): UnwantedSchedule | null {
  const parts = [
    context.profile?.rawPreferencesText ?? "",
    ...context.canonicalMemories
      .filter((memory) => memory.memory_type === "preference" || memory.memory_type === "constraint")
      .map((memory) => memory.memory_text),
  ].filter((part) => part.trim().length > 0);
  return parseUnwantedScheduleFromText(parts.join("\n"));
}

function formatCanonDayLabel(day: string): string {
  return day.length > 0 ? day.charAt(0).toUpperCase() + day.slice(1) : day;
}

function summarizeUnwantedClockWindows(intervals: MinuteInterval[]): string {
  if (intervals.length === 0) return "";
  return intervals.map((i) => `${formatMinutes(i.start)}-${formatMinutes(i.end)}`).join(", ");
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

function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatCourseEvidence(raw: RawSisCourse): string {
  const range = parseSisMeetingMinutesRange(raw);
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
      const courseId = offeringNameToCourseId(course.sisOfferingName, course.term);
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
): WorkloadAuditCheckResult {
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
      const firstRange = parseSisMeetingMinutesRange(firstDetail);
      const secondRange = parseSisMeetingMinutesRange(secondDetail);
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
  const model = parseUnwantedScheduleFromContext(context);
  const findings: ScheduleAuditFinding[] = [];
  if (!model) {
    return { category: "preference_alignment", findings };
  }

  for (const course of context.courses) {
    const detail = detailsByOffering.get(course.sisOfferingName);
    if (!detail) continue;

    const courseDays = parseDows(detail);
    const range = parseSisMeetingMinutesRange(detail);

    const daysHit = [...courseDays].filter((d) => model.unwantedDays.has(d));
    const dayViolation = daysHit.length > 0;

    let timeViolation = false;
    if (model.unwantedTimeIntervals.length > 0 && range) {
      timeViolation = model.unwantedTimeIntervals.some((forbidden) =>
        intervalsOverlapHalfOpen(range.start, range.end, forbidden.start, forbidden.end),
      );
    }

    if (!dayViolation && !timeViolation) continue;

    const violatedPreferences: string[] = [];
    if (dayViolation) violatedPreferences.push("preferred days");
    if (timeViolation) violatedPreferences.push("preferred time window");

    const evidenceLines = [formatCourseEvidence(detail)];
    if (dayViolation) {
      evidenceLines.push(
        `Meets on ${daysHit.map(formatCanonDayLabel).join(", ")} — you indicated you do not want class on those weekdays.`,
      );
    }
    if (timeViolation && range) {
      const forbiddenSummary = summarizeUnwantedClockWindows(model.unwantedTimeIntervals);
      evidenceLines.push(
        `Meeting ${formatMinutes(range.start)}-${formatMinutes(range.end)} overlaps clock time you did not select (excluded local windows include: ${forbiddenSummary}).`,
      );
    }

    const summaryParts: string[] = [];
    if (dayViolation) {
      summaryParts.push(`${course.courseCode} meets on excluded weekday(s): ${daysHit.map(formatCanonDayLabel).join(", ")}.`);
    }
    if (timeViolation && range) {
      summaryParts.push(
        `${course.courseCode} meets at ${formatMinutes(range.start)}-${formatMinutes(range.end)}, which falls outside your saved class-time chips.`,
      );
    }

    findings.push({
      category: "preference_alignment",
      severity: "warning",
      title: "Schedule preference mismatch",
      summary: summaryParts.join(" "),
      evidence: evidenceLines,
      courseCode: course.courseCode,
      sisOfferingName: course.sisOfferingName,
      satisfiedPreferences: [],
      violatedPreferences,
    });
  }

  if (findings.length === 0) {
    findings.push({
      category: "preference_alignment",
      severity: "info",
      title: "Schedule preferences clear",
      summary:
        "No sections in this schedule conflict with your saved weekday or time-of-day preferences.",
      evidence: [
        "Each section meets only on weekdays you allow and within your selected class-time ranges, based on SIS days and meeting times.",
      ],
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

function synthesizeFindings(results: AuditCheckExecutionResult[]): ScheduleAuditFinding[] {
  return results
    .flatMap((result) => ("findings" in result ? result.findings : []))
    .sort((a, b) => {
      const severityDelta = severityRank(b.severity) - severityRank(a.severity);
      if (severityDelta !== 0) return severityDelta;
      return a.category.localeCompare(b.category);
    });
}

function synthesizeIncompleteChecks(
  results: AuditCheckExecutionResult[],
): ScheduleAuditIncompleteCheck[] {
  return results
    .flatMap((result) => ("incompleteCheck" in result ? [result.incompleteCheck] : []))
    .sort((a, b) => a.category.localeCompare(b.category));
}

function failureMessageForCategory(category: ScheduleAuditFindingCategory): string {
  switch (category) {
    case "workload":
      return "The workload audit check could not complete, so workload findings may be incomplete.";
    case "schedule_conflicts":
      return "The schedule-conflict check could not complete, so overlap findings may be incomplete.";
    case "preference_alignment":
      return "The preference-alignment check could not complete, so preference findings may be incomplete.";
    case "prerequisites":
      return "The prerequisite check could not complete, so prerequisite findings may be incomplete.";
  }
}

async function safeRunCheck(
  category: ScheduleAuditFindingCategory,
  runner: () => Promise<NormalizedAuditCheckResult>,
): Promise<AuditCheckExecutionResult> {
  try {
    return await runner();
  } catch (error) {
    console.error(`[audit] ${category} check failed:`, error);
    return {
      category,
      incompleteCheck: {
        category,
        status: "failed",
        errorCode: "check_execution_failed",
        message: failureMessageForCategory(category),
      },
    };
  }
}

export async function runParallelAuditWorkflow(
  args: ParallelAuditWorkflowArgs,
): Promise<ParallelAuditWorkflowResult> {
  const { context, evalsByCourse, checkRunners } = args;
  const detailsByOfferingPromise = loadCourseDetails(context);

  const workloadRunner =
    checkRunners?.workload ??
    (() => Promise.resolve(buildWorkloadCheck(context, evalsByCourse)));
  const conflictRunner =
    checkRunners?.schedule_conflicts ??
    (async () => buildConflictCheck(context, await detailsByOfferingPromise));
  const preferenceRunner =
    checkRunners?.preference_alignment ??
    (async () => buildPreferenceAlignmentCheck(context, await detailsByOfferingPromise));
  const prerequisiteRunner =
    checkRunners?.prerequisites ??
    (() => Promise.resolve(buildPrerequisiteCheck(context)));

  const results = await Promise.all([
    safeRunCheck("workload", workloadRunner),
    safeRunCheck("schedule_conflicts", conflictRunner),
    safeRunCheck("preference_alignment", preferenceRunner),
    safeRunCheck("prerequisites", prerequisiteRunner),
  ]);

  const workloadResult =
    results.find(
      (result): result is WorkloadAuditCheckResult =>
        result.category === "workload" && "findings" in result,
    ) ?? null;

  return {
    findings: synthesizeFindings(results),
    workloadRange: workloadResult?.workloadRange ?? null,
    incompleteChecks: synthesizeIncompleteChecks(results),
  };
}
