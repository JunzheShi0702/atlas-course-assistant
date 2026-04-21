import { useEffect, useState } from "react";
import { BookmarkPlus, BookmarkCheck, Minus, Plus, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CourseCard as CourseCardType, SisCourseDetails } from "@/store/atoms";
import { useApi } from "@/hooks/useApi";

const sisDetailsCache = new Map<string, SisCourseDetails>();
const courseColorIndexCache = new Map<string, number>();
let nextCourseColorIndex = 0;

interface CourseCardProps {
  course: CourseCardType;
  onSelect?: (courseId: string) => void;
  onAddToSchedule?: (course: CourseCardType) => void;
  onRemoveFromSchedule?: (course: CourseCardType) => void;
  isInSchedule?: boolean;
}

const cardPastelPalette = [
  "border-sky-200/70 bg-sky-50",
  "border-rose-200/70 bg-rose-50",
  "border-emerald-200/70 bg-emerald-50",
  "border-fuchsia-200/70 bg-fuchsia-50",
  "border-amber-200/70 bg-amber-50",
  "border-violet-200/70 bg-violet-50",
];

const getCoursePastelClass = (id: string) => {
  const cachedIndex = courseColorIndexCache.get(id);
  if (cachedIndex !== undefined) {
    return cardPastelPalette[cachedIndex];
  }

  const paletteIndex = nextCourseColorIndex % cardPastelPalette.length;
  courseColorIndexCache.set(id, paletteIndex);
  nextCourseColorIndex += 1;

  return cardPastelPalette[paletteIndex];
};

export default function CourseCard({
  course,
  onSelect,
  onAddToSchedule,
  onRemoveFromSchedule,
  isInSchedule = false,
}: CourseCardProps) {
  const { getSisCourseDetails, sisDetailsLoading, getCourseSummary, summaryLoading } = useApi();

  const [sisDetails, setSisDetails] = useState<SisCourseDetails | null>(
    course.sisDetails || sisDetailsCache.get(course.id) || null
  );
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
  const cardPastelClass = getCoursePastelClass(course.id);
  const isPreferenceMismatch = course.preferenceAlignment === "mismatch";

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

      setShowInfo(false);
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

    const cachedDetails = sisDetailsCache.get(course.id);
    if (cachedDetails) {
      setSisDetails(cachedDetails);
      setShowSisDetails(true);
      return;
    }

    try {
      const response = await getSisCourseDetails(course.id);
      if (response?.details) {
        setSisDetails(response.details);
        sisDetailsCache.set(course.id, response.details);
        setShowSisDetails(true);
      } else {
        setSisDetailsErrorMessage("No additional SIS details were returned for this course.");
      }
    } catch {
      setSisDetailsErrorMessage("Failed to load full course details.");
    }
  };

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
      <Card
        className={`group h-full cursor-pointer border transition-all hover:-translate-y-0.5 hover:shadow-md ${cardPastelClass}`}
        onClick={() => {
          setShowInfo(true);
          setShowFullDescription(false);
          setShowSisDetails(false);
          setShowSummary(false);
          setShowRawSummaryData(false);
          onSelect?.(course.id);
        }}
      >
        <CardHeader className="flex min-h-24 flex-col justify-center px-6 py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <CardTitle className="text-sm leading-snug">
                <span className="text-muted-foreground">{course.courseCode}</span>{" "}
                {course.courseTitle}
              </CardTitle>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {(onAddToSchedule || onRemoveFromSchedule) && (
                <Button
                  variant={isInSchedule ? "secondary" : "ghost"}
                  size="icon"
                  className="h-12 w-12 [&_svg]:size-5 bg-transparent hover:bg-transparent active:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                  aria-label={isInSchedule ? "Remove from schedule" : "Add to schedule"}
                  title={isInSchedule ? "Remove from schedule" : "Add to schedule"}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isInSchedule) onRemoveFromSchedule?.(course);
                    else onAddToSchedule?.(course);
                  }}
                >
                  {isInSchedule
                    ? <BookmarkCheck className="text-primary" />
                    : <BookmarkPlus />}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {showInfo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowInfo(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="course-info-title"
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="course-info-title" className="text-lg font-semibold">
              <span className="text-muted-foreground">{course.courseCode}</span>{" "}
              {course.courseTitle}
            </h2>
            {course.instructor && course.instructor !== "TBD" && (
              <p className="mt-2 text-sm text-muted-foreground">
                Instructor: <span className="text-foreground">{course.instructor}</span>
              </p>
            )}
            
            <div className="mt-4">
              <h3 className="text-sm font-medium">Description</h3>
              <p className={`mt-1 text-sm text-muted-foreground ${showFullDescription ? "" : "line-clamp-3"}`}>
                {course.description}
              </p>
              <Button
                variant="link"
                size="sm"
                className="h-auto px-0 py-1 text-sm"
                onClick={() => setShowFullDescription((prev) => !prev)}
              >
                {showFullDescription ? "less" : "more"}
              </Button>
            </div>

            {course.matchReasoning && (
              <div
                className={`mt-4 rounded-md border px-3 py-2 text-sm ${
                  isPreferenceMismatch
                    ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200"
                    : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/50 dark:bg-blue-950/30 dark:text-blue-300"
                }`}
              >
                <span className="font-medium">
                  {isPreferenceMismatch ? "Preference mismatch:" : "Why this matches:"}
                </span>
                <p>
                  {course.matchReasoning}
                </p>
              </div>
            )}

            <div className="mt-4 space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleLoadDetails}
                disabled={sisDetailsLoading}
              >
                {sisDetailsLoading ? (
                  "Loading full details..."
                ) : sisDetails ? (
                  showSisDetails ? (
                    <>
                      <Minus className="mr-2 h-4 w-4" />
                      Hide full course details
                    </>
                  ) : (
                    <>
                      <Plus className="mr-2 h-4 w-4" />
                      Show full course details
                    </>
                  )
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Load full course details
                  </>
                )}
              </Button>
              {sisDetailsErrorMessage && (
                <p className="text-sm text-destructive">{sisDetailsErrorMessage}</p>
              )}
              {sisDetails && showSisDetails && (
                <div className="rounded-md border bg-muted/30 p-3 text-sm">
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
              onClick={() => {
                setShowInfo(false);
                setShowRawSummaryData(false);
              }}
            >
              Close
            </Button>
          </div>
        </div>
      )}

      {showInfo && showRawSummaryData && summarySourceData.length > 0 && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
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
    </>
  );
}
