import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  ClipboardList,
  Info,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import ScheduleChat from "@/components/ScheduleChat";
import WeeklyScheduleGrid from "@/components/WeeklyScheduleGrid";
import CourseCard from "@/components/CourseCard";
import { scheduleEventProvider } from "@/lib/schedule-event-provider";
import { apiUrl } from "@/lib/apiUrl";
import { normalizeAgentApiPayload } from "@/lib/parseAgentPayload";
import { useSchedules } from "@/hooks/useSchedules";
import type { CourseCard as CourseCardType } from "@/store/atoms";
import type { SisCourseDetails } from "@/store/atoms";
import type {
  ScheduleAuditResult,
  ScheduleDetail,
  ScheduleCourseItem,
  ScheduleGoalAlignment,
  WeeklyScheduleEvent,
  WeeklyScheduleDay,
  CustomScheduleEventBody,
} from "@/types/schedules";

type MainPanelTab = "weekly" | "chat";
type PrereqOutcome = "fulfilled" | "taken" | "missing prereq" | "override" | "unknown";
type CustomEventDraft = CustomScheduleEventBody;

const DEFAULT_CUSTOM_EVENT_DRAFT: CustomEventDraft = {
  title: "",
  dayOfWeek: null,
  startTime: null,
  endTime: null,
  location: "",
};

function getCustomEventTimeLabel(startTime: string | null, endTime: string | null): string {
  if (startTime && endTime) return `${startTime} - ${endTime}`;
  return "Time TBA";
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

function formatAuditTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function extractAuditView(result: ScheduleAuditResult | null | undefined) {
  if (!result) {
    return {
      workloadRange: null,
      difficulty: null,
      feasibilityLabel: null,
      narrative: null,
      missingData: null,
      goalAlignment: null,
      recommendations: [],
    };
  }

  const workloadRange = result.workloadRange
    ? `${result.workloadRange.min}-${result.workloadRange.max} hrs/week`
    : null;

  return {
    workloadRange,
    difficulty: typeof result.difficulty === "number" ? result.difficulty.toFixed(1) : null,
    feasibilityLabel: result.feasibilityLabel ?? null,
    narrative: result.narrativeSummary?.trim() || null,
    missingData: result.missingEvaluationData?.length
      ? result.missingEvaluationData.join(", ")
      : null,
    goalAlignment: normalizeGoalAlignment(result.goalAlignment),
    recommendations: Array.isArray(result.recommendations) ? result.recommendations : [],
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

  const [schedule, setSchedule] = useState<ScheduleDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showFullAudit, setShowFullAudit] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [runningAudit, setRunningAudit] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [activeMainTab, setActiveMainTab] = useState<MainPanelTab>("chat");
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

  const loadSchedule = useCallback(() => {
    if (!id) return;
    setLoadError(null);
    getSchedule(id)
      .then((data) => {
        setSchedule(data);
        setScheduleCourseIds(toScheduleCourseKeys(data.courses));
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [id, getSchedule]);

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
        return loadWeeklyEvents();
      })
      .catch(() => {});
  }, [id, getSchedule, loadWeeklyEvents]);

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
    try {
      await removeCourse(id, {
        courseCode: course.courseCode,
        sisOfferingName: course.sisOfferingName,
        term: course.term,
      });
      // Targeted removal — avoids overwriting optimistic chat-side adds that
      // haven’t been confirmed by the server yet.
      const key = `${course.courseCode}|${course.sisOfferingName}|${course.term}`;
      setScheduleCourseIds((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      setSchedule((prev) =>
        prev
          ? { ...prev, courses: prev.courses.filter((c) => c.courseCode !== course.courseCode || c.sisOfferingName !== course.sisOfferingName) }
          : prev,
      );
    } catch {
      /* silently fail — course stays in list */
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
      dayOfWeek: day ?? null,
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
      dayOfWeek: event.dayOfWeek,
      startTime: event.startTime,
      endTime: event.endTime,
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
        dayOfWeek: customEventDraft.dayOfWeek,
        startTime: customEventDraft.startTime,
        endTime: customEventDraft.endTime,
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

  const getOutcomeBadgeClass = (outcome: PrereqOutcome): string => {
    if (outcome === "fulfilled") return "border-emerald-300 bg-emerald-100 text-emerald-700";
    if (outcome === "missing prereq") return "border-amber-300 bg-amber-100 text-amber-800";
    if (outcome === "unknown") return "border-slate-300 bg-slate-100 text-slate-700";
    return "border-rose-300 bg-rose-100 text-rose-700";
  };

  const handleOpenCourseInfo = (course: ScheduleCourseItem) => {
    const requestSeq = ++infoRequestSeqRef.current;
    const courseId = toCourseId(course.sisOfferingName || course.courseCode, course.term);
    setSelectedCourseCardData({
      id: courseId,
      courseCode: course.courseCode,
      courseTitle: course.courseTitle || course.courseCode,
      instructor: "TBD",
      description: "Loading description...",
      sisOfferingName: course.sisOfferingName,
      term: course.term,
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
  const lastRunLabel = formatAuditTimestamp(schedule?.latestAudit?.createdAt);
  const hasAudit = Boolean(schedule?.latestAudit);
  const rawAuditResultJson = schedule?.latestAudit
    ? JSON.stringify(schedule.latestAudit.result, null, 2)
    : "{}";
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
            <p className="text-xs text-muted-foreground">{schedule?.term ?? id}</p>
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
        {/* Left: Main tabbed panel (Weekly grid + Chat) */}
        <div className="flex flex-col flex-1 min-w-0 border-r border-border">
          <div className="px-4 pt-4">
            <div
              role="tablist"
              aria-label="Schedule main tabs"
              className="inline-flex rounded-lg border border-border bg-muted/40 p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeMainTab === "chat"}
                className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                  activeMainTab === "chat"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveMainTab("chat")}
              >
                Chat
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeMainTab === "weekly"}
                className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                  activeMainTab === "weekly"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveMainTab("weekly")}
              >
                Weekly Schedule
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 p-4 pt-3">
            {activeMainTab === "weekly" ? (
              <div className="h-full space-y-2">
                <div className="flex items-center justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => openCreateCustomEvent()}
                  >
                    Add custom event
                  </Button>
                </div>
                {weeklyEventsError && (
                  <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    <p>{weeklyEventsError}</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2 h-7 text-xs"
                      onClick={() => {
                        void loadWeeklyEvents();
                      }}
                    >
                      Retry loading events
                    </Button>
                  </div>
                )}
                <WeeklyScheduleGrid
                  events={weeklyEvents}
                  loading={weeklyEventsLoading}
                  onEventSelect={setSelectedWeeklyEvent}
                  onAddEvent={openCreateCustomEvent}
                />
              </div>
            ) : loadError ? (
              <div className="flex h-full items-center justify-center rounded-xl border border-border bg-muted/20 text-sm text-destructive p-8 text-center">
                {loadError}
              </div>
            ) : (
              <ScheduleChat
                scheduleId={id ?? ""}
                scheduleName={schedule?.name}
                scheduleCourseIds={scheduleCourseIds}
                onScheduleCourseIdsChange={setScheduleCourseIds}
                onScheduleCoursesChanged={refreshScheduleList}
              />
            )}
          </div>
        </div>

        {/* Right: Course list + Audit panel */}
        <div
          className="hidden md:flex flex-col w-80 lg:w-96 shrink-0 overflow-hidden"
          data-testid="schedule-page-content"
        >
          {/* Course list */}
          <div className="basis-2/5 min-h-0 border-b border-border p-4 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Courses</h2>
              <span className="ml-auto text-xs text-muted-foreground">
                {schedule ? `${schedule.courses.length} added` : "—"}
              </span>
            </div>

            <div className="min-h-0 overflow-y-auto pr-1">
              {!schedule && !loadError && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}

              {schedule && schedule.courses.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-center rounded-xl border border-dashed border-border bg-muted/30">
                  <BookOpen className="h-6 w-6 text-muted-foreground/50" />
                  <p className="text-xs text-muted-foreground">
                    No courses added yet.
                  </p>
                  <p className="text-xs text-muted-foreground/60">
                    Search in the chat and click the bookmark icon.
                  </p>
                </div>
              )}

              {schedule && schedule.courses.length > 0 && (
                <ul className="space-y-2" data-testid="course-list">
                  {schedule.courses.map((course) => (
                    <li
                      key={`${course.courseCode}-${course.sisOfferingName}`}
                      className="flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2.5"
                      data-testid="course-list-item"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">
                          {(course.courseTitle?.trim() || course.courseCode)}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {course.courseTitle?.trim()
                            ? `${course.courseCode} · ${course.term}`
                            : course.term}
                        </p>
                        {(() => {
                          const key = `${course.courseCode}|${course.sisOfferingName}|${course.term}`;
                          const state = shortlistStatuses[key];
                          if (!state || state.loading) {
                            return (
                              <span className="mt-1 inline-flex rounded border border-border/80 bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Checking prereqs...
                              </span>
                            );
                          }
                          if (!state.outcome) return null;
                          return (
                            <span
                              className={`mt-1 inline-flex rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${getOutcomeBadgeClass(
                                state.outcome,
                              )}`}
                              data-testid="shortlist-prereq-outcome"
                            >
                              {state.outcome === "unknown" ? "status unknown" : state.outcome}
                            </span>
                          );
                        })()}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleOpenCourseInfo(course)}
                          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label={`Course info ${course.courseCode}`}
                          data-testid="shortlist-course-info-button"
                        >
                          <Info className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleRemoveCourse(course)}
                          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`Remove ${course.courseCode}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Audit panel */}
          <div className="basis-3/5 min-h-0 p-4 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Schedule audit</h2>
            </div>
            <div className="rounded-xl border border-border bg-muted/30 p-3.5 min-h-0 overflow-y-auto">
              {!hasAudit && (
                <>
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    className="w-full h-8 text-xs"
                    onClick={handleRunAudit}
                    disabled={!schedule || runningAudit}
                  >
                    {runningAudit ? (
                      <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        Running…
                      </>
                    ) : (
                      "Run workload audit"
                    )}
                  </Button>

                  {auditError && (
                    <p className="mt-2 rounded-md border border-destructive/20 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                      {auditError}
                    </p>
                  )}
                </>
              )}

              {hasAudit && (
                <div className="space-y-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-muted-foreground">
                      {lastRunLabel ? `Last run: ${lastRunLabel}` : "Last run: not yet"}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      onClick={handleRunAudit}
                      disabled={!schedule || runningAudit}
                    >
                      {runningAudit ? (
                        <>
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          Running…
                        </>
                      ) : (
                        <>
                          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                          Re-run workload audit
                        </>
                      )}
                    </Button>
                  </div>

                  {auditError && (
                    <p className="rounded-md border border-destructive/20 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                      {auditError}
                    </p>
                  )}

                  <div className="flex items-center justify-between gap-2 rounded-md bg-background/70 px-2.5 py-2">
                    <span className="text-muted-foreground">Weekly workload</span>
                    <span className="font-medium text-right">{auditView.workloadRange ?? "Not available"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-md bg-background/70 px-2.5 py-2">
                    <span className="text-muted-foreground">Difficulty</span>
                    <span className="font-medium text-right">{auditView.difficulty ?? "Not available"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-md bg-background/70 px-2.5 py-2">
                    <span className="text-muted-foreground">Feasibility</span>
                    <span className="font-medium text-right">{auditView.feasibilityLabel ?? "Not available"}</span>
                  </div>

                  {auditView.missingData && (
                    <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-800 dark:text-amber-200">
                      Missing evaluation data: {auditView.missingData}
                    </p>
                  )}

                  <div className="rounded-md border border-border bg-background/70 px-2.5 py-2">
                    <p className="text-[11px] text-muted-foreground mb-1">Summary</p>
                    <p className="leading-relaxed">{auditView.narrative ?? "No narrative summary returned."}</p>
                  </div>

                  <div className="rounded-md border border-border bg-background/70 px-2.5 py-2">
                    <p className="text-[11px] text-muted-foreground mb-1">Goal Alignment</p>
                    {auditView.goalAlignment ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-muted-foreground">Score</span>
                          <span className="font-medium">
                            {typeof auditView.goalAlignment.score === "number"
                              ? auditView.goalAlignment.score.toFixed(1)
                              : "Insufficient data"}
                          </span>
                        </div>
                        <p className="leading-relaxed">{auditView.goalAlignment.rationale}</p>
                        {auditView.goalAlignment.alignedGoals.length > 0 && (
                          <div>
                            <p className="text-[11px] text-muted-foreground mb-1">Aligned goals</p>
                            <ul className="space-y-1">
                              {auditView.goalAlignment.alignedGoals.map((goal) => (
                                <li key={goal} className="text-[11px] leading-relaxed">- {goal}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {auditView.goalAlignment.conflicts.length > 0 && (
                          <div>
                            <p className="text-[11px] text-muted-foreground mb-1">Conflicts</p>
                            <ul className="space-y-1">
                              {auditView.goalAlignment.conflicts.map((conflict) => (
                                <li key={conflict} className="text-[11px] leading-relaxed">- {conflict}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="leading-relaxed">No goal-alignment analysis returned.</p>
                    )}
                  </div>

                  <div className="rounded-md border border-border bg-background/70 px-2.5 py-2">
                    <p className="text-[11px] text-muted-foreground mb-1">Recommendations</p>
                    {auditView.recommendations.length > 0 ? (
                      <ul className="space-y-2">
                        {auditView.recommendations.map((recommendation) => (
                          <li
                            key={`${recommendation.sisOfferingName}-${recommendation.term}`}
                            className="rounded-md border border-border bg-muted/30 px-2 py-1.5"
                          >
                            <p className="font-medium">{recommendation.title}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {recommendation.courseCode} · {recommendation.sisOfferingName} · {recommendation.term}
                            </p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="leading-relaxed">No grounded alternatives were recommended for this audit.</p>
                    )}
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full h-8 text-xs"
                    onClick={() => setShowFullAudit(true)}
                  >
                    View full audit
                  </Button>
                </div>
              )}
            </div>
          </div>
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
                <span data-testid="weekly-event-dialog-day">{selectedWeeklyEvent.dayOfWeek ?? "TBA"}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Time: </span>
                <span data-testid="weekly-event-dialog-time">
                  {getCustomEventTimeLabel(selectedWeeklyEvent.startTime, selectedWeeklyEvent.endTime)}
                </span>
              </p>
              <p>
                <span className="text-muted-foreground">Location: </span>
                <span data-testid="weekly-event-dialog-location">{selectedWeeklyEvent.location?.trim() || "Location TBA"}</span>
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
                  <label className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={customEventDraft.dayOfWeek == null}
                      onChange={(event) =>
                        setCustomEventDraft((prev) => ({
                          ...prev,
                          dayOfWeek: event.target.checked ? null : (prev.dayOfWeek ?? "Monday"),
                        }))
                      }
                    />
                    Day TBA
                  </label>
                  <select
                    aria-label="Day"
                    value={customEventDraft.dayOfWeek ?? "Monday"}
                    onChange={(event) =>
                      setCustomEventDraft((prev) => ({ ...prev, dayOfWeek: event.target.value as WeeklyScheduleDay }))
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2"
                    disabled={customEventDraft.dayOfWeek == null}
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
                  <label className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={customEventDraft.startTime == null && customEventDraft.endTime == null}
                      onChange={(event) =>
                        setCustomEventDraft((prev) => ({
                          ...prev,
                          startTime: event.target.checked ? null : (prev.startTime ?? "09:00"),
                          endTime: event.target.checked ? null : (prev.endTime ?? "10:00"),
                        }))
                      }
                    />
                    Time TBA
                  </label>
                  <input
                    aria-label="Start"
                    type="time"
                    value={customEventDraft.startTime ?? ""}
                    onChange={(event) =>
                      setCustomEventDraft((prev) => ({
                        ...prev,
                        startTime: event.target.value || null,
                        endTime: prev.endTime ?? "10:00",
                      }))
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2"
                    disabled={customEventDraft.startTime == null && customEventDraft.endTime == null}
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
                        endTime: event.target.value || null,
                        startTime: prev.startTime ?? "09:00",
                      }))
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2"
                    disabled={customEventDraft.startTime == null && customEventDraft.endTime == null}
                  />
                </div>
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Location</span>
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

      {showFullAudit && hasAudit && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
          onClick={(e) => e.target === e.currentTarget && setShowFullAudit(false)}
        >
          <div className="w-full max-w-xl max-h-[80vh] overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Schedule audit</h2>
              <button
                type="button"
                onClick={() => setShowFullAudit(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                aria-label="Close full audit"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-1 text-xs text-muted-foreground">
              {lastRunLabel ? `Last run: ${lastRunLabel}` : "Last run: not yet"}
            </p>

            <div className="mt-4 space-y-3">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <h3 className="text-xs font-semibold">Narrative summary</h3>
                <p className="mt-1.5 text-sm leading-relaxed">
                  {auditView.narrative ?? "No narrative summary returned."}
                </p>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <h3 className="text-xs font-semibold">Goal Alignment</h3>
                {auditView.goalAlignment ? (
                  <div className="mt-2 space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Score</span>
                      <span>
                        {typeof auditView.goalAlignment.score === "number"
                          ? auditView.goalAlignment.score.toFixed(1)
                          : "Insufficient data"}
                      </span>
                    </div>
                    <p>{auditView.goalAlignment.rationale}</p>
                    {auditView.goalAlignment.alignedGoals.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground">Aligned goals</p>
                        <ul className="mt-1 space-y-1">
                          {auditView.goalAlignment.alignedGoals.map((goal) => (
                            <li key={goal}>- {goal}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {auditView.goalAlignment.conflicts.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground">Conflicts</p>
                        <ul className="mt-1 space-y-1">
                          {auditView.goalAlignment.conflicts.map((conflict) => (
                            <li key={conflict}>- {conflict}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="mt-1.5 text-sm leading-relaxed">No goal-alignment analysis returned.</p>
                )}
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <h3 className="text-xs font-semibold">Recommendations</h3>
                {auditView.recommendations.length > 0 ? (
                  <ul className="mt-2 space-y-2 text-sm">
                    {auditView.recommendations.map((recommendation) => (
                      <li
                        key={`${recommendation.sisOfferingName}-${recommendation.term}`}
                        className="rounded-md border border-border bg-background px-2 py-2"
                      >
                        <p className="font-medium">{recommendation.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {recommendation.courseCode} · {recommendation.sisOfferingName} · {recommendation.term}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1.5 text-sm leading-relaxed">
                    No grounded alternatives were recommended for this audit.
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <h3 className="text-xs font-semibold">Metrics</h3>
                <ul className="mt-2 space-y-2 text-sm">
                  <li className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Weekly workload</span>
                    <span>{auditView.workloadRange ?? "Not available"}</span>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Difficulty</span>
                    <span>{auditView.difficulty ?? "Not available"}</span>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Feasibility</span>
                    <span>{auditView.feasibilityLabel ?? "Not available"}</span>
                  </li>
                </ul>
              </div>

              {auditView.missingData && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <h3 className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                    Missing evaluation data
                  </h3>
                  <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
                    {auditView.missingData}
                  </p>
                </div>
              )}

              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <h3 className="text-xs font-semibold">Raw audit result</h3>
                <pre className="mt-2 overflow-x-auto rounded-md bg-background p-2 text-[11px] leading-relaxed text-muted-foreground">
                  {rawAuditResultJson}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
