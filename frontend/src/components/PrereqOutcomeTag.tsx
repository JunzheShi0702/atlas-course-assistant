import { cn } from "@/lib/utils";

export type PrereqOutcome = "fulfilled" | "taken" | "missing prereq" | "override" | "loading" | "unknown";

type PrereqOutcomeTagProps = {
  outcome: PrereqOutcome;
  className?: string;
  testId?: string;
  label?: string;
};

const OUTCOME_CLASSES: Record<PrereqOutcome, string> = {
  fulfilled: "border-emerald-300 bg-emerald-100 text-emerald-700",
  "missing prereq": "border-amber-300 bg-amber-100 text-amber-800",
  taken: "border-rose-300 bg-rose-100 text-rose-700",
  override: "border-rose-300 bg-rose-100 text-rose-700",
  loading: "border-slate-300 bg-slate-100 text-slate-700",
  unknown: "border-slate-300 bg-slate-100 text-slate-700",
};

const toSentenceCase = (value: string) => {
  if (!value) return value;
  return value[0].toUpperCase() + value.slice(1);
};

export default function PrereqOutcomeTag({ outcome, className, testId, label }: PrereqOutcomeTagProps) {
  return (
    <span
      className={cn(
        "inline-flex border px-2 py-0.5 text-[10px] font-semibold tracking-wide",
        OUTCOME_CLASSES[outcome],
        className,
      )}
      data-testid={testId}
    >
      {label ?? toSentenceCase(outcome)}
    </span>
  );
}
