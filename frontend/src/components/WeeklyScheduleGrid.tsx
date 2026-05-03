import { useState } from "react";
import type { WeeklyScheduleEvent } from "@/types/schedules";

type WeeklyScheduleGridProps = {
  events: WeeklyScheduleEvent[];
  loading: boolean;
  onEventSelect?: (event: WeeklyScheduleEvent) => void;
  onAddEvent?: (day?: WeeklyScheduleEvent["dayOfWeek"]) => void;
  compact?: boolean;
  courseColorMap?: Record<string, string>;
};

const DAYS: Array<NonNullable<WeeklyScheduleEvent["dayOfWeek"]>> = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
];
const DAY_START_MINUTES = 8 * 60;
const DAY_END_MINUTES = 21 * 60;
const MINUTE_HEIGHT_PX = 1;
const TIME_COLUMN_WIDTH_PX = 56;

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
  unscheduledEvents: WeeklyScheduleEvent[];
  droppedCount: number;
};

function buildEventInstanceKey(event: WeeklyScheduleEvent): string {
  return [event.eventId, event.dayOfWeek ?? "", event.startTime ?? "", event.endTime ?? "", event.courseCode].join("|");
}

function getEventCourseCode(event: WeeklyScheduleEvent): string {
  return event.courseCode.trim() || "Course TBD";
}

function getEventCourseTitle(event: WeeklyScheduleEvent): string {
  return event.courseTitle.trim() || "Untitled course";
}

function CourseTitleWrapped({ title }: { title: string }) {
  return <span>{title}</span>;
}

function getEventLocation(event: WeeklyScheduleEvent): string {
  return event.location?.trim() || "Location TBD";
}


function getEventScheduleLabel(event: WeeklyScheduleEvent): string {
  if (event.dayOfWeek && event.startTime && event.endTime) {
    return `${event.dayOfWeek} · ${event.startTime} - ${event.endTime}`;
  }
  if (event.dayOfWeek) return `${event.dayOfWeek} · Time TBD`;
  return "Day/Time TBD";
}

function buildUnscheduledEventAriaLabel(event: WeeklyScheduleEvent): string {
  return `${getEventCourseCode(event)} ${getEventCourseTitle(event)}, ${getEventScheduleLabel(event)}, ${getEventLocation(event)}`;
}

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
  return `${getEventCourseCode(event)} ${getEventCourseTitle(event)}, ${start} to ${end}, ${getEventLocation(event)}`;
}

function normalizeEvents(events: WeeklyScheduleEvent[]): {
  byDay: Map<string, NormalizedEvent[]>;
  unscheduledEvents: WeeklyScheduleEvent[];
  droppedCount: number;
} {
  const byDay = new Map<string, NormalizedEvent[]>();
  const unscheduledEvents: WeeklyScheduleEvent[] = [];
  let droppedCount = 0;

  for (const day of DAYS) {
    byDay.set(day, []);
  }

  for (const event of events) {
    if (event.eventType === "course" && (!event.dayOfWeek || !event.startTime || !event.endTime)) {
      continue;
    }

    if (event.dayOfWeek == null) {
      unscheduledEvents.push(event);
      continue;
    }
    if (!DAYS.includes(event.dayOfWeek)) {
      droppedCount++;
      continue;
    }

    if (event.startTime == null || event.endTime == null) {
      unscheduledEvents.push(event);
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

  return { byDay, unscheduledEvents, droppedCount };
}

function positionCluster(cluster: NormalizedEvent[], overlapGroup: number): PositionedEvent[] {
  const laneEnds: number[] = [];
  const assignedLanes = new Map<string, number>();

  for (const item of cluster) {
    const instanceKey = buildEventInstanceKey(item.event);
    let laneIndex = laneEnds.findIndex((laneEnd) => laneEnd <= item.startMinutes);
    if (laneIndex === -1) {
      laneEnds.push(item.endMinutes);
      laneIndex = laneEnds.length - 1;
    } else {
      laneEnds[laneIndex] = item.endMinutes;
    }
    assignedLanes.set(instanceKey, laneIndex);
  }

  const overlapColumns = Math.max(1, laneEnds.length);
  return cluster.map((item) => ({
    event: item.event,
    topPx: (item.startMinutes - DAY_START_MINUTES) * MINUTE_HEIGHT_PX,
    heightPx: Math.max(24, (item.endMinutes - item.startMinutes) * MINUTE_HEIGHT_PX),
    overlapColumn: assignedLanes.get(buildEventInstanceKey(item.event)) ?? 0,
    overlapColumns,
    overlapGroup,
  }));
}

function buildPositionedEvents(events: WeeklyScheduleEvent[]): PositionBuildResult {
  const { byDay: normalizedByDay, unscheduledEvents, droppedCount } = normalizeEvents(events);
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

  return { positionedByDay, unscheduledEvents, droppedCount };
}

function formatHourLabel(minutesFromMidnight: number): string {
  const hours = Math.floor(minutesFromMidnight / 60);
  return `${String(hours).padStart(2, "0")}:00`;
}

export default function WeeklyScheduleGrid({ events, loading, onEventSelect, onAddEvent, compact = false, courseColorMap }: WeeklyScheduleGridProps) {
  const [activeEventKey, setActiveEventKey] = useState<string | null>(null);
  const minuteHeight = compact ? 0.5 : MINUTE_HEIGHT_PX;
  const timelineHeight = (DAY_END_MINUTES - DAY_START_MINUTES) * minuteHeight;
  const hourMarks = Array.from(
    { length: DAY_END_MINUTES / 60 - DAY_START_MINUTES / 60 },
    (_, index) => (DAY_START_MINUTES / 60 + index) * 60,
  );
  const { positionedByDay, unscheduledEvents, droppedCount } = buildPositionedEvents(events);
  const positionedCount = DAYS.reduce((count, day) => count + (positionedByDay.get(day)?.length ?? 0), 0);
  const conflictCount = DAYS.reduce(
    (count, day) => count + (positionedByDay.get(day) ?? []).filter((event) => event.overlapColumns > 1).length,
    0,
  );
  const visibleCount = positionedCount + unscheduledEvents.length;

  return (
    <div className="h-full flex flex-col" data-testid="weekly-grid-panel">
      {loading ? (
        <p className="text-xs text-muted-foreground" data-testid="weekly-grid-loading">
          Loading weekly schedule...
        </p>
      ) : (
        <>
          {visibleCount === 0 && (
            <p className="mb-2 text-xs text-muted-foreground" data-testid="weekly-grid-empty">
              No scheduled events yet.
            </p>
          )}

          {unscheduledEvents.length > 0 && (
            <div
              className="mb-3 rounded-lg border border-dashed border-border bg-background/60 p-3"
              data-testid="weekly-grid-unscheduled"
            >
              <p className="mb-2 text-xs font-semibold text-muted-foreground">Unscheduled / TBD</p>
              <div className="grid gap-2 md:grid-cols-2">
                {unscheduledEvents.map((event) => (
                  <article
                    key={buildEventInstanceKey(event)}
                    className="rounded-md border border-border/70 bg-amber-50/80 px-3 py-2 text-[8px]"
                    data-testid="weekly-grid-unscheduled-event"
                    role={onEventSelect ? "button" : "article"}
                    tabIndex={onEventSelect ? 0 : undefined}
                    aria-label={buildUnscheduledEventAriaLabel(event)}
                    onClick={() => onEventSelect?.(event)}
                    onKeyDown={(keyboardEvent) => {
                      if (keyboardEvent.key !== "Enter" && keyboardEvent.key !== " ") return;
                      keyboardEvent.preventDefault();
                      onEventSelect?.(event);
                    }}
                  >
                    <p className="font-semibold">{getEventCourseCode(event)}</p>
                    <p className="text-muted-foreground">{getEventCourseTitle(event)}</p>
                    <p className="text-muted-foreground/90">{getEventScheduleLabel(event)}</p>
                    <p className="text-muted-foreground/90">{getEventLocation(event)}</p>
                  </article>
                ))}
              </div>
            </div>
          )}

          {droppedCount > 0 && (
            <p className="mb-2 text-xs text-muted-foreground" data-testid="weekly-grid-dropped-note">
              {droppedCount} event{droppedCount === 1 ? "" : "s"} omitted due to invalid or out-of-range time data.
            </p>
          )}

          {conflictCount > 0 && (
            <p
              className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800"
              data-testid="weekly-grid-conflict-note"
            >
              {conflictCount} calendar block{conflictCount === 1 ? "" : "s"} overlap. Conflicting blocks are marked in amber.
            </p>
          )}

          <div className={`flex-1 ${compact ? "overflow-y-auto overflow-x-hidden" : "overflow-y-auto overflow-x-auto"}`} data-testid="weekly-grid">
            <div className={`${compact ? "w-full" : "min-w-230"} rounded-lg border border-border bg-background/40`}>
              <div
                className="grid border-b border-border bg-background/70 text-[11px] font-medium text-muted-foreground"
                style={{ gridTemplateColumns: `${TIME_COLUMN_WIDTH_PX}px repeat(${DAYS.length}, minmax(0, 1fr))` }}
                data-testid="weekly-grid-header-row"
              >
                <div className="border-r border-border px-2 py-2 text-left">Time</div>
                {DAYS.map((day) => (
                  <div key={day} className="flex items-center justify-between gap-2 border-r border-border last:border-r-0 px-2 py-2 text-left">
                    <span>{compact ? day.slice(0, 2) : day}</span>
                    {onAddEvent ? (
                      <button
                        type="button"
                        className="rounded-full border border-border bg-background px-1.5 py-0 text-[11px] text-muted-foreground transition hover:text-foreground"
                        aria-label={`Add custom event on ${day}`}
                        onClick={() => onAddEvent(day)}
                      >
                        +
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="relative" style={{ height: `${timelineHeight}px` }}>
                <div
                  className="absolute inset-y-0 left-0 border-r border-border bg-background/30"
                  style={{ width: `${TIME_COLUMN_WIDTH_PX}px` }}
                  data-testid="weekly-grid-time-rail"
                >
                  {hourMarks.map((minuteMark) => {
                    const top = (minuteMark - DAY_START_MINUTES) * minuteHeight;
                    return (
                      <div
                        key={`label-${minuteMark}`}
                        className="absolute left-0 w-full px-2 text-[10px] text-muted-foreground"
                        style={{ top: `${top}px` }}
                      >
                        {formatHourLabel(minuteMark)}
                      </div>
                    );
                  })}
                </div>

                <div
                  className="absolute inset-y-0 right-0 grid"
                  style={{
                    left: `${TIME_COLUMN_WIDTH_PX}px`,
                    gridTemplateColumns: `repeat(${DAYS.length}, minmax(0, 1fr))`,
                  }}
                  data-testid="weekly-grid-day-columns"
                >
                  {DAYS.map((day) => (
                    <div
                      key={day}
                      className="relative border-r border-border last:border-r-0"
                      data-testid={`weekly-grid-day-${day}`}
                    >
                      {hourMarks.map((minuteMark) => {
                        const top = (minuteMark - DAY_START_MINUTES) * minuteHeight;
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
                        const instanceKey = buildEventInstanceKey(positioned.event);
                        const isActive = activeEventKey === instanceKey;
                        const hasConflict = positioned.overlapColumns > 1;
                        const isCustomEvent = positioned.event.eventType === "custom";
                        const courseColorVar = courseColorMap?.[positioned.event.courseCode.trim().toUpperCase()];
                        const baseColor = courseColorVar
                          ? `color-mix(in srgb, var(${courseColorVar}) 18%, white)`
                          : "var(--background)";
                        const borderColor = courseColorVar
                          ? `color-mix(in srgb, var(${courseColorVar}) 45%, white)`
                          : "var(--border)";
                        const pastelStyle = isCustomEvent
                          ? {
                              backgroundColor: "var(--color-grey)",
                              borderColor: "color-mix(in srgb, var(--color-grey) 70%, black)",
                              color: "var(--foreground)",
                            }
                          : {
                              backgroundColor: baseColor,
                              borderColor,
                              color: "var(--foreground)",
                            };
                        const eventStyle = hasConflict
                          ? {
                              ...pastelStyle,
                              borderColor: "rgb(245 158 11)",
                              boxShadow: isActive
                                ? "inset 3px 0 0 rgb(245 158 11), 0 10px 18px rgb(15 23 42 / 0.18)"
                                : "inset 3px 0 0 rgb(245 158 11), 0 1px 4px rgb(15 23 42 / 0.10)",
                            }
                          : pastelStyle;
                        const eventClassName = isCustomEvent
                          ? isActive
                            ? "h-full overflow-hidden rounded-md border px-1.5 py-1 text-[10px] leading-tight shadow-xl ring-2 ring-border -translate-y-px transition-all"
                            : "h-full overflow-hidden rounded-md border px-1.5 py-1 text-[10px] leading-tight shadow-sm transition-all"
                          : isActive
                            ? "h-full overflow-hidden rounded-md border px-1.5 py-1 text-[10px] leading-tight shadow-xl ring-2 ring-border -translate-y-px transition-all"
                            : "h-full overflow-hidden rounded-md border px-1.5 py-1 text-[10px] leading-tight shadow-sm transition-all";


                        return (
                          <div
                            key={instanceKey}
                            className="absolute px-0.5"
                            style={{
                              top: `${positioned.topPx * minuteHeight}px`,
                              height: `${positioned.heightPx * minuteHeight}px`,
                              left: `${leftPercent}%`,
                              width: `${widthPercent}%`,
                            }}
                          >
                            <div
                              className={eventClassName}
                              style={eventStyle}
                              data-testid="weekly-grid-event"
                              data-visual-state={isActive ? "focused" : "unfocused"}
                              data-dimmed="false"
                              data-conflicted={hasConflict ? "true" : "false"}
                              data-overlap-column={String(positioned.overlapColumn)}
                              data-overlap-columns={String(positioned.overlapColumns)}
                              data-overlap-group={String(positioned.overlapGroup)}
                              data-event-id={positioned.event.eventId}
                              data-event-type={positioned.event.eventType}
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
                              role={onEventSelect ? "button" : "article"}
                              tabIndex={0}
                              onFocus={() => setActiveEventKey(instanceKey)}
                              onBlur={() => setActiveEventKey((current) => (current === instanceKey ? null : current))}
                              onMouseEnter={() => setActiveEventKey(instanceKey)}
                              onMouseLeave={() => setActiveEventKey((current) => (current === instanceKey ? null : current))}
                              onClick={() => {
                                setActiveEventKey(instanceKey);
                                onEventSelect?.(positioned.event);
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter" && event.key !== " ") return;
                                event.preventDefault();
                                setActiveEventKey(instanceKey);
                                onEventSelect?.(positioned.event);
                              }}
                            >
                              <p className="text-[8px] leading-tight overflow-hidden">
                                <span className="font-semibold">{getEventCourseCode(positioned.event)}</span>{" "}
                                <CourseTitleWrapped title={getEventCourseTitle(positioned.event)} />
                              </p>
                              {hasConflict && (
                                <span
                                  className="mt-0.5 inline-flex rounded-sm bg-amber-500 px-1 py-px text-[7px] font-semibold uppercase leading-none text-amber-950"
                                  data-testid="weekly-grid-conflict-badge"
                                >
                                  Conflict
                                </span>
                              )}
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
