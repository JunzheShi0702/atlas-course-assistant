import { ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CourseCard as CourseCardType } from "@/store/atoms";

interface CourseCardProps {
  course: CourseCardType;
  onSelect?: (courseId: string) => void;
}

export default function CourseCard({ course, onSelect }: CourseCardProps) {
  // Check if this is a placeholder/not-implemented message
  const isPlaceholder = course.id === 'placeholder';

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
    <Card
      className="group cursor-pointer transition-shadow hover:shadow-md"
      onClick={() => onSelect?.(course.id)}
    >
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">
              <span className="text-muted-foreground">{course.courseCode}</span>{" "}
              {course.courseTitle}
            </CardTitle>
            <div className="mt-1 text-xs text-muted-foreground">
              Instructor: <span className="text-foreground">{course.instructor}</span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="opacity-0 transition-opacity group-hover:opacity-100"
            aria-label="Open course"
          >
            <ArrowRight />
          </Button>
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
  );
}