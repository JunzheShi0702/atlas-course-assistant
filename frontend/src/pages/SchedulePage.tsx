import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import CourseCard from "@/components/CourseCard";
import Calendar from "@/pages/SchedulePageComponents/Calendar";
import Chat from "@/pages/SchedulePageComponents/Chat";
import CourseList from "@/pages/SchedulePageComponents/CourseList";
import ScheduleAudit from "@/pages/SchedulePageComponents/ScheduleAudit";
import { scheduleEventProvider } from "@/lib/schedule-event-provider";
import { apiUrl } from "@/lib/apiUrl";
import { normalizeAgentApiPayload } from "@/lib/parseAgentPayload";
import { useSchedules } from "@/hooks/useSchedules";
import { useSisDetailsCache } from "@/hooks/useSisDetailsCache";
import type { CourseCard as CourseCardType } from "@/store/atoms";
import type { SisCourseDetails } from "@/store/atoms";
import type {
  ScheduleAuditFinding,
  ScheduleAuditResult,
  ScheduleDetail,
  ScheduleCourseItem,
  ScheduleGoalAlignment,
  WeeklyScheduleEvent,
  WeeklyScheduleDay,
  CustomScheduleEventBody,
} from "@/types/schedules";

type PrereqOutcome = "fulfilled" | "taken" | "missing prereq" | "override" | "unknown";
type CustomEventDraft = CustomScheduleEventBody;

const COURSE_PASTEL_COLORS = [
  "--color-hot-pink",
  "--color-mint",
  "--color-yellow",
  "--color-periwinkle",
  "--color-peach",
  "--color-soft-purple",
  "--color-yellow-green",
  "--color-sky-blue",
  "--color-pink-lavender",
  "--color-golden-yellow",
  "--color-lavender-blue",
  "--color-bubblegum-pink",
  "--color-pale-yellow",
  "--color-powder-blue",
  "--color-blush-pink",
];

const LEFT_PANE_MIN_WIDTH = 320;
const LEFT_PANE_MAX_WIDTH = 640;
const AUDIT_PANE_MIN_WIDTH = 240;
const AUDIT_PANE_MAX_WIDTH = 420;
const CALENDAR_MIN_PERCENT = 30;
const CALENDAR_MAX_PERCENT = 70;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const DEFAULT_CUSTOM_EVENT_DRAFT: CustomEventDraft = {
  title: "",
  dayOfWeek: "Monday",
  startTime: "09:00",
  endTime: "10:00",
  location: "",
};

function getCustomEventTimeLabel(startTime: string | null, endTime: string | null): string {
  if (startTime && endTime) return `${startTime} - ${endTime}`;
  return "Time TBD";
}

type PrerequisiteToken = { token: string; type: "code" | "operator" | "paren" };
type ExprNode =
  | { kind: "code"; code: string }
  | { kind: "not"; child: ExprNode }
  | { kind: "and"; left: ExprNode; right: ExprNode }
  | { kind: "or"; left: ExprNode; right: ExprNode };

type SisCourseDetailsResponse = {
  details: Partial<SisCourseDetails> | null;
};

type SisSearchRawResponse = {
  courses?: Array<{
    offeringName?: string;
    title?: string;
    description?: string;
    instructors?: string[];
    term?: string;
    schoolName?: string;
    department?: string;
    level?: string;
    timeOfDay?: string;
    daysOfWeek?: string;
    location?: string;
    status?: string;
    prerequisites?: string;
    sectionName?: string;
  }>;
};

type AgentSearchResponse = {
  type?: string;
  message?: string;
  results?: Array<{
    code?: string;
    sisOfferingName?: string;
    term?: string;
    description?: string;
    instructor?: string;
  }>;
};

function normalizeGoalAlignment(
  raw: ScheduleAuditResult["goalAlignment"],
): ScheduleGoalAlignment | null {
  if (raw == null || typeof raw !== "object") return null;
  const score =
    typeof raw.score === "number" || raw.score === null ? raw.score : null;
  return {
    score,
    rationale: typeof raw.rationale === "string" ? raw.rationale : "",
    alignedGoals: Array.isArray(raw.alignedGoals)
      ? raw.alignedGoals.filter((g): g is string => typeof g === "string")
      : [],
    conflicts: Array.isArray(raw.conflicts)
      ? raw.conflicts.filter((g): g is string => typeof g === "string")
      : [],
  };
}

/**
 * Schedule page — route: /schedules/:id
 *
 * On load: GET /api/schedules/:id → populates name, courses list.
 * Left  (~60%): ScheduleChat panel (#121)
 * Right (~40%): Course list + workload audit panel (#132)
 */

function extractAuditView(result: ScheduleAuditResult | null | undefined) {
  if (!result) {
    return {
      workloadRange: null,
      narrative: null,
      missingData: null,
      goalAlignment: null,
      findings: [],
      recommendations: [],
    };
  }

  const workloadRange = result.workloadRange
    ? `${result.workloadRange.min}-${result.workloadRange.max} hrs/week`
    : null;

  return {
    workloadRange,
    narrative: result.narrativeSummary?.trim() || null,
    missingData: result.missingEvaluationData?.length
      ? result.missingEvaluationData.join(", ")
      : null,
    goalAlignment: normalizeGoalAlignment(result.goalAlignment),
    findings: result.findings ?? [],
    recommendations: result.recommendations ?? [],
  };
}

function formatPreferenceLabel(values: string[]): string | null {
  if (values.length === 0) return null;
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

function buildAlignmentBullets(
  goalAlignment: ScheduleGoalAlignment | null,
  findings: ScheduleAuditFinding[],
) {
  const matches = new Set<string>(goalAlignment?.alignedGoals ?? []);
  const conflicts = new Set<string>(goalAlignment?.conflicts ?? []);

  for (const finding of findings) {
    if (finding.category !== "preference_alignment") continue;

    const courseLabel = finding.courseCode ?? finding.sisOfferingName ?? "This course";
    const rawEvidence = finding.evidence[0] ?? "meeting details unavailable";
    const evidence = rawEvidence.startsWith(`${courseLabel}: `)
      ? rawEvidence.slice(courseLabel.length + 2)
      : rawEvidence;
    const satisfied = formatPreferenceLabel(finding.satisfiedPreferences ?? []);
    const violated = formatPreferenceLabel(finding.violatedPreferences ?? []);

    if (satisfied) {
      matches.add(`${courseLabel}: ${evidence} matches your ${satisfied}.`);
    }

    if (violated) {
      conflicts.add(`${courseLabel}: ${evidence} conflicts with your ${violated}.`);
    }
  }

  return {
    matches: [...matches],
    conflicts: [...conflicts],
  };
}

function toAuditErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";

  if (raw === "HTTP 404") {
    return "Workload audit is not available right now for this schedule. Please try again in a bit.";
  }
  if (raw === "HTTP 403" || raw === "Forbidden") {
    return "You do not have permission to run an audit for this schedule.";
  }
  if (raw === "HTTP 401" || raw === "Unauthorized") {
    return "Your session expired. Please sign in again and retry the audit.";
  }
  if (raw === "HTTP 500") {
    return "The server could not complete the workload audit. Please try again.";
  }
  if (raw.trim().length > 0) return raw;

  return "Failed to run workload audit.";
}

function toScheduleCourseKeys(courses: ScheduleCourseItem[]): Set<string> {
  return new Set(courses.map((c) => `${c.courseCode}|${c.sisOfferingName}|${c.term}`));
}

function toCourseId(sisOfferingName: string, term: string): string {
  const offering = sisOfferingName.trim().toLowerCase().replace(/\./g, "-");
  const termSlug = term.trim().toLowerCase().replace(/\s+/g, "-");
  return `${offering}-${termSlug}`;
}

function normalizeCourseCode(value: string): string {
  return value.trim().toUpperCase();
}

function getCurrentSisTerm(now: Date = new Date()): string {
  const month = now.getMonth(); // 0-based
  const year = now.getFullYear();
  // SIS terms are commonly "Spring YYYY" / "Fall YYYY".
  // Treat Jan-Jun as Spring, Jul-Dec as Fall.
  return month <= 5 ? `Spring ${year}` : `Fall ${year}`;
}

function parsePrerequisiteLine(line: string): PrerequisiteToken[] {
  const pattern = /\b(?:AS|EN)[\s.]?\d{3}[\s.]?\d{3}\b|\bAND\b|\bOR\b|\bNOT\b|[()]/gi;
  const matches = [...line.matchAll(pattern)];
  const tokens: PrerequisiteToken[] = [];
  for (const match of matches) {
    const raw = (match[0] ?? "").toUpperCase();
    if (raw === "AND" || raw === "OR" || raw === "NOT") {
      tokens.push({ token: raw, type: "operator" });
      continue;
    }
    if (raw === "(" || raw === ")") {
      tokens.push({ token: raw, type: "paren" });
      continue;
    }
    const normalized = raw.replace(/\s+/g, ".").replace(/^((AS|EN))\.(\d{3})\.(\d{3})$/, "$1.$3.$4");
    tokens.push({ token: normalized, type: "code" });
  }
  return tokens;
}

function parseExpressionTokens(tokens: PrerequisiteToken[]): ExprNode | null {
  const relevant = tokens.filter((token) => token.type !== "paren" || token.token === "(" || token.token === ")");
  while (
    relevant.length > 0 &&
    relevant[0]?.type === "operator" &&
    (relevant[0].token === "AND" || relevant[0].token === "OR")
  ) {
    relevant.shift();
  }
  while (
    relevant.length > 0 &&
    relevant[relevant.length - 1]?.type === "operator" &&
    ["AND", "OR", "NOT"].includes(relevant[relevant.length - 1].token)
  ) {
    relevant.pop();
  }
  if (relevant.length === 0) return null;
  let pointer = 0;

  const parsePrimary = (): ExprNode | null => {
    const current = relevant[pointer];
    if (!current) return null;
    if (current.type === "code") {
      pointer += 1;
      return { kind: "code", code: current.token };
    }
    if (current.type === "paren" && current.token === "(") {
      pointer += 1;
      const node = parseOr();
      const close = relevant[pointer];
      if (!node || !close || close.type !== "paren" || close.token !== ")") return null;
      pointer += 1;
      return node;
    }
    return null;
  };

  const parseUnary = (): ExprNode | null => {
    const current = relevant[pointer];
    if (current?.type === "operator" && current.token === "NOT") {
      pointer += 1;
      const child = parseUnary();
      return child ? { kind: "not", child } : null;
    }
    return parsePrimary();
  };

  const parseAnd = (): ExprNode | null => {
    let node = parseUnary();
    while (node) {
      const current = relevant[pointer];
      if (!(current?.type === "operator" && current.token === "AND")) break;
      pointer += 1;
      const right = parseUnary();
      if (!right) return null;
      node = { kind: "and", left: node, right };
    }
    return node;
  };

  const parseOr = (): ExprNode | null => {
    let node = parseAnd();
    while (node) {
      const current = relevant[pointer];
      if (!(current?.type === "operator" && current.token === "OR")) break;
      pointer += 1;
      const right = parseAnd();
      if (!right) return null;
      node = { kind: "or", left: node, right };
    }
    return node;
  };

  const root = parseOr();
  return root && pointer === relevant.length ? root : null;
}

function evaluateExpression(node: ExprNode, takenCodes: Set<string>): boolean {
  if (node.kind === "code") return takenCodes.has(normalizeCourseCode(node.code));
  if (node.kind === "not") return !evaluateExpression(node.child, takenCodes);
  if (node.kind === "and") return evaluateExpression(node.left, takenCodes) && evaluateExpression(node.right, takenCodes);
  return evaluateExpression(node.left, takenCodes) || evaluateExpression(node.right, takenCodes);
}

function collectNegatedCodes(node: ExprNode, negated = false, out = new Set<string>()): Set<string> {
  if (node.kind === "code") {
    if (negated) out.add(normalizeCourseCode(node.code));
    return out;
  }
  if (node.kind === "not") return collectNegatedCodes(node.child, !negated, out);
  collectNegatedCodes(node.left, negated, out);
  collectNegatedCodes(node.right, negated, out);
  return out;
}

export default function SchedulePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getSchedule, deleteSchedule, addCourse, removeCourse, createCustomEvent, updateCustomEvent, deleteCustomEvent, runScheduleAudit } = useSchedules();
  const { cache: sisDetailsCache, prefetchSisDetails } = useSisDetailsCache();

  const [schedule, setSchedule] = useState<ScheduleDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [runningAudit, setRunningAudit] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [weeklyEvents, setWeeklyEvents] = useState<WeeklyScheduleEvent[]>([]);
  const [weeklyEventsLoading, setWeeklyEventsLoading] = useState(false);
  const [weeklyEventsError, setWeeklyEventsError] = useState<string | null>(null);
  const [selectedWeeklyEvent, setSelectedWeeklyEvent] = useState<WeeklyScheduleEvent | null>(null);
  const detailsCloseRef = useRef<HTMLButtonElement | null>(null);
  /**
   * Single source of truth for which courses are in this schedule.
   * Rebuilt from a confirmed server response on initial load and after any
   * chat-side add/remove. Sidebar deletions do a targeted key removal so they
   * never clobber optimistic adds that are still in-flight to the server.
   */
  const [scheduleCourseIds, setScheduleCourseIds] = useState<Set<string>>(new Set());
  const [courseColorMap, setCourseColorMap] = useState<Record<string, string>>({});
  const freedColorsQueueRef = useRef<string[]>([]);
  const nextColorIndexRef = useRef(0);
  const [takenCourseCodes, setTakenCourseCodes] = useState<Set<string>>(new Set());
  const [hasLoadedTakenCourseHistory, setHasLoadedTakenCourseHistory] = useState(false);
  const [shortlistStatuses, setShortlistStatuses] = useState<Record<string, { loading: boolean; outcome: PrereqOutcome | null }>>({});
  const [selectedCourseCardData, setSelectedCourseCardData] = useState<CourseCardType | null>(null);
  const infoRequestSeqRef = useRef(0);
  const [customEventDraft, setCustomEventDraft] = useState<CustomEventDraft>(DEFAULT_CUSTOM_EVENT_DRAFT);
  const [customEventEditorOpen, setCustomEventEditorOpen] = useState(false);
  const [customEventSaving, setCustomEventSaving] = useState(false);
  const [customEventError, setCustomEventError] = useState<string | null>(null);
  const [editingCustomEventId, setEditingCustomEventId] = useState<string | null>(null);
  const [leftPaneWidth, setLeftPaneWidth] = useState(480);
  const [auditPaneWidth, setAuditPaneWidth] = useState(320);
  const [calendarPanePercent, setCalendarPanePercent] = useState(44);
  const leftPaneRef = useRef<HTMLDivElement | null>(null);

  const startHorizontalResize = useCallback((
    event: React.PointerEvent<HTMLButtonElement>,
    pane: "left" | "audit",
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = pane === "left" ? leftPaneWidth : auditPaneWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onPointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      if (pane === "left") {
        setLeftPaneWidth(clamp(startWidth + delta, LEFT_PANE_MIN_WIDTH, LEFT_PANE_MAX_WIDTH));
        return;
      }
      setAuditPaneWidth(clamp(startWidth - delta, AUDIT_PANE_MIN_WIDTH, AUDIT_PANE_MAX_WIDTH));
    };

    const onPointerUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }, [auditPaneWidth, leftPaneWidth]);

  const startCalendarResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const pane = leftPaneRef.current;
    if (!pane) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const onPointerMove = (moveEvent: PointerEvent) => {
      const rect = pane.getBoundingClientRect();
      if (rect.height <= 0) return;
      const nextPercent = ((moveEvent.clientY - rect.top) / rect.height) * 100;
      setCalendarPanePercent(clamp(nextPercent, CALENDAR_MIN_PERCENT, CALENDAR_MAX_PERCENT));
    };

    const onPointerUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }, []);

  const assignColorsToNewCourses = useCallback((courses: ScheduleCourseItem[]) => {
    setCourseColorMap((prev) => {
      const next = { ...prev };
      for (const course of courses) {
        const key = normalizeCourseCode(course.courseCode);
        if (!next[key]) {
          const freed = freedColorsQueueRef.current.shift();
          next[key] = freed ?? COURSE_PASTEL_COLORS[nextColorIndexRef.current++ % COURSE_PASTEL_COLORS.length];
        }
      }
      return next;
    });
  }, []);

  const loadSchedule = useCallback(() => {
    if (!id) return;
    setLoadError(null);
    getSchedule(id)
      .then((data) => {
        setSchedule(data);
        setScheduleCourseIds(toScheduleCourseKeys(data.courses));
        assignColorsToNewCourses(data.courses);
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [id, getSchedule, assignColorsToNewCourses]);

  useEffect(() => {
    loadSchedule();
  }, [id, loadSchedule]);

  useEffect(() => {
    let cancelled = false;
    const loadTakenHistory = async () => {
      try {
        const response = await fetch(apiUrl("/api/user/memories"), {
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });
        if (!response.ok) {
          if (!cancelled) setHasLoadedTakenCourseHistory(true);
          return;
        }
        const payload = (await response.json()) as {
          memories?: Array<{ text?: string; type?: string }>;
        };
        const taken = new Set(
          (payload.memories ?? [])
            .filter((memory) => memory.type === "course_history")
            .map((memory) => memory.text?.trim() ?? "")
            .filter((text) => text.length > 0)
            .map((text) => normalizeCourseCode(text)),
        );
        if (!cancelled) {
          setTakenCourseCodes(taken);
          setHasLoadedTakenCourseHistory(true);
        }
      } catch {
        if (!cancelled) setHasLoadedTakenCourseHistory(true);
      }
    };
    void loadTakenHistory();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadWeeklyEvents = useCallback((opts?: { signal?: AbortSignal }) => {
    if (!id) {
      setWeeklyEvents([]);
      setWeeklyEventsLoading(false);
      setWeeklyEventsError(null);
      return Promise.resolve();
    }
    const { signal } = opts ?? {};
    setWeeklyEventsLoading(true);
    setWeeklyEventsError(null);
    return scheduleEventProvider
      .getWeeklyEvents(id)
      .then((events) => {
        if (signal?.aborted) return;
        setWeeklyEvents(events);
      })
      .catch((error) => {
        if (signal?.aborted) return;
        const raw = error instanceof Error ? error.message : "";
        if (raw === "HTTP 404") {
          setWeeklyEventsError("Weekly schedule data was not found for this schedule.");
        } else if (raw === "HTTP 403") {
          setWeeklyEventsError("You do not have permission to view weekly events for this schedule.");
        } else if (raw === "HTTP 401") {
          setWeeklyEventsError("Your session expired. Please sign in again to view weekly events.");
        } else {
          setWeeklyEventsError("Unable to load weekly schedule events right now.");
        }
        setWeeklyEvents([]);
      })
      .finally(() => {
        if (signal?.aborted) return;
        setWeeklyEventsLoading(false);
      });
  }, [id]);

  useEffect(() => {
    const ac = new AbortController();
    void loadWeeklyEvents({ signal: ac.signal });
    return () => ac.abort();
  }, [id, loadWeeklyEvents]);

  useEffect(() => {
    if (!schedule) return;
    schedule.courses.forEach((course) => {
      const courseId = toCourseId(course.sisOfferingName || course.courseCode, course.term);
      void prefetchSisDetails(courseId);
    });
  }, [prefetchSisDetails, schedule]);

  useEffect(() => {
    if (!schedule) return;
    if (!hasLoadedTakenCourseHistory) {
      const pending: Record<string, { loading: boolean; outcome: PrereqOutcome | null }> = {};
      schedule.courses.forEach((course) => {
        pending[`${course.courseCode}|${course.sisOfferingName}|${course.term}`] = { loading: true, outcome: null };
      });
      setShortlistStatuses(pending);
      return;
    }

    let cancelled = false;
    const evaluateShortlistStatuses = async () => {
      const initial: Record<string, { loading: boolean; outcome: PrereqOutcome | null }> = {};
      schedule.courses.forEach((course) => {
        initial[`${course.courseCode}|${course.sisOfferingName}|${course.term}`] = { loading: true, outcome: null };
      });
      setShortlistStatuses(initial);

      const updates = await Promise.all(
        schedule.courses.map(async (course) => {
          const key = `${course.courseCode}|${course.sisOfferingName}|${course.term}`;
          const canonicalCode = normalizeCourseCode(course.courseCode);
          if (takenCourseCodes.has(canonicalCode)) {
            return { key, outcome: "taken" as PrereqOutcome };
          }

          try {
            const courseId = toCourseId(course.sisOfferingName || course.courseCode, course.term);
            const response = await fetch(apiUrl(`/api/courses/${courseId}/details`), {
              credentials: "include",
              headers: { "Content-Type": "application/json" },
            });
            if (!response.ok) {
              return { key, outcome: "unknown" as PrereqOutcome };
            }
            const payload = (await response.json()) as SisCourseDetailsResponse;
            const prerequisiteText = String(payload.details?.prerequisites ?? "").trim();
            const lines = prerequisiteText
              .split(/[\n;]+/)
              .map((line: string) => parsePrerequisiteLine(line))
              .filter((lineTokens) => lineTokens.length > 0);
            const parsedNodes = lines.map((line: PrerequisiteToken[]) => parseExpressionTokens(line));
            const parseFailed = prerequisiteText.length > 0 && parsedNodes.some((node) => node === null);
            if (parseFailed) {
              return { key, outcome: "unknown" as PrereqOutcome };
            }
            const nodes = parsedNodes.filter((n): n is ExprNode => n !== null);
            const negated = new Set<string>();
            nodes.forEach((node) => collectNegatedCodes(node, false, negated));
            const hasExpression = nodes.length > 0;
            const allMet = !hasExpression || nodes.every((node) => evaluateExpression(node, takenCourseCodes));
            const override = Array.from(negated).some((code) => takenCourseCodes.has(code));
            const outcome: PrereqOutcome = override ? "override" : allMet ? "fulfilled" : "missing prereq";
            return { key, outcome };
          } catch {
            return { key, outcome: "unknown" as PrereqOutcome };
          }
        }),
      );

      if (cancelled) return;
      const merged: Record<string, { loading: boolean; outcome: PrereqOutcome | null }> = {};
      updates.forEach(({ key, outcome }) => {
        merged[key] = { loading: false, outcome };
      });
      setShortlistStatuses(merged);
    };

    void evaluateShortlistStatuses();
    return () => {
      cancelled = true;
    };
  }, [hasLoadedTakenCourseHistory, schedule, takenCourseCodes]);

  /** Refetch after add/remove from chat — rebuilds scheduleCourseIds from confirmed server data. */
  const refreshScheduleList = useCallback(() => {
    if (!id) return;
    getSchedule(id)
      .then((data) => {
        setSchedule(data);
        setScheduleCourseIds(toScheduleCourseKeys(data.courses));
        assignColorsToNewCourses(data.courses);
        return loadWeeklyEvents();
      })
      .catch(() => {});
  }, [id, getSchedule, loadWeeklyEvents, assignColorsToNewCourses]);

  useEffect(() => {
    if (!selectedWeeklyEvent) return;
    detailsCloseRef.current?.focus();
  }, [selectedWeeklyEvent]);

  useEffect(() => {
    if (!selectedWeeklyEvent) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setSelectedWeeklyEvent(null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedWeeklyEvent]);

  const handleRemoveCourse = async (course: ScheduleCourseItem) => {
    if (!id || !schedule) return;
    const key = `${course.courseCode}|${course.sisOfferingName}|${course.term}`;
    const colorKey = normalizeCourseCode(course.courseCode);
    const freedColor = courseColorMap[colorKey];

    // Optimistic updates — remove immediately from list, calendar, and color map
    setSchedule((prev) =>
      prev
        ? { ...prev, courses: prev.courses.filter((c) => !(c.courseCode === course.courseCode && c.sisOfferingName === course.sisOfferingName)) }
        : prev,
    );
    setScheduleCourseIds((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setWeeklyEvents((prev) => prev.filter((e) => normalizeCourseCode(e.courseCode) !== colorKey));
    setCourseColorMap((prev) => {
      const next = { ...prev };
      delete next[colorKey];
      return next;
    });

    try {
      await removeCourse(id, {
        courseCode: course.courseCode,
        sisOfferingName: course.sisOfferingName,
        term: course.term,
      });
      // Free the color slot for the next addition
      if (freedColor) {
        freedColorsQueueRef.current.push(freedColor);
      }
    } catch {
      // Roll back all optimistic updates
      setSchedule((prev) => prev ? { ...prev, courses: [...prev.courses, course] } : prev);
      setScheduleCourseIds((prev) => new Set([...prev, key]));
      void loadWeeklyEvents();
      if (freedColor) {
        setCourseColorMap((prev) => ({ ...prev, [colorKey]: freedColor }));
      }
    }
  };

  const handleAddCourseFromInfo = async (course: CourseCardType) => {
    if (!id) return;
    const payload = {
      courseCode: course.courseCode,
      sisOfferingName: course.sisOfferingName ?? course.courseCode,
      term: course.term ?? schedule?.term ?? "",
      courseTitle: course.courseTitle,
    };
    try {
      await addCourse(id, payload);
      const key = `${payload.courseCode}|${payload.sisOfferingName}|${payload.term}`;
      setScheduleCourseIds((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      setSchedule((prev) => {
        if (!prev) return prev;
        const already = prev.courses.some(
          (c) =>
            c.courseCode === payload.courseCode &&
            c.sisOfferingName === payload.sisOfferingName &&
            c.term === payload.term,
        );
        if (already) return prev;
        return {
          ...prev,
          courses: [...prev.courses, payload],
        };
      });
      assignColorsToNewCourses([payload]);
      void loadWeeklyEvents();
    } catch {
      // keep UI state unchanged on API failure
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    try {
      await deleteSchedule(id);
      navigate("/schedules");
    } finally {
      setDeleting(false);
    }
  };

  const openCreateCustomEvent = (day?: WeeklyScheduleDay | null) => {
    setSelectedWeeklyEvent(null);
    setEditingCustomEventId(null);
    setCustomEventError(null);
    setCustomEventDraft({
      ...DEFAULT_CUSTOM_EVENT_DRAFT,
      dayOfWeek: day ?? "Monday",
    });
    setCustomEventEditorOpen(true);
  };

  const openEditCustomEvent = (event: WeeklyScheduleEvent) => {
    if (event.eventType !== "custom") {
      return;
    }
    setEditingCustomEventId(event.eventId);
    setCustomEventError(null);
    setCustomEventDraft({
      title: event.courseTitle,
      dayOfWeek: event.dayOfWeek ?? "Monday",
      startTime: event.startTime ?? "09:00",
      endTime: event.endTime ?? "10:00",
      location: event.location ?? "",
    });
    setCustomEventEditorOpen(true);
  };

  const closeCustomEventEditor = () => {
    setCustomEventEditorOpen(false);
    setEditingCustomEventId(null);
    setCustomEventError(null);
    setCustomEventDraft(DEFAULT_CUSTOM_EVENT_DRAFT);
  };

  const handleSaveCustomEvent = async () => {
    if (!id) return;
    setCustomEventSaving(true);
    setCustomEventError(null);
    try {
      const payload: CustomScheduleEventBody = {
        ...customEventDraft,
        title: customEventDraft.title.trim(),
        dayOfWeek: customEventDraft.dayOfWeek ?? "Monday",
        startTime: customEventDraft.startTime ?? "09:00",
        endTime: customEventDraft.endTime ?? "10:00",
        location: customEventDraft.location?.trim() || null,
      };
      if (editingCustomEventId) {
        await updateCustomEvent(id, editingCustomEventId, payload);
      } else {
        await createCustomEvent(id, payload);
      }
      closeCustomEventEditor();
      await loadWeeklyEvents();
    } catch (error) {
      setCustomEventError(error instanceof Error ? error.message : "Could not save custom event");
    } finally {
      setCustomEventSaving(false);
    }
  };

  const handleDeleteCustomEvent = async (eventId: string) => {
    if (!id) return;
    setCustomEventSaving(true);
    setCustomEventError(null);
    try {
      await deleteCustomEvent(id, eventId);
      setSelectedWeeklyEvent(null);
      closeCustomEventEditor();
      await loadWeeklyEvents();
    } catch (error) {
      setCustomEventError(error instanceof Error ? error.message : "Could not delete custom event");
    } finally {
      setCustomEventSaving(false);
    }
  };

  const handleOpenCourseInfo = (course: ScheduleCourseItem) => {
    const requestSeq = ++infoRequestSeqRef.current;
    const courseId = toCourseId(course.sisOfferingName || course.courseCode, course.term);
    const cachedEntry = sisDetailsCache.get(courseId);
    const cachedDetails =
      cachedEntry && cachedEntry !== "loading" && cachedEntry !== "error" ? cachedEntry : null;
    const cachedDescription = cachedDetails?.description?.trim() ?? "";
    const cachedInstructors = cachedDetails?.instructors ?? [];
    setSelectedCourseCardData({
      id: courseId,
      courseCode: course.courseCode,
      courseTitle: course.courseTitle || course.courseCode,
      instructor: cachedInstructors[0] || "TBD",
      description: cachedDescription || "Loading description...",
      sisOfferingName: course.sisOfferingName,
      term: course.term,
      sisDetails: cachedDetails || undefined,
    });
    void fetch(apiUrl(`/api/courses/${courseId}/details`), {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as SisCourseDetailsResponse;
      })
      .then(async (payload) => {
        if (requestSeq !== infoRequestSeqRef.current) return;
        const details = payload?.details ?? null;
        let matchedRaw: NonNullable<SisSearchRawResponse["courses"]>[number] | null = null;
        try {
          const searchResponse = await fetch(
            apiUrl(`/api/courses/sis-search-raw?query=${encodeURIComponent(course.courseCode)}&limit=20`),
            {
              credentials: "include",
              headers: { "Content-Type": "application/json" },
            },
          );
          if (searchResponse.ok) {
            const searchPayload = (await searchResponse.json()) as SisSearchRawResponse;
            const candidates = (searchPayload.courses ?? []).filter((candidate) => {
              return (
                (candidate.offeringName ?? "").toUpperCase() ===
                (course.sisOfferingName ?? "").toUpperCase()
              );
            });
            const currentSisTerm = getCurrentSisTerm();
            matchedRaw =
              candidates.find((candidate) => candidate.term === course.term) ??
              candidates.find((candidate) => candidate.term === currentSisTerm) ??
              candidates.find((candidate) => !candidate.term) ??
              candidates[0] ??
              null;
          }
        } catch {
          matchedRaw = null;
        }
        if (requestSeq !== infoRequestSeqRef.current) return;

        // Prefer DB-backed search description first for consistency with
        // course search cards; fall back to SIS details when DB text is absent.
        const description = matchedRaw?.description?.trim() || details?.description?.trim() || "";
        const mergedInstructors =
          (details?.instructors && details.instructors.length > 0
            ? details.instructors
            : matchedRaw?.instructors) ?? [];
        let instructor = mergedInstructors[0] || "TBD";
        let resolvedDescription = description;

        if (!resolvedDescription) {
          try {
            const agentResponse = await fetch(apiUrl("/api/agent"), {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: course.sisOfferingName || course.courseCode }),
            });
            if (agentResponse.ok) {
              const rawAgentPayload = (await agentResponse.json()) as AgentSearchResponse;
              const agentPayload = normalizeAgentApiPayload(rawAgentPayload);
              const results = agentPayload.type === "search" ? agentPayload.results ?? [] : [];
              const matchedAgentRow =
                results.find((row) => {
                  const rowCode = (row.sisOfferingName ?? row.code ?? "").toUpperCase();
                  return rowCode === (course.sisOfferingName ?? course.courseCode).toUpperCase();
                }) ??
                results.find((row) => {
                  return (row.code ?? "").toUpperCase() === course.courseCode.toUpperCase();
                }) ??
                results[0];
              if (matchedAgentRow?.description?.trim()) {
                resolvedDescription = matchedAgentRow.description.trim();
              }
              if (
                (!instructor || instructor === "TBD") &&
                matchedAgentRow?.instructor &&
                matchedAgentRow.instructor.trim().length > 0
              ) {
                instructor = matchedAgentRow.instructor.trim();
              }
            }
          } catch {
            // Keep existing fallbacks.
          }
        }
        if (requestSeq !== infoRequestSeqRef.current) return;

        setSelectedCourseCardData({
          id: courseId,
          courseCode: course.courseCode,
          courseTitle: course.courseTitle || course.courseCode,
          instructor,
          description: resolvedDescription || "No description available",
          sisOfferingName: course.sisOfferingName,
          term: course.term,
          sisDetails: (details || matchedRaw)
            ? {
                offeringName: details?.offeringName ?? matchedRaw?.offeringName ?? course.sisOfferingName,
                sectionName: details?.sectionName ?? matchedRaw?.sectionName ?? "",
                title: details?.title ?? matchedRaw?.title ?? (course.courseTitle || course.courseCode),
                description: details?.description ?? matchedRaw?.description ?? "",
                schoolName: details?.schoolName ?? matchedRaw?.schoolName ?? "",
                department: details?.department ?? matchedRaw?.department ?? "",
                level: details?.level ?? matchedRaw?.level ?? "",
                timeOfDay: details?.timeOfDay ?? matchedRaw?.timeOfDay ?? "",
                daysOfWeek: details?.daysOfWeek ?? matchedRaw?.daysOfWeek ?? "",
                location: details?.location ?? matchedRaw?.location ?? "",
                instructors: mergedInstructors,
                status: details?.status ?? matchedRaw?.status ?? "",
                prerequisites: details?.prerequisites ?? matchedRaw?.prerequisites,
              }
            : undefined,
        });
      })
      .catch(() => {
        if (requestSeq !== infoRequestSeqRef.current) return;
        setSelectedCourseCardData({
          id: courseId,
          courseCode: course.courseCode,
          courseTitle: course.courseTitle || course.courseCode,
          instructor: "TBD",
          description: "No description available",
          sisOfferingName: course.sisOfferingName,
          term: course.term,
        });
      });
  };

  const handleRunAudit = useCallback(async () => {
    if (!id) return;
    setAuditError(null);
    setRunningAudit(true);

    try {
      await runScheduleAudit(id);
      const updated = await getSchedule(id);
      setSchedule(updated);
    } catch (err) {
      const message = toAuditErrorMessage(err);
      setAuditError(message);
    } finally {
      setRunningAudit(false);
    }
  }, [id, runScheduleAudit, getSchedule]);

  const auditView = extractAuditView(schedule?.latestAudit?.result);
  const alignmentBullets = buildAlignmentBullets(auditView.goalAlignment, auditView.findings ?? []);
  const hasAudit = Boolean(schedule?.latestAudit);
  const selectedCourseCard: CourseCardType | null = selectedCourseCardData;

  return (
    <div className="app-root">
      {/* Sub-header */}
      <div className="shrink-0 border-b border-border bg-background px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => navigate("/schedules")}
            aria-label="Back to schedules"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-sm font-semibold leading-tight">
              {schedule?.name ?? "Schedule"}
            </h1>
            <p className="text-xs text-muted-foreground">{schedule?.term ?? ""}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 gap-1.5"
          onClick={() => setShowDeleteConfirm(true)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      </div>

      {/* Main split layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: Calendar (top) + Course list (bottom) */}
        <div
          ref={leftPaneRef}
          className="hidden md:flex flex-col shrink-0 border-r border-border overflow-hidden"
          data-testid="schedule-page-content"
          style={{ width: `${leftPaneWidth}px` }}
        >
          <div className="min-h-0 border-b border-border" style={{ flexBasis: `${calendarPanePercent}%` }}>
            <Calendar
              weeklyEvents={weeklyEvents}
              weeklyEventsLoading={weeklyEventsLoading}
              weeklyEventsError={weeklyEventsError}
              onAddCustomEvent={openCreateCustomEvent}
              onSelectEvent={setSelectedWeeklyEvent}
              onRetryWeeklyEvents={() => {
                void loadWeeklyEvents();
              }}
              courseColorMap={courseColorMap}
            />
          </div>

          <button
            type="button"
            role="separator"
            aria-label="Resize calendar and course list"
            aria-orientation="horizontal"
            className="group relative h-2 shrink-0 cursor-row-resize bg-border/30 transition hover:bg-primary/15"
            onPointerDown={startCalendarResize}
          >
            <span className="absolute left-1/2 top-1/2 h-0.5 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/35 transition group-hover:bg-primary/70" />
          </button>

          <div className="min-h-0 flex-1">
            <CourseList
              schedule={schedule}
              loadError={loadError}
              weeklyEvents={weeklyEvents}
              shortlistStatuses={shortlistStatuses}
              onOpenCourseInfo={handleOpenCourseInfo}
              onRemoveCourse={handleRemoveCourse}
              courseColorMap={courseColorMap}
            />
          </div>
        </div>

        <button
          type="button"
          role="separator"
          aria-label="Resize calendar and chat panes"
          aria-orientation="vertical"
          className="group hidden w-2 shrink-0 cursor-col-resize bg-border/30 transition hover:bg-primary/15 md:block"
          onPointerDown={(event) => startHorizontalResize(event, "left")}
        >
          <span className="mx-auto block h-full w-0.5 rounded-full bg-muted-foreground/30 transition group-hover:bg-primary/70" />
        </button>

        {/* Center: Chat */}
        <div className="min-w-90 flex-1 border-r border-border">
          <Chat
            scheduleId={id ?? ""}
            schedule={schedule}
            loadError={loadError}
            scheduleCourseIds={scheduleCourseIds}
            onScheduleCourseIdsChange={setScheduleCourseIds}
            onScheduleCoursesChanged={refreshScheduleList}
          />
        </div>

        <button
          type="button"
          role="separator"
          aria-label="Resize chat and audit panes"
          aria-orientation="vertical"
          className="group hidden w-2 shrink-0 cursor-col-resize bg-border/30 transition hover:bg-primary/15 md:block"
          onPointerDown={(event) => startHorizontalResize(event, "audit")}
        >
          <span className="mx-auto block h-full w-0.5 rounded-full bg-muted-foreground/30 transition group-hover:bg-primary/70" />
        </button>

        {/* Right: Audit panel */}
        <div className="hidden shrink-0 md:block" style={{ width: `${auditPaneWidth}px` }}>
          <ScheduleAudit
            hasAudit={hasAudit}
            auditError={auditError}
            schedule={schedule}
            runningAudit={runningAudit}
            onRunAudit={handleRunAudit}
            auditView={auditView}
            alignmentBullets={alignmentBullets}
          />
        </div>
      </div>

      {selectedCourseCard && (
        <CourseCard
          course={selectedCourseCard}
          onAddToSchedule={handleAddCourseFromInfo}
          onRemoveFromSchedule={(course) =>
            handleRemoveCourse({
              courseCode: course.courseCode,
              sisOfferingName: course.sisOfferingName ?? course.courseCode,
              term: course.term ?? schedule?.term ?? "",
              courseTitle: course.courseTitle,
            })
          }
          isInSchedule={scheduleCourseIds.has(
            `${selectedCourseCard.courseCode}|${selectedCourseCard.sisOfferingName ?? selectedCourseCard.courseCode}|${selectedCourseCard.term ?? schedule?.term ?? ""}`,
          )}
          isTaken={takenCourseCodes.has(normalizeCourseCode(selectedCourseCard.courseCode))}
          takenCourseCodes={takenCourseCodes}
          hasLoadedTakenCourseHistory={hasLoadedTakenCourseHistory}
          openOnMount
          hideCardShell
          onInfoClose={() => {
            infoRequestSeqRef.current += 1;
            setSelectedCourseCardData(null);
          }}
        />
      )}

      {/* Delete confirm dialog */}

      {/* Delete confirm dialog */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && setShowDeleteConfirm(false)}
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl">
            <h2 className="text-base font-semibold">Delete this schedule?</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{schedule?.name}</span> and all
              its courses will be permanently deleted.
            </p>
            <div className="mt-5 flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {selectedWeeklyEvent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelectedWeeklyEvent(null);
          }}
          data-testid="weekly-event-dialog-overlay"
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="weekly-event-dialog-title"
            data-testid="weekly-event-dialog"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 id="weekly-event-dialog-title" className="text-base font-semibold">
                {selectedWeeklyEvent.eventType === "custom" ? selectedWeeklyEvent.courseTitle : selectedWeeklyEvent.courseCode}
              </h2>
              <button
                ref={detailsCloseRef}
                type="button"
                onClick={() => setSelectedWeeklyEvent(null)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                aria-label="Close weekly event details"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 space-y-2 text-sm">
              <p className="font-medium" data-testid="weekly-event-dialog-course-title">
                {selectedWeeklyEvent.eventType === "custom" ? "Custom event" : selectedWeeklyEvent.courseTitle}
              </p>
              <p>
                <span className="text-muted-foreground">Day: </span>
                <span data-testid="weekly-event-dialog-day">{selectedWeeklyEvent.dayOfWeek ?? "TBD"}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Time: </span>
                <span data-testid="weekly-event-dialog-time">
                  {getCustomEventTimeLabel(selectedWeeklyEvent.startTime, selectedWeeklyEvent.endTime)}
                </span>
              </p>
              <p>
                <span className="text-muted-foreground">Location: </span>
                <span data-testid="weekly-event-dialog-location">{selectedWeeklyEvent.location?.trim() || "Location TBD"}</span>
              </p>
            </div>

            <div className="mt-4 flex gap-2">
              {selectedWeeklyEvent.eventType === "custom" ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => openEditCustomEvent(selectedWeeklyEvent)}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => void handleDeleteCustomEvent(selectedWeeklyEvent.eventId)}
                    disabled={customEventSaving}
                  >
                    Delete
                  </Button>
                </>
              ) : null}
              <Button type="button" variant="outline" onClick={() => setSelectedWeeklyEvent(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {customEventEditorOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeCustomEventEditor();
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">
                {editingCustomEventId ? "Edit custom event" : "Add custom event"}
              </h2>
              <button
                type="button"
                onClick={closeCustomEventEditor}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                aria-label="Close custom event editor"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Title</span>
                <input
                  value={customEventDraft.title}
                  onChange={(event) => setCustomEventDraft((prev) => ({ ...prev, title: event.target.value }))}
                  className="w-full rounded-md border border-border bg-background px-3 py-2"
                  placeholder="Club meeting"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="block space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Day</span>
                  <select
                    aria-label="Day"
                    value={customEventDraft.dayOfWeek ?? "Monday"}
                    onChange={(event) =>
                      setCustomEventDraft((prev) => ({ ...prev, dayOfWeek: event.target.value as WeeklyScheduleDay }))
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2"
                  >
                    {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day) => (
                      <option key={day} value={day}>
                        {day}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="block space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Start</span>
                  <input
                    aria-label="Start"
                    type="time"
                    value={customEventDraft.startTime ?? ""}
                    onChange={(event) =>
                      setCustomEventDraft((prev) => ({
                        ...prev,
                        startTime: event.target.value,
                        endTime: prev.endTime ?? "10:00",
                      }))
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2"
                  />
                </div>
                <div className="block space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">End</span>
                  <input
                    aria-label="End"
                    type="time"
                    value={customEventDraft.endTime ?? ""}
                    onChange={(event) =>
                      setCustomEventDraft((prev) => ({
                        ...prev,
                        endTime: event.target.value,
                        startTime: prev.startTime ?? "09:00",
                      }))
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2"
                  />
                </div>
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Location (optional)</span>
                <input
                  value={customEventDraft.location ?? ""}
                  onChange={(event) => setCustomEventDraft((prev) => ({ ...prev, location: event.target.value }))}
                  className="w-full rounded-md border border-border bg-background px-3 py-2"
                  placeholder="Homewood campus"
                />
              </label>

              {customEventError ? (
                <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {customEventError}
                </p>
              ) : null}
            </div>

            <div className="mt-5 flex items-center justify-between gap-2">
              {editingCustomEventId ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void handleDeleteCustomEvent(editingCustomEventId)}
                  disabled={customEventSaving}
                >
                  Delete
                </Button>
              ) : <div />}
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={closeCustomEventEditor} disabled={customEventSaving}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => void handleSaveCustomEvent()} disabled={customEventSaving}>
                  {customEventSaving ? "Saving…" : editingCustomEventId ? "Save changes" : "Create event"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
