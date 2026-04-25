import type { WeeklyScheduleEvent } from "@/types/schedules";

type WeeklyScheduleGridProps = {
  events: WeeklyScheduleEvent[];
  loading: boolean;
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const DAY_START_MINUTES = 8 * 60;
const DAY_END_MINUTES = 21 * 60;
const MINUTE_HEIGHT_PX = 1;

type NormalizedEvent = {
  event: WeeklyScheduleEvent;
  startMinutes: number;
  endMinutes: number;
};

type PositionedEvent = {
  event: WeeklyScheduleEvent;
  topPx: number;
  heightPx: number;
  overlapColumn: number;
  overlapColumns: number;
  overlapGroup: number;
};

type PositionBuildResult = {
  positionedByDay: Map<string, PositionedEvent[]>;
  droppedCount: number;
};

function parseTimeToMinutes(raw: string | null): number | null {
  if (!raw) return null;
  const match = raw.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatMinutes(minutesFromMidnight: number): string {
  const hours = Math.floor(minutesFromMidnight / 60);
  const minutes = minutesFromMidnight % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function buildEventAriaLabel(event: WeeklyScheduleEvent, fallbackStart: number, fallbackEnd: number): string {
  const start = event.startTime ?? formatMinutes(fallbackStart);
  const end = event.endTime ?? formatMinutes(fallbackEnd);
  const location = event.location?.trim() || "Location TBA";
  return `${event.courseCode} ${event.courseTitle}, ${start} to ${end}, ${location}`;
}

function normalizeEvents(events: WeeklyScheduleEvent[]): { byDay: Map<string, NormalizedEvent[]>; droppedCount: number } {
  const byDay = new Map<string, NormalizedEvent[]>();
  let droppedCount = 0;

  for (const day of DAYS) {
    byDay.set(day, []);
  }

  for (const event of events) {
    if (!event.dayOfWeek || !DAYS.includes(event.dayOfWeek)) {
      droppedCount++;
      continue;
    }
    const start = parseTimeToMinutes(event.startTime);
    const end = parseTimeToMinutes(event.endTime);
    if (start == null || end == null || end <= start) {
      droppedCount++;
      continue;
    }

    const clampedStart = Math.max(start, DAY_START_MINUTES);
    const clampedEnd = Math.min(end, DAY_END_MINUTES);
    if (clampedEnd <= clampedStart) {
      droppedCount++;
      continue;
    }

    byDay.get(event.dayOfWeek)?.push({
      event,
      startMinutes: clampedStart,
      endMinutes: clampedEnd,
    });
  }

  for (const day of DAYS) {
    byDay.get(day)?.sort((a, b) => {
      if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
      if (a.endMinutes !== b.endMinutes) return a.endMinutes - b.endMinutes;
      return a.event.eventId.localeCompare(b.event.eventId);
    });
  }

  return { byDay, droppedCount };
}

function positionCluster(cluster: NormalizedEvent[], overlapGroup: number): PositionedEvent[] {
  const laneEnds: number[] = [];
  const assignedLanes = new Map<string, number>();

  for (const item of cluster) {
    let laneIndex = laneEnds.findIndex((laneEnd) => laneEnd <= item.startMinutes);
    if (laneIndex === -1) {
      laneEnds.push(item.endMinutes);
      laneIndex = laneEnds.length - 1;
    } else {
      laneEnds[laneIndex] = item.endMinutes;
    }
    assignedLanes.set(item.event.eventId, laneIndex);
  }

  const overlapColumns = Math.max(1, laneEnds.length);
  return cluster.map((item) => ({
    event: item.event,
    topPx: (item.startMinutes - DAY_START_MINUTES) * MINUTE_HEIGHT_PX,
    heightPx: Math.max(24, (item.endMinutes - item.startMinutes) * MINUTE_HEIGHT_PX),
    overlapColumn: assignedLanes.get(item.event.eventId) ?? 0,
    overlapColumns,
    overlapGroup,
  }));
}

function buildPositionedEvents(events: WeeklyScheduleEvent[]): PositionBuildResult {
  const { byDay: normalizedByDay, droppedCount } = normalizeEvents(events);
  const positionedByDay = new Map<string, PositionedEvent[]>();

  for (const day of DAYS) {
    const dayEvents = normalizedByDay.get(day) ?? [];
    const positioned: PositionedEvent[] = [];
    let currentCluster: NormalizedEvent[] = [];
    let clusterEnd = -1;
    let overlapGroup = 0;

    for (const item of dayEvents) {
      if (currentCluster.length === 0) {
        currentCluster = [item];
        clusterEnd = item.endMinutes;
        continue;
      }

      if (item.startMinutes < clusterEnd) {
        currentCluster.push(item);
        clusterEnd = Math.max(clusterEnd, item.endMinutes);
        continue;
      }

      positioned.push(...positionCluster(currentCluster, overlapGroup));
      overlapGroup++;
      currentCluster = [item];
      clusterEnd = item.endMinutes;
    }

    if (currentCluster.length > 0) {
      positioned.push(...positionCluster(currentCluster, overlapGroup));
    }

    positionedByDay.set(day, positioned);
  }

  return { positionedByDay, droppedCount };
}

function formatHourLabel(minutesFromMidnight: number): string {
  const hours = Math.floor(minutesFromMidnight / 60);
  return `${String(hours).padStart(2, "0")}:00`;
}

export default function WeeklyScheduleGrid({ events, loading }: WeeklyScheduleGridProps) {
  const timelineHeight = (DAY_END_MINUTES - DAY_START_MINUTES) * MINUTE_HEIGHT_PX;
  const hourMarks = Array.from(
    { length: DAY_END_MINUTES / 60 - DAY_START_MINUTES / 60 },
    (_, index) => (DAY_START_MINUTES / 60 + index) * 60,
  );
  const { positionedByDay, droppedCount } = buildPositionedEvents(events);
  const positionedCount = DAYS.reduce((count, day) => count + (positionedByDay.get(day)?.length ?? 0), 0);

  return (
    <div className="h-full rounded-xl border border-border bg-muted/30 p-3 flex flex-col" data-testid="weekly-grid-panel">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold">Weekly Schedule</h3>
        <span className="text-[11px] text-muted-foreground" data-testid="weekly-grid-metadata">
          {positionedCount} rendered · Read-only scaffold
        </span>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground" data-testid="weekly-grid-loading">
          Loading weekly schedule...
        </p>
      ) : (
        <>
          {positionedCount === 0 && (
            <p className="mb-2 text-xs text-muted-foreground" data-testid="weekly-grid-empty">
              No scheduled events yet.
            </p>
          )}

          {droppedCount > 0 && (
            <p className="mb-2 text-xs text-muted-foreground" data-testid="weekly-grid-dropped-note">
              {droppedCount} event{droppedCount === 1 ? "" : "s"} omitted due to invalid or out-of-range time data.
            </p>
          )}

          <div className="flex-1 overflow-y-auto overflow-x-auto" data-testid="weekly-grid">
            <div className="min-w-[920px] rounded-lg border border-border bg-background/40">
              <div
                className="grid border-b border-border bg-background/70 text-[11px] font-medium text-muted-foreground"
                style={{ gridTemplateColumns: `64px repeat(${DAYS.length}, minmax(0, 1fr))` }}
              >
                <div className="border-r border-border px-2 py-2 text-left">Time</div>
                {DAYS.map((day) => (
                  <div key={day} className="border-r border-border last:border-r-0 px-2 py-2 text-left">
                    {day}
                  </div>
                ))}
              </div>

              <div className="relative" style={{ height: `${timelineHeight}px` }}>
                <div className="absolute inset-y-0 left-0 w-16 border-r border-border bg-background/30">
                  {hourMarks.map((minuteMark) => {
                    const top = (minuteMark - DAY_START_MINUTES) * MINUTE_HEIGHT_PX;
                    return (
                      <div
                        key={`label-${minuteMark}`}
                        className="absolute left-0 w-full -translate-y-1/2 px-2 text-[10px] text-muted-foreground"
                        style={{ top: `${top}px` }}
                      >
                        {formatHourLabel(minuteMark)}
                      </div>
                    );
                  })}
                </div>

                <div className="absolute inset-y-0 left-16 right-0 flex">
                  {DAYS.map((day) => (
                    <div
                      key={day}
                      className="relative flex-1 border-r border-border last:border-r-0"
                      data-testid={`weekly-grid-day-${day}`}
                    >
                      {hourMarks.map((minuteMark) => {
                        const top = (minuteMark - DAY_START_MINUTES) * MINUTE_HEIGHT_PX;
                        return (
                          <div
                            key={`${day}-line-${minuteMark}`}
                            className="pointer-events-none absolute left-0 right-0 border-t border-border/60"
                            style={{ top: `${top}px` }}
                          />
                        );
                      })}

                      {(positionedByDay.get(day) ?? []).map((positioned) => {
                        const widthPercent = 100 / positioned.overlapColumns;
                        const leftPercent = widthPercent * positioned.overlapColumn;

                        return (
                          <div
                            key={positioned.event.eventId}
                            className="absolute px-0.5"
                            style={{
                              top: `${positioned.topPx}px`,
                              height: `${positioned.heightPx}px`,
                              left: `${leftPercent}%`,
                              width: `${widthPercent}%`,
                            }}
                          >
                            <div
                              className="h-full overflow-hidden rounded-md border border-border/70 bg-blue-50/90 px-1.5 py-1 text-[10px] leading-tight"
                              data-testid="weekly-grid-event"
                              data-overlap-column={String(positioned.overlapColumn)}
                              data-overlap-columns={String(positioned.overlapColumns)}
                              data-overlap-group={String(positioned.overlapGroup)}
                              data-event-id={positioned.event.eventId}
                              data-top-px={String(positioned.topPx)}
                              data-height-px={String(positioned.heightPx)}
                              data-day={day}
                              data-start-time={positioned.event.startTime ?? ""}
                              data-end-time={positioned.event.endTime ?? ""}
                              aria-label={buildEventAriaLabel(
                                positioned.event,
                                DAY_START_MINUTES + positioned.topPx,
                                DAY_START_MINUTES + positioned.topPx + positioned.heightPx,
                              )}
                              role="article"
                              tabIndex={0}
                            >
                              <p className="truncate font-semibold">{positioned.event.courseCode}</p>
                              <p className="truncate text-muted-foreground">{positioned.event.courseTitle}</p>
                              <p className="truncate text-muted-foreground/90" data-testid="weekly-grid-event-time">
                                {positioned.event.startTime ?? formatMinutes(DAY_START_MINUTES + positioned.topPx)}
                                {" - "}
                                {positioned.event.endTime ?? formatMinutes(DAY_START_MINUTES + positioned.topPx + positioned.heightPx)}
                              </p>
                              <p className="truncate text-muted-foreground/90">
                                {positioned.event.location?.trim() || "Location TBA"}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
