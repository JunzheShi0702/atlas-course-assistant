import { useState } from "react";
import { Info, Minus, Plus, Quote } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CourseCard as CourseCardType } from "@/store/atoms";
import { useAtomValue, useSetAtom } from "jotai";
import { addToShortlistAtom, quotedCourseAtom, removeFromShortlistAtom, shortlistAtom } from "@/store/atoms";

interface CourseCardProps {
  course: CourseCardType;
  onSelect?: (courseId: string) => void;
}

export default function CourseCard({ course, onSelect }: CourseCardProps) {
  const addToShortlist = useSetAtom(addToShortlistAtom);
  const removeFromShortlist = useSetAtom(removeFromShortlistAtom);
  const setQuotedCourse = useSetAtom(quotedCourseAtom);
  const shortlist = useAtomValue(shortlistAtom);
  const [showInfo, setShowInfo] = useState(false);

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
            <div className="min-w-0">
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
                onClick={(e) => {
                  e.stopPropagation();
                  setShowInfo(true);
                }}
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
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg bg-card p-6 shadow-lg"
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
