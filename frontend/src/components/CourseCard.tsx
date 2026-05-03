import { useEffect, useState } from "react";
import { BookmarkPlus, BookmarkCheck, CircleCheck, Plus, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import PrereqOutcomeTag from "@/components/PrereqOutcomeTag";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveCourseId } from "@/lib/courseId";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CourseCard as CourseCardType, SisCourseDetails } from "@/store/atoms";
import { useApi } from "@/hooks/useApi";
import { useSisDetailsCache } from "@/hooks/useSisDetailsCache";
import { ensureCatalogCourseCode } from "@/lib/catalogCourseCode";

const sisDetailsCache = new Map<string, SisCourseDetails>();

interface CourseCardProps {
  course: CourseCardType;
  onSelect?: (courseId: string) => void;
  onAddToSchedule?: (course: CourseCardType) => void;
  onRemoveFromSchedule?: (course: CourseCardType) => void;
  isInSchedule?: boolean;
  selectionMode?: boolean;
  selectionSelected?: boolean;
  onSelectOption?: (course: CourseCardType) => void;
  isTaken?: boolean;
  takenCourseCodes?: Set<string>;
  hasLoadedTakenCourseHistory?: boolean;
  openOnMount?: boolean;
  hideCardShell?: boolean;
  onInfoClose?: () => void;
}


export default function CourseCard({
  course,
  onSelect,
  onAddToSchedule,
  onRemoveFromSchedule,
  isInSchedule = false,
  selectionMode = false,
  selectionSelected = false,
  onSelectOption,
  isTaken = false,
  takenCourseCodes,
  hasLoadedTakenCourseHistory = true,
  openOnMount = false,
  hideCardShell = false,
  onInfoClose,
}: CourseCardProps) {
  const { getSisCourseDetails, sisDetailsLoading, getCourseSummary, summaryLoading } = useApi();
  const { cache, prefetchSisDetails } = useSisDetailsCache();
  const detailsCourseId = resolveCourseId({
    courseId: course.id,
    sisOfferingName: course.sisOfferingName,
    term: course.term,
  });
  const hasDetailsCourseId = detailsCourseId !== null;

  const cachedEntry = detailsCourseId ? cache.get(detailsCourseId) : undefined;
  const cachedDetails: SisCourseDetails | null =
    cachedEntry && cachedEntry !== 'loading' && cachedEntry !== 'error' ? cachedEntry : null;
  const isCachePrefetching = cachedEntry === 'loading';

  const displayInstructor: string | null =
    (course.instructor && course.instructor !== 'TBD')
      ? course.instructor
      : cachedDetails?.instructors?.length
        ? cachedDetails.instructors.join(', ')
        : null;

  const [sisDetails, setSisDetails] = useState<SisCourseDetails | null>(
    course.sisDetails || (detailsCourseId ? sisDetailsCache.get(detailsCourseId) : null) || null
  );

  const displayCredits: number | undefined =
    course.credits ??
    sisDetails?.credits ??
    cachedDetails?.credits ??
    course.sisDetails?.credits;

  const [showInfo, setShowInfo] = useState(false);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [summarySourceData, setSummarySourceData] = useState<Array<{
    term: string | null;
    instructor: string | null;
    metricName: string;
    metricLabel: string;
    metricValue: number;
    respondentCount: number | null;
  }>>([]);
  const [summarySourceCount, setSummarySourceCount] = useState<number>(0);
  const [summarySourceTotalCount, setSummarySourceTotalCount] = useState<number>(0);
  const [summarySourceTruncated, setSummarySourceTruncated] = useState<boolean>(false);
  const [showRawSummaryData, setShowRawSummaryData] = useState<boolean>(false);
  const [sisDetailsErrorMessage, setSisDetailsErrorMessage] = useState<string | null>(null);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [showSisDetails, setShowSisDetails] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [isSummaryRequestInFlight, setIsSummaryRequestInFlight] = useState(false);
  const [showAddWarningDialog, setShowAddWarningDialog] = useState(false);
  const [missingPrereqCodes, setMissingPrereqCodes] = useState<string[]>([]);
  const [overridePrereqCodes, setOverridePrereqCodes] = useState<string[]>([]);
  const [cardPrereqOutcome, setCardPrereqOutcome] = useState<
    "fulfilled" | "taken" | "missing prereq" | "override" | null
  >(isTaken ? "taken" : null);
  const [cardPrereqLoading, setCardPrereqLoading] = useState<boolean>(!isTaken);
  const primaryDescription = course.description?.trim();
  const displayDescription =
    primaryDescription && primaryDescription !== "No description available"
      ? primaryDescription
      : sisDetails?.description?.trim() || "No description available";

  const normalizeCourseCode = (value: string): string => {
    return ensureCatalogCourseCode(value).trim().toUpperCase();
  };

  const isPrerequisiteOperatorToken = (token: string): boolean =>
    token === "AND" || token === "OR" || token === "NOT";

  const isPrerequisiteCodeToken = (token: string): boolean =>
    /^(AS|EN)[\s.]?\d{3}[\s.]?\d{3}$/.test(token);

  const normalizeMatchedCourseCode = (value: string): string => {
    const compact = value.trim().toUpperCase().replace(/\s+/g, ".");
    const normalized = compact.match(/^(AS|EN)\.(\d{3})\.(\d{3})$/);
    if (!normalized) {
      return compact;
    }
    return `${normalized[1]}.${normalized[2]}.${normalized[3]}`;
  };

  type PrerequisiteToken = { token: string; type: "code" | "operator" | "paren" };

  const ensureLineHasAndConnectors = (tokens: PrerequisiteToken[]): PrerequisiteToken[] => {
    const output: PrerequisiteToken[] = [];
    tokens.forEach((entry, index) => {
      const previous = output[output.length - 1];
      const shouldInsertAnd =
        index > 0 &&
        previous &&
        previous.type === "code" &&
        entry.type === "code";
      if (shouldInsertAnd) {
        output.push({ token: "AND", type: "operator" });
      }
      output.push(entry);
    });
    return output;
  };

  const parsePrerequisiteLine = (line: string): PrerequisiteToken[] => {
    const tokenPattern = /\b(?:AS|EN)[\s.]?\d{3}[\s.]?\d{3}\b|\bAND\b|\bOR\b|\bNOT\b|[()]/gi;
    const tokens: PrerequisiteToken[] = [];
    const matches = [...line.matchAll(tokenPattern)];
    for (const match of matches) {
      const rawToken = match[0] ?? "";
      const upperToken = rawToken.toUpperCase();
      if (isPrerequisiteCodeToken(upperToken)) {
        tokens.push({ token: normalizeCourseCode(normalizeMatchedCourseCode(upperToken)), type: "code" });
      } else if (isPrerequisiteOperatorToken(upperToken)) {
        tokens.push({ token: upperToken, type: "operator" });
      } else if (upperToken === "(" || upperToken === ")") {
        tokens.push({ token: upperToken, type: "paren" });
      }
    }
    return ensureLineHasAndConnectors(tokens);
  };

  const formatPrerequisiteLines = (prerequisites: string | undefined): PrerequisiteToken[][] => {
    if (!prerequisites?.trim()) return [];
    return prerequisites
      .split(/[\n;]+/)
      .map((line) => parsePrerequisiteLine(line))
      .filter((lineTokens) => lineTokens.length > 0);
  };

  type ExprNode =
    | { kind: "code"; code: string }
    | { kind: "not"; child: ExprNode }
    | { kind: "and"; left: ExprNode; right: ExprNode }
    | { kind: "or"; left: ExprNode; right: ExprNode };

  const parseExpressionTokens = (tokens: PrerequisiteToken[]): ExprNode | null => {
    const relevant = tokens.filter(
      (token) => token.type === "code" || token.type === "operator" || token.type === "paren",
    );
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
      (relevant[relevant.length - 1].token === "AND" ||
        relevant[relevant.length - 1].token === "OR" ||
        relevant[relevant.length - 1].token === "NOT")
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
  };

  const evaluateExpressionNode = (node: ExprNode, takenCodes: Set<string>): boolean => {
    if (node.kind === "code") return takenCodes.has(normalizeCourseCode(node.code));
    if (node.kind === "not") return !evaluateExpressionNode(node.child, takenCodes);
    if (node.kind === "and") return evaluateExpressionNode(node.left, takenCodes) && evaluateExpressionNode(node.right, takenCodes);
    return evaluateExpressionNode(node.left, takenCodes) || evaluateExpressionNode(node.right, takenCodes);
  };

  const collectNegatedCodes = (node: ExprNode, negated = false, out = new Set<string>()): Set<string> => {
    if (node.kind === "code") {
      if (negated) out.add(normalizeCourseCode(node.code));
      return out;
    }
    if (node.kind === "not") return collectNegatedCodes(node.child, !negated, out);
    collectNegatedCodes(node.left, negated, out);
    collectNegatedCodes(node.right, negated, out);
    return out;
  };

  const collectPositiveCodes = (node: ExprNode, negated = false, out = new Set<string>()): Set<string> => {
    if (node.kind === "code") {
      if (!negated) out.add(normalizeCourseCode(node.code));
      return out;
    }
    if (node.kind === "not") return collectPositiveCodes(node.child, !negated, out);
    collectPositiveCodes(node.left, negated, out);
    collectPositiveCodes(node.right, negated, out);
    return out;
  };

  const closeInfoModal = () => {
    setShowInfo(false);
    setShowRawSummaryData(false);
    onInfoClose?.();
  };

  const shouldWarnBeforeAdd =
    cardPrereqLoading || !cardPrereqOutcome || cardPrereqOutcome !== "fulfilled";

  const warningDescription = (() => {
    if (isTaken || cardPrereqOutcome === "taken") {
      return "This course is already taken. Still want to add it to shortlist?";
    }
    if (cardPrereqLoading || !cardPrereqOutcome) {
      return "Prerequisite check is still running. Still want to add this course to shortlist?";
    }
    if (cardPrereqOutcome === "override") {
      if (overridePrereqCodes.length > 0) {
        return `Override issue: blocked course(s) already taken: ${overridePrereqCodes.join(", ")}. Still want to add it to shortlist?`;
      }
      return "Override issue detected for prerequisites. Still want to add it to shortlist?";
    }
    if (cardPrereqOutcome === "missing prereq") {
      if (missingPrereqCodes.length > 0) {
        return `Missing prerequisite course(s): ${missingPrereqCodes.join(", ")}. Still want to add it to shortlist?`;
      }
      return "Some prerequisites are not met. Still want to add it to shortlist?";
    }
    return "There are prerequisite issues for this course. Still want to add it to shortlist?";
  })();

  const requestAddToSchedule = () => {
    if (!onAddToSchedule) return;
    if (shouldWarnBeforeAdd) {
      setShowAddWarningDialog(true);
      return;
    }
    onAddToSchedule(course);
  };

  const canAddToSchedule = Boolean(onAddToSchedule);
  const canRemoveFromSchedule = Boolean(onRemoveFromSchedule);
  const currentScheduleActionAvailable = isInSchedule
    ? canRemoveFromSchedule
    : canAddToSchedule;

  const handleScheduleToggleClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (isInSchedule) {
      onRemoveFromSchedule?.(course);
      return;
    }
    requestAddToSchedule();
  };

  useEffect(() => {
    if (detailsCourseId) void prefetchSisDetails(detailsCourseId);
  }, [detailsCourseId, prefetchSisDetails]);

  useEffect(() => {
    if (showInfo && cachedDetails) {
      setSisDetails(cachedDetails);
      setShowSisDetails(true);
    }
  }, [showInfo, cachedDetails]);

  useEffect(() => {
    if (openOnMount) {
      setShowInfo(true);
      setShowFullDescription(false);
      setShowSisDetails(false);
      setShowSummary(false);
      setShowRawSummaryData(false);
      onSelect?.(course.id);
    }
  }, [course.id, onSelect, openOnMount]);

  useEffect(() => {
    // Escape closes the top-most modal first (raw data, then course info).
    if (!showInfo) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.stopPropagation();
      if (showRawSummaryData) {
        setShowRawSummaryData(false);
        return;
      }

      closeInfoModal();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showInfo, showRawSummaryData]);

  const isPlaceholder = course.id === "placeholder";
  const handleSummarize = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (summaryText) {
      setShowSummary((prev) => !prev);
      return;
    }

    if (summaryLoading || isSummaryRequestInFlight) {
      return;
    }

    const courseCode = course.courseCode !== "N/A" ? course.courseCode : course.id;
    setIsSummaryRequestInFlight(true);
    try {
      const result = await getCourseSummary(courseCode);
      setSummaryText(result?.summary ?? "No evaluation data found for this course.");
      setSummarySourceData(result?.sourceData ?? []);
      setSummarySourceCount(result?.sourceData.length ?? 0);
      setSummarySourceTotalCount(result?.sourceDataMeta.totalDataPoints ?? 0);
      setSummarySourceTruncated(result?.sourceDataMeta.truncated ?? false);
      setShowSummary(true);
    } catch {
      setSummaryText("Failed to load evaluation summary.");
      setSummarySourceData([]);
      setSummarySourceCount(0);
      setSummarySourceTotalCount(0);
      setSummarySourceTruncated(false);
      setShowSummary(true);
    } finally {
      setIsSummaryRequestInFlight(false);
    }
  };

  const formatRawMetricLabel = (metricLabel: string, metricName: string) => {
    const normalizedLabel = metricLabel.trim();
    if (normalizedLabel.length > 0) {
      return normalizedLabel;
    }
    const normalizedName = metricName.trim();
    return normalizedName.length > 0 ? normalizedName : "N/A";
  };

  const formatRawMetricValue = (metricValue: number) => {
    return Number.isFinite(metricValue) ? metricValue.toFixed(2) : "N/A";
  };

  const formatRawText = (value: string | null | undefined) => {
    if (typeof value !== "string") {
      return "N/A";
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : "N/A";
  };

  const handleLoadDetails = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSisDetailsErrorMessage(null);

    if (sisDetails) {
      setShowSisDetails((prev) => !prev);
      return;
    }

    if (!detailsCourseId) {
      setSisDetailsErrorMessage("Missing course ID for full details.");
      return;
    }

    const cachedDetails = sisDetailsCache.get(detailsCourseId);
    if (cachedDetails) {
      setSisDetails(cachedDetails);
      setShowSisDetails(true);
      return;
    }

    try {
      const response = await getSisCourseDetails(detailsCourseId);
      if (response?.details) {
        setSisDetails(response.details);
        sisDetailsCache.set(detailsCourseId, response.details);
        setShowSisDetails(true);
      } else {
        setSisDetailsErrorMessage("No additional SIS details were returned for this course.");
      }
    } catch {
      setSisDetailsErrorMessage("Failed to load full course details.");
    }
  };

  const parsedPrerequisites = formatPrerequisiteLines(sisDetails?.prerequisites);
  const takenCodesForEval = takenCourseCodes ?? new Set<string>();
  const parsedPrereqExpressions = parsedPrerequisites
    .map((line) => parseExpressionTokens(line))
    .filter((node): node is ExprNode => node !== null);
  const negatedPrereqCodes = new Set<string>();
  parsedPrereqExpressions.forEach((node) => {
    collectNegatedCodes(node, false, negatedPrereqCodes);
  });
  const hasPrereqExpression = parsedPrereqExpressions.length > 0;
  const allPrereqMet =
    !hasPrereqExpression ||
    parsedPrereqExpressions.every((node) => evaluateExpressionNode(node, takenCodesForEval));
  const hasOverride = Array.from(negatedPrereqCodes).some((code) => takenCodesForEval.has(code));
  const prerequisiteOutcome: "fulfilled" | "taken" | "missing prereq" | "override" = isTaken
    ? "taken"
    : hasOverride
      ? "override"
      : allPrereqMet
        ? "fulfilled"
        : "missing prereq";

  useEffect(() => {
    if (isTaken) {
      setCardPrereqOutcome("taken");
      setCardPrereqLoading(false);
      setMissingPrereqCodes([]);
      setOverridePrereqCodes([]);
      return;
    }

    if (!hasLoadedTakenCourseHistory) {
      setCardPrereqLoading(true);
      return;
    }

    let cancelled = false;
    const runPrereqCheck = async () => {
      setCardPrereqLoading(true);
      const takenForEval = takenCourseCodes ?? new Set<string>();
      try {
        let details = sisDetailsCache.get(course.id) ?? null;
        if (!details) {
          const response = await getSisCourseDetails(course.id);
          details = response?.details ?? null;
          if (details) {
            sisDetailsCache.set(course.id, details);
          }
        }

        const lines = formatPrerequisiteLines(details?.prerequisites);
        const expressionNodes = lines
          .map((line) => parseExpressionTokens(line))
          .filter((node): node is ExprNode => node !== null);
        const negatedCodes = new Set<string>();
        const positiveCodes = new Set<string>();
        expressionNodes.forEach((node) => {
          collectNegatedCodes(node, false, negatedCodes);
          collectPositiveCodes(node, false, positiveCodes);
        });
        const hasExpression = expressionNodes.length > 0;
        const allMet =
          !hasExpression || expressionNodes.every((node) => evaluateExpressionNode(node, takenForEval));
        const overrideCodes = Array.from(negatedCodes).filter((code) => takenForEval.has(code));
        const missingCodes = Array.from(positiveCodes).filter((code) => !takenForEval.has(code));
        const override = overrideCodes.length > 0;
        const outcome: "fulfilled" | "taken" | "missing prereq" | "override" = override
          ? "override"
          : allMet
            ? "fulfilled"
            : "missing prereq";

        if (!cancelled) {
          setMissingPrereqCodes(outcome === "missing prereq" ? missingCodes : []);
          setOverridePrereqCodes(outcome === "override" ? overrideCodes : []);
          setCardPrereqOutcome(outcome);
          setCardPrereqLoading(false);
        }
      } catch {
        if (!cancelled) {
          setMissingPrereqCodes([]);
          setOverridePrereqCodes([]);
          setCardPrereqOutcome("missing prereq");
          setCardPrereqLoading(false);
        }
      }
    };

    void runPrereqCheck();
    return () => {
      cancelled = true;
    };
  }, [course.id, getSisCourseDetails, hasLoadedTakenCourseHistory, isTaken, takenCourseCodes]);

  if (isPlaceholder) {
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <span>🚧</span> {course.courseTitle}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {course.description}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {!hideCardShell && (
      <Card
        className="@container group h-full w-full min-w-0 cursor-pointer border border-border bg-card transition-all hover:-translate-y-0.5 hover:shadow-md"
        onClick={() => {
          setShowInfo(true);
          setShowFullDescription(false);
          setShowSisDetails(false);
          setShowSummary(false);
          setShowRawSummaryData(false);
          onSelect?.(course.id);
        }}
      >
        <CardHeader className="min-w-0 px-3 py-2 @min-[480px]:py-1.5 @min-[640px]:py-1">
          {/* Narrow: title block, then instructor + badges row. Wide: one row with dividers; compact vertical padding when wide */}
          <div className="flex min-w-0 w-full flex-col gap-2 @min-[360px]:flex-row @min-[360px]:items-start @min-[360px]:gap-0 @min-[360px]:divide-x @min-[360px]:divide-border/30 @min-[480px]:items-center">
            {/* Title + course code (+ credits inline when card is wide; term stays in details modal) */}
            <div className="min-w-0 w-full flex-1 overflow-hidden @min-[360px]:pr-2">
              <div className="flex min-w-0 flex-col gap-0.5 @min-[480px]:flex-row @min-[480px]:items-center @min-[480px]:gap-x-2 @min-[560px]:gap-x-3">
                <CardTitle className="line-clamp-2 min-w-0 wrap-break-word text-[12px] font-semibold leading-tight @min-[480px]:flex-1 @min-[520px]:line-clamp-1">
                  {course.courseCode} {course.courseTitle}
                </CardTitle>
                <div className="flex shrink-0 flex-col gap-0.5 text-xs text-muted-foreground @min-[480px]:max-w-44 @min-[480px]:items-end @min-[480px]:text-right @min-[600px]:max-w-52">
                  <p className="truncate whitespace-nowrap text-[11px] tabular-nums leading-snug">
                    {displayCredits != null && displayCredits !== undefined ? (
                      <>
                        {displayCredits} {displayCredits === 1 ? "credit" : "credits"}
                      </>
                    ) : (
                      <span className="opacity-30">—</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex min-w-0 w-full items-start gap-2 @min-[360px]:contents">
              {/* Instructor — full width when stacked; grows with card width in row layout */}
              <span className="t-caption min-w-0 flex-1 px-0 leading-snug text-muted-foreground @min-[360px]:w-24 @min-[360px]:shrink-0 @min-[360px]:flex-none @min-[360px]:px-2 @min-[360px]:wrap-break-word @min-[520px]:line-clamp-1 @min-[520px]:w-32 @min-[640px]:w-44 @min-[840px]:min-w-44 @min-[840px]:max-w-[20rem] @min-[840px]:w-auto">
                {displayInstructor ?? (
                  isCachePrefetching
                    ? <span className="inline-block mt-0.5 h-2 w-14 animate-pulse rounded bg-current opacity-20" />
                    : <span className="opacity-30">—</span>
                )}
              </span>

              {/* Prereq badge — fixed w-16 */}
              <span className="flex w-16 shrink-0 items-center justify-center px-2 @min-[480px]:py-0">
                {cardPrereqLoading ? (
                  <PrereqOutcomeTag
                    outcome="loading"
                    testId="card-prereq-outcome-loading"
                    className="animate-pulse opacity-50"
                  />
                ) : (
                  cardPrereqOutcome && (
                    <PrereqOutcomeTag
                      outcome={cardPrereqOutcome}
                      testId="card-prereq-outcome"
                    />
                  )
                )}
              </span>
              {/* Action button */}
              {(selectionMode || onAddToSchedule || onRemoveFromSchedule) && (
              <span className="flex shrink-0 items-center py-2 pl-2 @min-[360px]:py-1 @min-[360px]:pl-10">
                <Button
                  variant="ghost"
                  size="icon"
                  className="group/check h-7 w-7 [&_svg]:size-5 bg-transparent hover:bg-neutral-200 active:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                  aria-label={
                    selectionMode
                      ? selectionSelected
                        ? "Deselect course option"
                        : "Select course option"
                      : isInSchedule
                        ? "Remove from schedule"
                        : "Add to schedule"
                  }
                  title={
                    selectionMode
                      ? selectionSelected
                        ? "Deselect course option"
                        : "Select course option"
                      : isInSchedule
                        ? "Remove from schedule"
                        : "Add to schedule"
                  }
                  aria-pressed={selectionMode ? selectionSelected : undefined}
                  disabled={selectionMode ? !onSelectOption : !currentScheduleActionAvailable}
                  onClick={(e) => {
                    if (selectionMode) { e.stopPropagation(); onSelectOption?.(course); return; }
                    handleScheduleToggleClick(e);
                  }}
                >
                  {selectionMode ? (
                    <CircleCheck
                      className={
                        selectionSelected
                          ? "text-emerald-800 transition-all [&>circle]:fill-emerald-800 [&>circle]:stroke-emerald-800 [&>path]:stroke-emerald-50"
                          : "text-muted-foreground/70 transition-all group-hover/check:text-emerald-600 group-hover/check:fill-emerald-600/20"
                      }
                    />
                  ) : isInSchedule ? (
                    <BookmarkCheck className="text-primary" />
                  ) : (
                    <BookmarkPlus />
                  )}
                </Button>
              </span>
            )}
            </div>
          </div>
        </CardHeader>
      </Card>
      )}

      {showInfo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={closeInfoModal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="course-info-title"
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 id="course-info-title" className="text-lg font-semibold">
                  <span className="text-muted-foreground">{course.courseCode}</span>{" "}
                  {course.courseTitle}
                </h2>
                {(((course.term ?? "").trim().length > 0) || displayCredits != null) && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {[
                      (course.term ?? "").trim() || null,
                      displayCredits != null && displayCredits !== undefined
                        ? `${displayCredits} ${displayCredits === 1 ? "credit" : "credits"}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
              {(onAddToSchedule || onRemoveFromSchedule) && (
                <Button
                  variant={isInSchedule ? "secondary" : "outline"}
                  size="sm"
                  className="shrink-0"
                  onClick={handleScheduleToggleClick}
                  disabled={!currentScheduleActionAvailable}
                  data-testid="modal-shortlist-button"
                >
                  {isInSchedule ? (
                    <>
                      <BookmarkCheck className="mr-1.5 h-4 w-4" />
                      Remove from shortlist
                    </>
                  ) : (
                    <>
                      <BookmarkPlus className="mr-1.5 h-4 w-4" />
                      Add to shortlist
                    </>
                  )}
                </Button>
              )}
            </div>
            
            <div className="mt-4">
              <h3 className="text-sm font-medium">Description</h3>
              <p className={`mt-1 text-sm text-muted-foreground ${showFullDescription ? "" : "line-clamp-3"}`}>
                {displayDescription}
              </p>
              {displayDescription.length > 180 && (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto px-0 py-1 text-sm"
                  onClick={() => setShowFullDescription((prev) => !prev)}
                >
                  {showFullDescription ? "less" : "more"}
                </Button>
              )}
            </div>

            {course.matchReasoning && course.preferenceAlignment !== "mismatch" && (
              <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
                <span className="font-medium">Why this matches:</span>
                <p>{course.matchReasoning}</p>
              </div>
            )}

            <div className="mt-4 space-y-2">
              {(!sisDetails || !showSisDetails) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={handleLoadDetails}
                  disabled={sisDetailsLoading || !hasDetailsCourseId}
                >
                  {sisDetailsLoading ? (
                    "Loading full details..."
                  ) : (
                    <>
                      <Plus className="mr-2 h-4 w-4" />
                      {sisDetails ? "Show full course details" : "Load full course details"}
                    </>
                  )}
                </Button>
              )}
              {sisDetailsErrorMessage && (
                <p className="text-sm text-destructive">{sisDetailsErrorMessage}</p>
              )}
              {sisDetails && showSisDetails && (
                <div className="p-3 text-sm">
                  <h4 className="text-sm font-semibold">Full Course Details</h4>
                  <div className="mt-2 grid gap-2">
                    {sisDetails.level && (
                      <div>
                        <span className="font-medium">Level:</span>{" "}
                        <span className="text-muted-foreground">{sisDetails.level}</span>
                      </div>
                    )}
                    {sisDetails.schoolName && (
                      <div>
                        <span className="font-medium">School:</span>{" "}
                        <span className="text-muted-foreground">{sisDetails.schoolName}</span>
                      </div>
                    )}
                    {sisDetails.department && (
                      <div>
                        <span className="font-medium">Department:</span>{" "}
                        <span className="text-muted-foreground">{sisDetails.department}</span>
                      </div>
                    )}
                    {sisDetails.instructors.length > 0 && (
                      <div>
                        <span className="font-medium">Instructors:</span>{" "}
                        <span className="text-muted-foreground">{sisDetails.instructors.join(", ")}</span>
                      </div>
                    )}
                    {sisDetails.timeOfDay && (
                      <div>
                        <span className="font-medium">Time:</span>{" "}
                        <span className="text-muted-foreground">{sisDetails.timeOfDay}</span>
                      </div>
                    )}
                    {sisDetails.daysOfWeek && (
                      <div>
                        <span className="font-medium">Days:</span>{" "}
                        <span className="text-muted-foreground">{sisDetails.daysOfWeek}</span>
                      </div>
                    )}
                    {sisDetails.location && (
                      <div>
                        <span className="font-medium">Location:</span>{" "}
                        <span className="text-muted-foreground">{sisDetails.location}</span>
                      </div>
                    )}
                    {sisDetails.status && (
                      <div>
                        <span className="font-medium">Status:</span>{" "}
                        <span className="text-muted-foreground">{sisDetails.status}</span>
                      </div>
                    )}
                    <div>
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium">Prerequisites:</span>
                        {parsedPrerequisites.length > 0 && (
                          <PrereqOutcomeTag
                            outcome={prerequisiteOutcome}
                            className="w-fit"
                            testId="prereq-outcome"
                          />
                        )}
                      </span>{" "}
                      {parsedPrerequisites.length > 0 ? (
                        <span className="mt-1 grid gap-1">
                          {parsedPrerequisites.map((line, lineIndex) => (
                            <span
                              key={`prereq-line-${lineIndex}`}
                              className="inline-flex flex-wrap items-center gap-1"
                              data-testid="prereq-option-line"
                            >
                              {line.map((entry, tokenIndex) => {
                                if (entry.type === "operator") {
                                  return (
                                    <span
                                      key={`prereq-op-${lineIndex}-${tokenIndex}`}
                                      className="rounded border border-border/80 bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground"
                                      data-testid="prereq-operator-token"
                                    >
                                      {entry.token}
                                    </span>
                                  );
                                }
                                if (entry.type === "paren") {
                                  return (
                                    <span
                                      key={`prereq-paren-${lineIndex}-${tokenIndex}`}
                                      className="px-0.5 text-[11px] font-semibold text-muted-foreground"
                                    >
                                      {entry.token}
                                    </span>
                                  );
                                }
                                const hasTakenSet = Boolean(takenCourseCodes);
                                const taken = hasTakenSet
                                  ? takenCourseCodes?.has(normalizeCourseCode(entry.token)) ?? false
                                  : false;
                                const isNegatedCode = negatedPrereqCodes.has(normalizeCourseCode(entry.token));
                                const tokenClass = isNegatedCode
                                  ? taken
                                    ? "border-rose-300 bg-rose-100 text-rose-700"
                                    : "border-emerald-300 bg-emerald-100 text-emerald-700"
                                  : !hasTakenSet
                                    ? "border-slate-300 bg-slate-100 text-slate-700"
                                    : taken
                                      ? "border-emerald-300 bg-emerald-100 text-emerald-700"
                                      : "border-rose-300 bg-rose-100 text-rose-700";
                                const tokenTitle = tokenClass.includes("rose")
                                  ? "prerequisite not meet"
                                  : undefined;
                                return (
                                  <span
                                    key={`prereq-code-${lineIndex}-${tokenIndex}`}
                                    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${tokenClass}`}
                                    data-testid="prereq-code-token"
                                    title={tokenTitle}
                                  >
                                    {entry.token}
                                  </span>
                                );
                              })}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Not listed in SIS</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleSummarize}
                disabled={summaryLoading}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                {summaryLoading
                  ? "Loading..."
                  : summaryText
                    ? showSummary
                      ? "Hide course eval summary"
                      : "Show course eval summary"
                    : "Summarize course evals"}
              </Button>
              {summaryText && showSummary && (
                <div className="rounded-md border bg-muted/30 p-3 text-sm">
                  <h4 className="text-sm font-semibold">Evaluation Summary</h4>
                  <p className="mt-2 text-muted-foreground">{summaryText}</p>
                  {summarySourceCount > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Source datapoints shown: {summarySourceCount}
                      {summarySourceTotalCount > 0 ? ` of ${summarySourceTotalCount}` : ""}
                      {summarySourceTruncated ? " (truncated for performance)" : ""}
                    </p>
                  )}
                  <div className="mt-3">
                    {/* Open the raw source-data modal only when summary datapoints exist. */}
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="raw-eval-data-button"
                      onClick={() => setShowRawSummaryData(true)}
                      disabled={summarySourceData.length === 0}
                    >
                      View raw evaluation data
                    </Button>
                    {summarySourceData.length === 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Raw evaluation data is not available for this summary.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <Button
              variant="outline"
              className="mt-4"
              onClick={closeInfoModal}
            >
              Close
            </Button>
          </div>
        </div>
      )}

      {showInfo && showRawSummaryData && summarySourceData.length > 0 && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="raw-eval-data-title"
          onClick={() => setShowRawSummaryData(false)}
          data-testid="raw-eval-data-modal"
        >
          <div
            className="max-h-[80vh] w-full max-w-4xl overflow-hidden rounded-lg bg-card shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Render source rows as a compact table for metric transparency. */}
            <div className="border-b px-4 py-3">
              <h3 id="raw-eval-data-title" className="text-base font-semibold">
                Raw Evaluation Data
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Source values used for this course summary.
              </p>
            </div>
            <div className="max-h-[60vh] overflow-auto p-4">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 font-medium">Metric</th>
                    <th className="px-3 py-2 font-medium">Value</th>
                    <th className="px-3 py-2 font-medium">Term</th>
                    <th className="px-3 py-2 font-medium">Instructor</th>
                    <th className="px-3 py-2 font-medium">Respondents</th>
                  </tr>
                </thead>
                <tbody>
                  {summarySourceData.map((row, index) => (
                    <tr
                      key={`${row.metricName}-${row.term ?? "unknown"}-${row.instructor ?? "unknown"}-${index}`}
                      className="border-b"
                      data-testid="raw-eval-data-row"
                    >
                      <td className="px-3 py-2">{formatRawMetricLabel(row.metricLabel, row.metricName)}</td>
                      <td className="px-3 py-2">{formatRawMetricValue(row.metricValue)}</td>
                      <td className="px-3 py-2">{formatRawText(row.term)}</td>
                      <td className="px-3 py-2">{formatRawText(row.instructor)}</td>
                      <td className="px-3 py-2">{row.respondentCount ?? "N/A"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t px-4 py-3">
              <Button variant="outline" onClick={() => setShowRawSummaryData(false)}>
                Close raw data
              </Button>
            </div>
          </div>
        </div>
      )}

      <AlertDialog
        open={showAddWarningDialog}
        onOpenChange={setShowAddWarningDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Prerequisite warning</AlertDialogTitle>
            <AlertDialogDescription>
              {warningDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowAddWarningDialog(false);
                onAddToSchedule?.(course);
              }}
              data-testid="confirm-add-shortlist"
            >
              Add anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
