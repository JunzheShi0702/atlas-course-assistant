import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface CareerGoalProps {
  value: string;
  onChange: (value: string) => void;
}

const GOAL_OPTIONS = [
  "Software Engineering",
  "Data Science / AI",
  "Research / Graduate School",
  "Product / Startup",
  "Still Exploring",
];

export default function CareerGoal({ value, onChange }: CareerGoalProps) {
  return (
    <Card className="border-0 shadow-none">
      <CardHeader className="space-y-2">
        <Badge className="w-fit">Section 2</Badge>
        <CardTitle>Career Goal</CardTitle>
        <CardDescription>Pick the direction you want Atlas to optimize for.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-2">
          {GOAL_OPTIONS.map((option) => (
            <Button
              key={option}
              type="button"
              variant={value === option ? "default" : "outline"}
              className="justify-start h-auto py-3 whitespace-normal"
              onClick={() => onChange(option)}
            >
              {option}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
