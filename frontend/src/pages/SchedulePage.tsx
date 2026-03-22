import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, BookOpen, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import ScheduleChat from "@/components/ScheduleChat";

/**
 * Schedule page — route: /schedules/:id
 *
 * Layout:
 *   Left  (primary, ~60%): ScheduleChat panel (#121)
 *   Right (sidebar, ~40%): Course list stub + Audit panel stub
 *     - Course list content: #117 (@JunzheShi0702)
 *     - Audit panel: #118 (@chjenniferhede)
 */
export default function SchedulePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  return (
    <div className="app-root">
      <Header title="Atlas: Your 24/7 Course Advisor" />

      {/* Page sub-header */}
      <div className="shrink-0 border-b border-border bg-background px-4 py-2.5 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => navigate("/schedules")}
          aria-label="Back to schedules"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-sm font-semibold leading-tight">Schedule</h1>
          <p className="text-xs text-muted-foreground font-mono">{id}</p>
        </div>
      </div>

      {/* Main split layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: Chat panel */}
        <div className="flex flex-col flex-1 min-w-0 border-r border-border">
          <ScheduleChat scheduleId={id ?? ""} />
        </div>

        {/* Right: Course list + Audit panel */}
        <div
          className="hidden md:flex flex-col w-80 lg:w-96 shrink-0 overflow-y-auto"
          data-testid="schedule-page-content"
        >
          {/* Course list section */}
          <div className="border-b border-border p-4">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Courses</h2>
            </div>
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center rounded-xl border border-dashed border-border bg-muted/30">
              <BookOpen className="h-6 w-6 text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">
                Add/remove courses coming soon
              </p>
              <p className="text-xs text-muted-foreground/60">(#117)</p>
            </div>
          </div>

          {/* Audit panel section */}
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Schedule audit</h2>
            </div>
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center rounded-xl border border-dashed border-border bg-muted/30">
              <ClipboardList className="h-6 w-6 text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">
                Workload audit coming soon
              </p>
              <p className="text-xs text-muted-foreground/60">(#118)</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
