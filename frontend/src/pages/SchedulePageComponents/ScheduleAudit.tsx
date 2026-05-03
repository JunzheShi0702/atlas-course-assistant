import { ClipboardList, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  ScheduleAuditFinding,
  ScheduleAuditRecommendation,
  ScheduleDetail,
  ScheduleGoalAlignment,
} from "@/types/schedules";

type AuditView = {
  workloadRange: string | null;
  narrative: string | null;
  missingData: string | null;
  goalAlignment: ScheduleGoalAlignment | null;
  findings: ScheduleAuditFinding[];
  recommendations: ScheduleAuditRecommendation[];
};

type ScheduleAuditProps = {
  hasAudit: boolean;
  auditError: string | null;
  schedule: ScheduleDetail | null;
  runningAudit: boolean;
  onRunAudit: () => void;
  auditView: AuditView;
  alignmentBullets: { matches: string[]; conflicts: string[] };
};

export default function ScheduleAudit({
  hasAudit,
  auditError,
  schedule,
  runningAudit,
  onRunAudit,
  auditView,
  alignmentBullets,
}: ScheduleAuditProps) {
  const formatRelativeRun = (value?: string | null) => {
    if (!value) return "not yet";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "not yet";
    const diffMs = Date.now() - parsed.getTime();
    const minutes = Math.max(1, Math.floor(diffMs / 60_000));
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  };

  return (
    <div className="hidden h-full w-full md:flex flex-col overflow-hidden">
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
              <Button
                type="button"
                variant="default"
                size="sm"
                className="w-full h-8 text-xs justify-between"
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
                    <span className="truncate">
                      Last run {formatRelativeRun(schedule?.latestAudit?.createdAt)}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="text-muted-foreground/70">|</span>
                      <RefreshCw className="h-3.5 w-3.5" />
                      Re-run
                    </span>
                  </>
                )}
              </Button>

              {auditError && (
                <p className="rounded-md border border-destructive/20 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                  {auditError}
                </p>
              )}

              {auditView.missingData && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
                  <p className="text-[11px] font-semibold text-amber-800">
                    Missing evaluation data
                  </p>
                  <p className="mt-0.5 text-[11px] text-amber-800">
                    {auditView.missingData}
                  </p>
                </div>
              )}
              
              <div className="space-y-1">
                <span className="text-[13px] font-semibold text-mauve-900">Weekly Workload</span>
                <p className="leading-relaxed text-[13px]">
                  {auditView.workloadRange ?? "Not available"}
                </p>
              </div>

              {/* Narrative summary */}
              <div>
                <p className="text-[13px] font-semibold text-mauve-900 mb-1">Narrative Summary</p>
                <p className="leading-relaxed text-[13px]">
                  {auditView.narrative ?? "No narrative summary returned."}
                </p>
              </div>

              {/* Goal Alignment */}
              <div>
                <p className="text-[13px] font-semibold text-mauve-900 mb-1">Goal Alignment</p>
                {auditView.goalAlignment ? (
                  <div className="space-y-2 text-[13px]">
                    <p className="leading-relaxed">{auditView.goalAlignment.rationale}</p>
                    {alignmentBullets.matches.length > 0 && (
                      <div className="border-l-2 border-emerald-300/70 pl-2">
                        <p className="text-xs font-semibold text-muted-foreground mb-1">Match</p>
                        <ul className="space-y-1">
                          {alignmentBullets.matches.map((match) => (
                            <li key={match}>- {match}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {alignmentBullets.conflicts.length > 0 && (
                      <div className="border-l-2 border-rose-300/70 pl-2">
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

              {auditView.recommendations.length > 0 && (
                <div>
                  <p className="text-[13px] font-semibold text-mauve-900 mb-1">Recommendations</p>
                  <ul className="space-y-1 text-[13px]">
                    {auditView.recommendations.map((recommendation) => (
                      <li key={`${recommendation.courseCode}-${recommendation.term}`}>
                        {recommendation.courseCode} {recommendation.title}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
