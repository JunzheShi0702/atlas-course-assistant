import { useState } from "react";
import { ChevronDown, ChevronUp, Info, Minus, Plus, Quote, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CourseCard as CourseCardType, SisCourseDetails } from "@/store/atoms";
import { useAtomValue, useSetAtom } from "jotai";
import { addToShortlistAtom, quotedCourseAtom, removeFromShortlistAtom, shortlistAtom } from "@/store/atoms";
import { useApi } from "@/hooks/useApi";

// Session-level cache for SIS details
const sisDetailsCache = new Map<string, SisCourseDetails>();

interface CourseCardProps {
  course: CourseCardType;
  onSelect?: (courseId: string) => void;
}

export default function CourseCard({ course, onSelect }: CourseCardProps) {
  const addToShortlist = useSetAtom(addToShortlistAtom);
  const removeFromShortlist = useSetAtom(removeFromShortlistAtom);
  const setQuotedCourse = useSetAtom(quotedCourseAtom);
  const shortlist = useAtomValue(shortlistAtom);
  const { getSisCourseDetails, sisDetailsLoading, getCourseSummary, summaryLoading } = useApi();

  const [sisDetails, setSisDetails] = useState<SisCourseDetails | null>(
    course.sisDetails || sisDetailsCache.get(course.id) || null
  );
  const [isExpanded, setIsExpanded] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [summaryText, setSummaryText] = useState<string | null>(null);

  const isPlaceholder = course.id === "placeholder";
  const isShortlisted = shortlist.some((item) => item.id === course.id);

  const handleToggleShortlist = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isShortlisted) {
      removeFromShortlist(course.id);
    } else {
      addToShortlist({ id: course.id, courseCode: course.courseCode, courseTitle: course.courseTitle });
    }
  };

  const handleQuote = (e: React.MouseEvent) => {
    e.stopPropagation();
    setQuotedCourse(course);
  };

  const handleExpand = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isExpanded) {
      setIsExpanded(false);
      return;
    }
    if (sisDetails || sisDetailsCache.get(course.id)) {
      setSisDetails(sisDetails ?? sisDetailsCache.get(course.id) ?? null);
      setIsExpanded(true);
      return;
    }
    try {
      const response = await getSisCourseDetails(course.id);
      if (response?.details) {
        setSisDetails(response.details);
        sisDetailsCache.set(course.id, response.details);
      }
      setIsExpanded(true);
    } catch (error) {
      console.error("Failed to fetch SIS details:", error);
      setIsExpanded(true);
    }
  };

  const handleOpenInfo = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowInfo(true);
  };

  const handleSummarize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSummaryText(null);
    const courseCode = course.courseCode !== "N/A" ? course.courseCode : course.id;
    try {
      const result = await getCourseSummary(courseCode);
      setSummaryText(result?.summary ?? "No evaluation data found for this course.");
    } catch {
      setSummaryText("Failed to load evaluation summary.");
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
    <div className="space-y-2">
      {course.matchReasoning && (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium">Why this matches:</span> {course.matchReasoning}
        </p>
      )}
      <Card
        className={`group cursor-pointer border-0 transition-shadow ${
          isShortlisted
            ? "bg-muted/60 dark:bg-muted/30 shadow-inner"
            : "course-card-bg hover:shadow-md"
        }`}
        onClick={() => onSelect?.(course.id)}
      >
        <CardHeader className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <CardTitle className="text-base">
                <span className="text-muted-foreground">{course.courseCode}</span>{" "}
                {course.courseTitle}
              </CardTitle>
              {course.instructor && course.instructor !== "TBD" && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Instructor: <span className="text-foreground">{course.instructor}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 hover:bg-blue-200/80 dark:hover:bg-blue-800/60"
                aria-label="View details"
                onClick={handleOpenInfo}
              >
                <Info className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 hover:bg-blue-200/80 dark:hover:bg-blue-800/60"
                aria-label="Quote course in chat"
                onClick={handleQuote}
              >
                <Quote className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 hover:bg-blue-200/80 dark:hover:bg-blue-800/60"
                aria-label={isShortlisted ? "Remove from shortlist" : "Add to shortlist"}
                onClick={handleToggleShortlist}
              >
                {isShortlisted ? <Minus className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {typeof course.credits === "number" && (
              <Badge variant="secondary">{course.credits} credits</Badge>
            )}
            {typeof course.workload === "number" && (
              <Badge variant="secondary">{course.workload}h workload</Badge>
            )}
            {typeof course.difficulty === "number" && (
              <Badge variant="secondary">{course.difficulty}/5 difficulty</Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="pt-0 text-sm text-muted-foreground">
          <p className="line-clamp-3">{course.description}</p>
        </CardContent>

        {isExpanded && sisDetails && (
          <CardContent className="space-y-2 pt-3">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <h4 className="font-semibold text-sm">Full Course Details</h4>
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
                {sisDetails.instructors && sisDetails.instructors.length > 0 && (
                  <div>
                    <span className="font-medium">Instructors:</span>{" "}
                    <span className="text-muted-foreground">
                      {sisDetails.instructors.join(", ")}
                    </span>
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
          </CardContent>
        )}

        {isExpanded && !sisDetails && !sisDetailsLoading && (
          <CardContent className="pt-3">
            <div className="rounded-md border border-dashed bg-muted/20 p-3 text-sm">
              <p className="text-center text-muted-foreground">
                Full SIS details will be available once the backend returns data.
              </p>
            </div>
          </CardContent>
        )}

        <CardContent className="pt-3">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={handleExpand}
            disabled={sisDetailsLoading}
          >
            {sisDetailsLoading ? (
              "Loading details..."
            ) : isExpanded ? (
              <>
                <ChevronUp className="mr-2 h-4 w-4" />
                Show less
              </>
            ) : (
              <>
                <ChevronDown className="mr-2 h-4 w-4" />
                View more details
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {showInfo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
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
              <p className="mt-1 text-sm text-muted-foreground">{course.description}</p>
            </div>

            <div className="mt-4 space-y-2">
              {summaryText ? (
                <div className="rounded-md border bg-muted/30 p-3 text-sm">
                  <h4 className="font-semibold text-sm">Evaluation Summary</h4>
                  <p className="mt-2 text-muted-foreground">{summaryText}</p>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={handleSummarize}
                  disabled={summaryLoading}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  {summaryLoading ? "Loading..." : "Summarize course evals"}
                </Button>
              )}
            </div>

            <Button
              variant="outline"
              className="mt-4"
              onClick={() => setShowInfo(false)}
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
