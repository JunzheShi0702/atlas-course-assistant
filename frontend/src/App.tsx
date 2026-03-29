import { useLocation, useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import Onboard from "@/components/Onboard";
import { BookOpen, CalendarDays, MessageSquare, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-1 min-h-0 items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg space-y-10">
        {/* Hero */}
        <div className="text-center space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Sparkles className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Welcome to Atlas
          </h1>
          <p className="text-muted-foreground leading-relaxed">
            Your AI-powered JHU course advisor. Build your schedule, explore
            courses, and get personalized advice — all in one place.
          </p>
        </div>

        {/* CTA */}
        <div className="flex justify-center">
          <Button
            size="lg"
            className="gap-2 px-8"
            onClick={() => navigate("/schedules")}
          >
            <CalendarDays className="h-5 w-5" />
            Go to My Schedules
          </Button>
        </div>

        {/* Feature hints */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-center">
          {[
            {
              icon: <BookOpen className="h-5 w-5" />,
              label: "Browse courses",
              detail: "Search by topic, code, or instructor",
            },
            {
              icon: <CalendarDays className="h-5 w-5" />,
              label: "Build schedules",
              detail: "Create and compare semester plans",
            },
            {
              icon: <MessageSquare className="h-5 w-5" />,
              label: "Chat with AI",
              detail: "Get advice on workload and fit",
            },
          ].map(({ icon, label, detail }) => (
            <div
              key={label}
              className="rounded-xl border border-border bg-muted/30 p-4 space-y-1.5"
            >
              <div className="flex justify-center text-primary">{icon}</div>
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground">{detail}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { pathname } = useLocation();
  const isOnboarding = pathname === "/onboarding";

  return (
    <div className="app-root">
      <Header
        title={
          isOnboarding
            ? "Atlas: Preference Survey"
            : "Atlas: Your 24/7 Course Advisor"
        }
      />

      {isOnboarding ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <Onboard />
        </div>
      ) : (
        <HomePage />
      )}
    </div>
  );
}
