import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";

/**
 * Schedule page shell — route: /schedules/:id
 *
 * The full layout (course list, audit panel, chat) is implemented in #121.
 * This stub sets up the route and navigation so #116 acceptance criteria are met.
 */
export default function SchedulePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  return (
    <div className="app-root">
      <Header title="Atlas: Your 24/7 Course Advisor" />

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <div className="flex items-center gap-3 mb-8">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/schedules")}
              aria-label="Back to schedules"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight">
                  Schedule
                </h1>
                <p className="text-xs text-muted-foreground font-mono">{id}</p>
              </div>
            </div>
          </div>

          <div
            data-testid="schedule-page-content"
            className="flex flex-col items-center justify-center gap-3 py-24 text-center text-muted-foreground"
          >
            <p className="text-sm">
              Course list, audit panel, and chat panel coming soon.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
