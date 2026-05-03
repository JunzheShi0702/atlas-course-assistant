import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import WeeklyScheduleGrid from "@/components/WeeklyScheduleGrid";
import type { WeeklyScheduleEvent, WeeklyScheduleDay } from "@/types/schedules";

type CalendarProps = {
  weeklyEvents: WeeklyScheduleEvent[];
  weeklyEventsLoading: boolean;
  weeklyEventsError: string | null;
  onAddCustomEvent: (day?: WeeklyScheduleDay | null) => void;
  onSelectEvent: (event: WeeklyScheduleEvent) => void;
  onRetryWeeklyEvents: () => void;
  courseColorMap: Record<string, string>;
};

export default function Calendar({
  weeklyEvents,
  weeklyEventsLoading,
  weeklyEventsError,
  onAddCustomEvent,
  onSelectEvent,
  onRetryWeeklyEvents,
  courseColorMap,
}: CalendarProps) {
  return (
    <div className="h-full min-h-0 p-4 flex flex-col">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Calendar</h2>
          <button
            type="button"
            role="tab"
            aria-selected="true"
            className="rounded border border-border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground"
          >
            Weekly Schedule
          </button>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => onAddCustomEvent()}
        >
          Add custom event
        </Button>
      </div>
      {weeklyEventsError && (
        <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive mb-2">
          <p>{weeklyEventsError}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 h-7 text-xs"
            onClick={onRetryWeeklyEvents}
          >
            Retry loading events
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        <WeeklyScheduleGrid
          events={weeklyEvents}
          loading={weeklyEventsLoading}
          onEventSelect={onSelectEvent}
          compact
          courseColorMap={courseColorMap}
        />
      </div>
    </div>
  );
}
