import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

interface CareerGoalProps {
  selectedGoals: string[];
  customGoal: string;
  stillExploring: boolean;
  onToggleGoal: (value: string) => void;
  onCustomGoalChange: (value: string) => void;
  onToggleStillExploring: () => void;
}

const GOAL_OPTIONS = [
  "Software Engineering",
  "Data Science / Finance",
  "AI / Machine Learning",
  "Medical School",
  "Research / Graduate School",
  "Product / Startup",
];

export default function CareerGoal({
  selectedGoals,
  customGoal,
  stillExploring,
  onToggleGoal,
  onCustomGoalChange,
  onToggleStillExploring,
}: CareerGoalProps) {
  return (
    <Card className="border-0 shadow-none">
      <CardHeader className="space-y-2">
        <CardTitle>Career Goal</CardTitle>
        <CardDescription>Pick the direction you want Atlas to optimize for.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-2">
          {GOAL_OPTIONS.map((option) => (
            <Button
              key={option}
              type="button"
              variant={selectedGoals.includes(option) ? "default" : "outline"}
              className="justify-start h-auto py-3 whitespace-normal"
              onClick={() => onToggleGoal(option)}
            >
              {option}
            </Button>
          ))}
        </div>
        <div className="mt-4 space-y-2">
          <p className="text-sm font-medium">Or describe your own career goal</p>
          <Textarea
            value={customGoal}
            onChange={(e) => onCustomGoalChange(e.target.value)}
            placeholder="Example: Quant research in finance, with strong ML and systems foundations."
            rows={3}
            className="resize-none"
          />
        </div>
        <div className="mt-3">
          <p className="mb-2 text-sm font-medium">Or</p>
          <Button
            type="button"
            variant={stillExploring ? "default" : "outline"}
            onClick={onToggleStillExploring}
          >
            Still Exploring, Skip for now
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
