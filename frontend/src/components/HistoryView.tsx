import { useEffect, useRef, useState, useCallback } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { historyAtom, removeMessageAtom, type HistoryMessage, CourseCard as CourseCardType } from "@/store/atoms";
import CourseCard from "@/components/CourseCard";
import { useSchedules } from "@/hooks/useSchedules";

interface HistoryViewProps {
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export default function HistoryView({ loading = false, error, onRetry }: HistoryViewProps) {
  const history = useAtomValue(historyAtom);
  const removeMessage = useSetAtom(removeMessageAtom);
  const lastCardRef = useRef<HTMLDivElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  
  // Schedule management state
  const { schedules, loadSchedules, createSchedule, addCourse, removeCourse, getSchedule } = useSchedules();
  const [activeScheduleId, setActiveScheduleId] = useState<string | null>(null);
  const [courseStatuses, setCourseStatuses] = useState<Record<string, boolean>>({});

  // Load schedules and sync course statuses
  useEffect(() => {
    loadSchedules().then((userSchedules) => {
      if (userSchedules.length > 0) {
        setActiveScheduleId(userSchedules[0].id);
        // Load course details for first schedule to sync statuses
        getSchedule(userSchedules[0].id).then((scheduleDetail) => {
          const statuses: Record<string, boolean> = {};
          scheduleDetail.courses.forEach((course) => {
            // Create a unique key based on course code for matching
            const courseKey = course.courseCode;
            statuses[courseKey] = true;
          });
          setCourseStatuses(statuses);
        }).catch(console.error);
      }
    });
  }, [loadSchedules, getSchedule]);

  // Sync course statuses when active schedule changes
  useEffect(() => {
    if (activeScheduleId) {
      getSchedule(activeScheduleId).then((scheduleDetail) => {
        const statuses: Record<string, boolean> = {};
        scheduleDetail.courses.forEach((course) => {
          const courseKey = course.courseCode;
          statuses[courseKey] = true;
        });
        setCourseStatuses(statuses);
      }).catch(console.error);
    }
  }, [activeScheduleId, getSchedule]);

  // Auto-create schedule if none exists
  const ensureActiveSchedule = useCallback(async (): Promise<string> => {
    if (activeScheduleId) return activeScheduleId;
    
    if (schedules.length === 0) {
      const newSchedule = await createSchedule({
        name: "My Schedule",
        term: "Spring 2026"
      });
      setActiveScheduleId(newSchedule.id);
      return newSchedule.id;
    } else {
      setActiveScheduleId(schedules[0].id);
      return schedules[0].id;
    }
  }, [activeScheduleId, schedules, createSchedule]);

  const handleAddToSchedule = useCallback(async (course: CourseCardType) => {
    try {
      const scheduleId = await ensureActiveSchedule();
      await addCourse(scheduleId, {
        courseCode: course.courseCode,
        sisOfferingName: course.sisOfferingName || course.courseTitle,
        term: "Spring 2026",
        credits: course.credits,
      });
      setCourseStatuses(prev => ({ ...prev, [course.courseCode]: true }));
    } catch (error) {
      console.error("Failed to add course to schedule:", error);
    }
  }, [ensureActiveSchedule, addCourse]);

  const handleRemoveFromSchedule = useCallback(async (course: CourseCardType) => {
    if (!activeScheduleId) return;
    
    try {
      await removeCourse(activeScheduleId, {
        courseCode: course.courseCode,
        sisOfferingName: course.sisOfferingName || course.courseTitle,
        term: "Spring 2026"
      });
      setCourseStatuses(prev => ({ ...prev, [course.courseCode]: false }));
    } catch (error) {
      console.error("Failed to remove course from schedule:", error);
    }
  }, [activeScheduleId, removeCourse]);

  useEffect(() => {
    if (history.length > 0) {
      lastCardRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [history.length]);

  useEffect(() => {
    if (loading || error) {
      feedbackRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [loading, error]);

  const formatTimestamp = (date: Date): string => {
    return new Date(date).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (history.length === 0 && !loading && !error) {
    return (
      <div className="flex flex-col h-full">
        {/* Schedule header */}
        {schedules.length > 0 && (
          <div className="shrink-0 border-b border-border bg-muted/30 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">Active Schedule:</h3>
                <select 
                  className="text-sm bg-transparent border-0 focus:outline-none"
                  value={activeScheduleId || ""}
                  onChange={(e) => setActiveScheduleId(e.target.value)}
                >
                  {schedules.map((schedule) => (
                    <option key={schedule.id} value={schedule.id}>
                      {schedule.name} ({schedule.term})
                    </option>
                  ))}
                </select>
              </div>
              <Badge variant="secondary" className="text-xs">
                {Object.values(courseStatuses).filter(Boolean).length} courses
              </Badge>
            </div>
          </div>
        )}
        
        <div className="flex-1 p-8 text-center text-muted-foreground">
          <p>No history yet. Start searching or chatting!</p>
        </div>
      </div>
    );
  }

  const renderItems = (items: HistoryMessage[]) => (
    <div className="space-y-4">
      {items.map((message, index) => (
        <div
          key={message.id}
          ref={index === items.length - 1 ? lastCardRef : undefined}
        >
        <Card className="border-0 shadow-none">
          <CardHeader className="pb-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={message.type === "search" ? "secondary" : "default"}>
                    {message.type === "search" ? "Search" : "Chat"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatTimestamp(message.timestamp)}
                  </span>
                </div>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {message.prompt}
                </div>
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeMessage(message.id)}
                aria-label="Remove message"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>

          <CardContent className="pt-0 space-y-3">
            {message.response.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {message.response.map((course) => (
                  <CourseCard 
                    key={course.id} 
                    course={course} 
                    onAddToSchedule={handleAddToSchedule}
                    onRemoveFromSchedule={handleRemoveFromSchedule}
                    isInSchedule={courseStatuses[course.courseCode] || false}
                  />
                ))}
              </div>
            ) : (
              <div className="p-3 text-sm border border-dashed rounded-lg bg-muted/30 text-muted-foreground">
                No results found.
              </div>
            )}
          </CardContent>
        </Card>
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Schedule header */}
      {schedules.length > 0 && (
        <div className="shrink-0 border-b border-border bg-muted/30 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">Active Schedule:</h3>
              <select 
                className="text-sm bg-transparent border-0 focus:outline-none"
                value={activeScheduleId || ""}
                onChange={(e) => setActiveScheduleId(e.target.value)}
              >
                {schedules.map((schedule) => (
                  <option key={schedule.id} value={schedule.id}>
                    {schedule.name} ({schedule.term})
                  </option>
                ))}
              </select>
            </div>
            <Badge variant="secondary" className="text-xs">
              {Object.values(courseStatuses).filter(Boolean).length} courses
            </Badge>
          </div>
        </div>
      )}
      
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col items-stretch min-h-0 space-y-2 p-6">
          {renderItems(history)}
          {(loading || error) && (
            <div ref={feedbackRef} className="py-8 px-6">
              {loading ? (
                <div className="flex items-center justify-center py-2">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="p-4 text-red-800 bg-red-100 border border-dashed rounded-sm text-md">
                  <p>{error}</p>
                  {onRetry && (
                    <div className="flex justify-end mt-3">
                      <Button variant="outline" onClick={onRetry} className="px-5 h-13">
                        <RotateCcw className="w-4 h-4 mr-2" /> Retry
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
