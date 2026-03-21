import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface WorkloadToleranceProps {
  value: string;
  onChange: (value: string) => void;
}

const WORKLOAD_OPTIONS = [
  { label: "Light", hint: "Keep workload manageable." },
  { label: "Balanced", hint: "Mix challenge and flexibility." },
  { label: "Heavy", hint: "I can handle demanding coursework." },
];

export default function WorkloadTolerance({ value, onChange }: WorkloadToleranceProps) {
  return (
    <Card className="border-0 shadow-none">
      <CardHeader className="space-y-2">
        <CardTitle>Workload Tolerance</CardTitle>
        <CardDescription>How intense should your recommended schedule be?</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {WORKLOAD_OPTIONS.map((option) => (
          <Button
            key={option.label}
            type="button"
            variant={value === option.label ? "default" : "outline"}
            className="w-full h-auto justify-start py-3"
            onClick={() => onChange(option.label)}
          >
            <span className="text-left">
              <span className="block font-semibold">{option.label}</span>
              <span className="block text-xs opacity-80">{option.hint}</span>
            </span>
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}
