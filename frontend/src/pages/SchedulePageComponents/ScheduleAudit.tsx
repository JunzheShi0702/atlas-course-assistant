import { ClipboardList, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  ScheduleAuditFinding,
  ScheduleDetail,
  ScheduleGoalAlignment,
} from "@/types/schedules";

type AuditView = {
  workloadRange: string | null;
  narrative: string | null;
  missingData: string | null;
  goalAlignment: ScheduleGoalAlignment | null;
  findings: ScheduleAuditFinding[];
};

type ScheduleAuditProps = {
  hasAudit: boolean;
  auditError: string | null;
  schedule: ScheduleDetail | null;
  runningAudit: boolean;
  onRunAudit: () => void;
  auditView: AuditView;
  alignmentBullets: { matches: string[]; conflicts: string[] };
  lastRunLabel: string | null;
};

export default function ScheduleAudit({
  hasAudit,
  auditError,
  schedule,
  runningAudit,
  onRunAudit,
  auditView,
  alignmentBullets,
  lastRunLabel,
}: ScheduleAuditProps) {
  return (
    <div className="hidden md:flex flex-col w-72 lg:w-80 shrink-0 overflow-hidden">
      <div className="flex-1 min-h-0 p-4 flex flex-col">
        <div className="flex items-center gap-2 mb-3">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Schedule audit</h2>
        </div>
        <div className="min-h-0 overflow-y-auto flex-1 flex flex-col gap-3">
          {!hasAudit && (
            <>
              <Button
                type="button"
                variant="default"
                size="sm"
                className="w-full h-8 text-xs"
                onClick={onRunAudit}
                disabled={!schedule || runningAudit}
              >
                {runningAudit ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Running…
                  </>
                ) : (
                  "Run workload audit"
                )}
              </Button>

              {auditError && (
                <p className="rounded-md border border-destructive/20 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                  {auditError}
                </p>
              )}
            </>
          )}

          {hasAudit && (
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  {lastRunLabel ? `Last run: ${lastRunLabel}` : "Last run: not yet"}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={onRunAudit}
                  disabled={!schedule || runningAudit}
                >
                  {runningAudit ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Running…
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      Re-run
                    </>
                  )}
                </Button>
              </div>

              {auditError && (
                <p className="rounded-md border border-destructive/20 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                  {auditError}
                </p>
              )}

              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Weekly workload</span>
                <span className="font-medium text-right">{auditView.workloadRange ?? "Not available"}</span>
              </div>

              {auditView.missingData && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
                  <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-200">
                    Missing evaluation data
                  </p>
                  <p className="mt-0.5 text-[11px] text-amber-800 dark:text-amber-200">
                    {auditView.missingData}
                  </p>
                </div>
              )}

              <div>
                <p className="text-[11px] font-semibold text-muted-foreground mb-1">Narrative summary</p>
                <p className="leading-relaxed text-sm">
                  {auditView.narrative ?? "No narrative summary returned."}
                </p>
              </div>

              <div>
                <p className="text-[11px] font-semibold text-muted-foreground mb-1">Goal Alignment</p>
                {auditView.goalAlignment ? (
                  <div className="space-y-2 text-sm">
                    <p className="leading-relaxed">{auditView.goalAlignment.rationale}</p>
                    {alignmentBullets.matches.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-1">Matches</p>
                        <ul className="space-y-1">
                          {alignmentBullets.matches.map((match) => (
                            <li key={match}>- {match}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {alignmentBullets.conflicts.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-1">Conflicts</p>
                        <ul className="space-y-1">
                          {alignmentBullets.conflicts.map((conflict) => (
                            <li key={conflict}>- {conflict}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm leading-relaxed">No goal-alignment analysis returned.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
