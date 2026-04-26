import { Link } from "react-router-dom";

export default function NotFoundPage() {
  const destination = { to: "/", label: "Go to Atlas" };

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-16 text-slate-900">
      <div className="mx-auto flex max-w-2xl flex-col items-start gap-6 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">404</p>
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Page not found</h1>
          <p className="max-w-xl text-sm leading-6 text-slate-600">
            The page you were looking for does not exist or may have moved. Try heading back to a valid Atlas page.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            to={destination.to}
            className="inline-flex items-center rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            {destination.label}
          </Link>
        </div>
      </div>
    </main>
  );
}
