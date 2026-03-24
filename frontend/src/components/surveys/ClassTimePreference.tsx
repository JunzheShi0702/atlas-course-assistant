import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export const CLASS_TIME_RANGE_OPTIONS = [
  "Early Morning (before 10am)",
  "Morning (10am-12pm)",
  "Mid Day (12pm-3pm)",
  "Afternoon (3pm-6pm)",
  "Evening (after 6pm)",
] as const;
export const CLASS_DAY_OPTIONS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

export interface ClassTimePreferenceValue {
  selectedTimes: string[];
  selectedDays: string[];
  customPreference: string;
  noPreference: boolean;
}

interface ClassTimePreferenceProps {
  value: ClassTimePreferenceValue;
  onChange: (value: ClassTimePreferenceValue) => void;
}

export default function ClassTimePreference({ value, onChange }: ClassTimePreferenceProps) {
  const toggleTime = (time: string) => {
    onChange({
      ...value,
      noPreference: false,
      customPreference: "",
      selectedTimes: value.selectedTimes.includes(time)
        ? value.selectedTimes.filter((t) => t !== time)
        : [...value.selectedTimes, time],
    });
  };

  const toggleDay = (day: string) => {
    onChange({
      ...value,
      noPreference: false,
      customPreference: "",
      selectedDays: value.selectedDays.includes(day)
        ? value.selectedDays.filter((d) => d !== day)
        : [...value.selectedDays, day],
    });
  };

  const toggleNoPreference = () => {
    const turningOn = !value.noPreference;
    onChange({
      ...value,
      noPreference: turningOn,
      selectedTimes: turningOn ? [] : value.selectedTimes,
      selectedDays: turningOn ? [] : value.selectedDays,
      customPreference: turningOn ? "" : value.customPreference,
    });
  };

  return (
    <Card className="border-0 shadow-none">
      <CardHeader className="space-y-2">
        <CardTitle>Class Time Preference</CardTitle>
        <CardDescription>
          Let Altas know your preferred class times.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="space-y-2">
          <p className="text-sm font-medium">When do you want to take your classes?</p>
          <p className="text-xs text-muted-foreground">Choose at least two time ranges and at least two days.</p>
          <div className="grid gap-2 sm:grid-cols-5">
          {CLASS_TIME_RANGE_OPTIONS.map((option) => (
            <Button
              key={option}
              type="button"
              variant={value.selectedTimes.includes(option) ? "default" : "outline"}
              className="justify-center h-auto py-3 whitespace-normal"
              onClick={() => toggleTime(option)}
            >
              {option}
            </Button>
          ))}
          </div>
          <div className="grid grid-cols-5 gap-2">
          {CLASS_DAY_OPTIONS.map((day) => (
            <Button
              key={day}
              type="button"
              variant={value.selectedDays.includes(day) ? "default" : "outline"}
              className="justify-center h-auto py-3"
              onClick={() => toggleDay(day)}
            >
              {day}
            </Button>
          ))}
          </div>
        </div>

        <div className="mt-1 space-y-2">
          <p className="text-sm font-medium">Or enter your preferences through text</p>
          <Textarea
            value={value.customPreference}
            onChange={(e) => {
              const next = e.target.value;
              onChange({
                ...value,
                noPreference: false,
                selectedTimes: next.trim() ? [] : value.selectedTimes,
                selectedDays: next.trim() ? [] : value.selectedDays,
                customPreference: next,
              });
            }}
            placeholder="Example: Prefer Tue/Thu afternoons, avoid early mornings."
            rows={3}
            className="resize-none"
          />
        </div>

        <div className="mt-2">
          <p className="mb-2 text-sm font-medium">Or</p>
          <Button type="button" variant={value.noPreference ? "default" : "outline"} onClick={toggleNoPreference}>
            No Preference
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
