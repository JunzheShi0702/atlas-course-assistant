import type { Dispatch, SetStateAction } from "react";
import ScheduleChat from "@/components/ScheduleChat";
import type { ScheduleDetail } from "@/types/schedules";

type ChatProps = {
  scheduleId: string;
  schedule: ScheduleDetail | null;
  loadError: string | null;
  scheduleCourseIds: Set<string>;
  onScheduleCourseIdsChange: Dispatch<SetStateAction<Set<string>>>;
  onScheduleCoursesChanged: () => void;
};

export default function Chat({
  scheduleId,
  schedule,
  loadError,
  scheduleCourseIds,
  onScheduleCourseIdsChange,
  onScheduleCoursesChanged,
}: ChatProps) {
  return (
    <div className="flex flex-col flex-1 min-w-0 border-r border-border">
      <div className="min-h-0 flex-1 p-4">
        {loadError ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-border bg-muted/20 text-sm text-destructive p-8 text-center">
            {loadError}
          </div>
        ) : (
          <ScheduleChat
            scheduleId={scheduleId}
            scheduleName={schedule?.name}
            scheduleCourseIds={scheduleCourseIds}
            onScheduleCourseIdsChange={onScheduleCourseIdsChange}
            onScheduleCoursesChanged={onScheduleCoursesChanged}
          />
        )}
      </div>
    </div>
  );
}
