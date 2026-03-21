import { useRef } from "react";
import type { MouseEvent, PointerEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface WorkloadPreference {
  workload: number; // 0 light -> 1 heavy
  focusBreadth: number; // 0 closely-related -> 1 open-spanned
}

/** Human-readable summary for API / profile storage (matches on-screen badge copy). */
export function describeWorkloadPreference(value: WorkloadPreference): string {
  const workloadLabel =
    value.workload < 0.34 ? "Light" : value.workload < 0.67 ? "Medium" : "Heavy";
  const breadthLabel =
    value.focusBreadth < 0.34
      ? "Closely-related"
      : value.focusBreadth < 0.67
        ? "Balanced"
        : "Open-spanned";

  const workloadCommitment =
    workloadLabel === "Light"
      ? 1 - value.workload
      : workloadLabel === "Heavy"
        ? value.workload
        : 0;
  const breadthCommitment =
    breadthLabel === "Closely-related"
      ? 1 - value.focusBreadth
      : breadthLabel === "Open-spanned"
        ? value.focusBreadth
        : 0;
  const emphasisDelta = workloadCommitment - breadthCommitment;
  const emphasis =
    Math.abs(emphasisDelta) < 0.14
      ? ""
      : emphasisDelta > 0
        ? " (with emphasis on workload intensity)"
        : " (with emphasis on course coverage breadth)";

  return `${workloadLabel} workload with ${breadthLabel.toLowerCase()} coursework${emphasis}`;
}

/**
 * Best-effort inverse of {@link describeWorkloadPreference} for hydrating the 2D plane from saved text.
 */
export function approximateWorkloadFromDescription(text: string | null | undefined): WorkloadPreference | null {
  if (!text?.trim()) return null;
  const t = text.toLowerCase();

  let workload = 0.5;
  if (/\blight\b/.test(t)) workload = 0.2;
  else if (/\bmedium\b/.test(t)) workload = 0.5;
  else if (/\bheavy\b/.test(t)) workload = 0.82;

  let focusBreadth = 0.5;
  if (/closely-related|closely related/.test(t)) focusBreadth = 0.2;
  else if (/open-spanned|open spanned/.test(t)) focusBreadth = 0.82;
  else if (/\bbalanced\b/.test(t)) focusBreadth = 0.5;

  if (/emphasis on workload intensity/.test(t)) {
    workload = Math.min(0.96, workload + 0.14);
  }
  if (/emphasis on course coverage breadth/.test(t)) {
    focusBreadth = Math.min(0.96, focusBreadth + 0.14);
  }

  return {
    workload: Math.max(0, Math.min(1, workload)),
    focusBreadth: Math.max(0, Math.min(1, focusBreadth)),
  };
}

interface WorkloadToleranceProps {
  value: WorkloadPreference | null;
  onChange: (value: WorkloadPreference) => void;
}

export default function WorkloadTolerance({ value, onChange }: WorkloadToleranceProps) {
  const draggingPointerId = useRef<number | null>(null);

  const handlePlaneClick = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    // y-axis is top->bottom, so invert for low->high workload.
    const workload = Math.max(0, Math.min(1, 1 - y));
    const focusBreadth = Math.max(0, Math.min(1, x));
    onChange({ workload, focusBreadth });
  };
  const updateFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const workload = Math.max(0, Math.min(1, 1 - y));
    const focusBreadth = Math.max(0, Math.min(1, x));
    onChange({ workload, focusBreadth });
  };

  const preferenceDescription = value
    ? describeWorkloadPreference(value)
    : "Choose a point to generate your workload and coverage preference summary.";

  return (
    <Card className="border-0 shadow-none">
      <CardHeader className="space-y-2">
        <CardTitle>Workload Tolerance</CardTitle>
        <CardDescription>
          Click a point on the plane to indicate both workload intensity and course-focus breadth.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-center text-xs text-muted-foreground">
            <span>High workload</span>
          </div>

          <div className="grid grid-cols-[max-content_minmax(0,1fr)_max-content] items-center gap-x-3">
            <span className="justify-self-end text-xs text-muted-foreground whitespace-nowrap">
              Closely-related
            </span>
          <div
            role="button"
            tabIndex={0}
            aria-label="Select workload and focus breadth preference"
            className="relative mx-auto h-56 w-full max-w-[560px] cursor-crosshair rounded-lg border bg-gradient-to-br from-primary/10 via-background to-accent/20"
            onClick={handlePlaneClick}
            onPointerDown={(event) => {
              draggingPointerId.current = event.pointerId;
              event.currentTarget.setPointerCapture(event.pointerId);
              updateFromPointer(event);
            }}
            onPointerMove={(event) => {
              if (draggingPointerId.current === event.pointerId) {
                updateFromPointer(event);
              }
            }}
            onPointerUp={(event) => {
              if (draggingPointerId.current === event.pointerId) {
                draggingPointerId.current = null;
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerCancel={(event) => {
              if (draggingPointerId.current === event.pointerId) {
                draggingPointerId.current = null;
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") e.preventDefault();
            }}
          >
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-25">
              {Array.from({ length: 9 }).map((_, idx) => (
                <div key={idx} className="border border-border/60" />
              ))}
            </div>

            {/* Centered dashed cross axes */}
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute left-1/2 top-3 bottom-3 w-px -translate-x-1/2 border-l border-dashed border-foreground/60" />
              <div className="absolute left-3 right-3 top-1/2 h-px -translate-y-1/2 border-t border-dashed border-foreground/60" />
            </div>

            {value && (
              <div
                className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow"
                style={{
                  left: `${value.focusBreadth * 100}%`,
                  top: `${(1 - value.workload) * 100}%`,
                }}
              />
            )}
          </div>
            <span className="justify-self-start text-xs text-muted-foreground whitespace-nowrap">
              Open-spanned
            </span>
          </div>

          <div className="flex justify-center text-xs text-muted-foreground">
            <span>Low workload</span>
          </div>
        </div>

        <Badge className="w-fit" variant="secondary">{preferenceDescription}</Badge>
      </CardContent>
    </Card>
  );
}
