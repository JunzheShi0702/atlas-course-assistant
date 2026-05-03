import type { Dispatch, SetStateAction } from "react";
import { MessageCircle } from "lucide-react";
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
    <div className="flex h-full w-full flex-col min-w-0">
      <div className="p-4 pb-0">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Chat</h2>
        </div>
      </div>
      <div className="min-h-0 flex-1 p-4 pt-3">
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
