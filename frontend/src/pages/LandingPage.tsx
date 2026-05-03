import { BookOpen, CalendarDays, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import atlasLogo from "@/lib/logo.png";

const featureCards = [
  {
    icon: BookOpen,
    title: "Find the right courses",
    description:
      "Search JHU offerings by topic, code, instructor, or natural language — Atlas surfaces what fits your goals.",
  },
  {
    icon: CalendarDays,
    title: "Build conflict-free schedules",
    description:
      "Drag courses into semester plans, spot workload imbalances, and lock in a schedule you're confident about.",
  },
  {
    icon: MessageSquare,
    title: "Ask anything about your semester",
    description:
      "Get instant comparisons, workload estimates, and personalized advice — backed by real SIS and evaluation data.",
  },
];

export default function LandingPage() {
  const { login } = useAuth();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_45%),linear-gradient(180deg,_#f8fafc_0%,_#eff6ff_100%)] text-slate-950">
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8 sm:px-10 lg:px-12">
        <header className="py-4">
          <img src={atlasLogo} alt="Atlas logo" className="h-11 w-auto object-contain" />
        </header>

        <section className="flex flex-1 items-center py-10 lg:py-16">
          <div className="grid w-full gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div className="max-w-2xl space-y-6">
              <div className="space-y-4">
                <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                  Your JHU semester, planned in minutes.
                </h1>
                <p className="max-w-xl text-lg leading-8 text-slate-700">
                  Atlas brings together JHU course search, schedule building, and AI advising in one place — so you spend less time on logistics and more time on what matters.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  type="button"
                  size="lg"
                  onClick={login}
                  className="bg-sky-600 text-white hover:bg-sky-700"
                >
                  Login via Google
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
