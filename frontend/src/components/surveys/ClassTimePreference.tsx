import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ClassTimePreferenceProps {
  value: string;
  onChange: (value: string) => void;
}

const TIME_OPTIONS = [
  "Morning (8am-12pm)",
  "Afternoon (12pm-5pm)",
  "Evening (5pm+)",
  "No Preference",
];

export default function ClassTimePreference({ value, onChange }: ClassTimePreferenceProps) {
  return (
    <Card className="border-0 shadow-none">
      <CardHeader className="space-y-2">
        <CardTitle>Class Time Preference</CardTitle>
        <CardDescription>Tell us when you prefer to take classes.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {TIME_OPTIONS.map((option) => (
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
      </CardContent>
    </Card>
  );
}
