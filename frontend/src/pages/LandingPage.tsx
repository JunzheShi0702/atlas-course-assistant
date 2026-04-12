import { BookOpen, CalendarDays, MessageSquare, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

const featureCards = [
  {
    icon: BookOpen,
    title: "Find relevant courses",
    description:
      "Search JHU undergraduate offerings by topic, code, instructor, and schedule constraints.",
  },
  {
    icon: CalendarDays,
    title: "Build schedules faster",
    description:
      "Organize courses into semester plans and review workload before committing to a schedule.",
  },
  {
    icon: MessageSquare,
    title: "Get AI planning help",
    description:
      "Ask Atlas for course comparisons, schedule advice, and personalized planning guidance.",
  },
];

export default function LandingPage() {
  const { login } = useAuth();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_45%),linear-gradient(180deg,_#f8fafc_0%,_#eff6ff_100%)] text-slate-950">
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8 sm:px-10 lg:px-12">
        <header className="py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-600 text-white shadow-sm">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-lg font-semibold tracking-tight">Atlas</p>
              <p className="text-sm text-slate-600">AI schedule planning for JHU undergraduates</p>
            </div>
          </div>
        </header>

        <section className="flex flex-1 items-center py-10 lg:py-16">
          <div className="grid w-full gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div className="max-w-2xl space-y-6">
              <div className="inline-flex items-center rounded-full border border-sky-200 bg-white/80 px-3 py-1 text-sm text-sky-800 shadow-sm">
                Atlas helps students plan schedules with SIS and course evaluation data
              </div>

              <div className="space-y-4">
                <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                  Plan a better semester with grounded AI feedback.
                </h1>
                <p className="max-w-xl text-lg leading-8 text-slate-700">
                  Atlas combines JHU course data, schedule building, and AI advising so you can
                  compare options, check workload, and make faster planning decisions.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  type="button"
                  size="lg"
                  onClick={login}
                  className="bg-sky-600 text-white hover:bg-sky-700"
                >
                  Start planning
                </Button>
              </div>
            </div>

            <div className="grid gap-4">
              {featureCards.map(({ icon: Icon, title, description }) => (
                <article
                  key={title}
                  className="rounded-3xl border border-white/80 bg-white/80 p-6 shadow-[0_18px_40px_rgba(15,23,42,0.08)] backdrop-blur"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h2 className="mt-4 text-lg font-semibold text-slate-950">{title}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
