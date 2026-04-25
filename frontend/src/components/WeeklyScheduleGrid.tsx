import type { WeeklyScheduleEvent } from "@/types/schedules";

type WeeklyScheduleGridProps = {
  events: WeeklyScheduleEvent[];
  loading: boolean;
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const TIME_SLOTS = [
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
  "19:00",
  "20:00",
];

function toCellKey(day: string, time: string): string {
  return `${day}|${time}`;
}

export default function WeeklyScheduleGrid({ events, loading }: WeeklyScheduleGridProps) {
  const eventsByCell = new Map<string, WeeklyScheduleEvent[]>();
  for (const event of events) {
    if (!event.dayOfWeek || !event.startTime) continue;
    const key = toCellKey(event.dayOfWeek, event.startTime);
    const existing = eventsByCell.get(key) ?? [];
    existing.push(event);
    eventsByCell.set(key, existing);
  }

  return (
    <div className="h-full rounded-xl border border-border bg-muted/30 p-3 flex flex-col" data-testid="weekly-grid-panel">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold">Weekly Schedule</h3>
        <span className="text-[11px] text-muted-foreground">Read-only scaffold</span>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground" data-testid="weekly-grid-loading">
          Loading weekly schedule...
        </p>
      ) : (
        <>
          {events.length === 0 && (
            <p className="mb-2 text-xs text-muted-foreground" data-testid="weekly-grid-empty">
              No scheduled events yet.
            </p>
          )}

          <div className="flex-1 overflow-y-auto overflow-x-auto" data-testid="weekly-grid">
            <table className="w-full min-w-140 border-collapse text-[11px]">
              <thead>
                <tr>
                  <th className="border border-border bg-background/70 px-2 py-1 text-left font-medium text-muted-foreground">
                    Time
                  </th>
                  {DAYS.map((day) => (
                    <th
                      key={day}
                      className="border border-border bg-background/70 px-2 py-1 text-left font-medium text-muted-foreground"
                    >
                      {day}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TIME_SLOTS.map((slot) => (
                  <tr key={slot}>
                    <td className="border border-border bg-background/40 px-2 py-3 font-medium text-muted-foreground align-top">
                      {slot}
                    </td>
                    {DAYS.map((day) => (
                      <td
                        key={`${slot}-${day}`}
                        className="h-20 border border-border bg-background/30 px-2 py-3 align-top"
                      >
                        {(eventsByCell.get(toCellKey(day, slot)) ?? []).map((event) => (
                          <div
                            key={event.eventId}
                            className="mb-1 rounded-md border border-border bg-background/80 px-1.5 py-1 text-[10px] leading-tight"
                            data-testid="weekly-grid-event"
                          >
                            <p className="font-semibold truncate">{event.courseCode}</p>
                            <p className="text-muted-foreground truncate">{event.courseTitle}</p>
                          </div>
                        ))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
