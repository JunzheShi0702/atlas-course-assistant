import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface DegreeAndGraduationValue {
  degree: string;
  graduationMonth: string;
  graduationYear: string;
}

interface DegreeAndGraduationProps {
  value: DegreeAndGraduationValue;
  onChange: (value: DegreeAndGraduationValue) => void;
}

const DEGREE_OPTIONS = ["BS", "BA"];
const MONTH_OPTIONS = ["May", "August", "December"];
const YEAR_OPTIONS = ["2026", "2027", "2028", "2029", "2030"];

export default function DegreeAndGraduation({ value, onChange }: DegreeAndGraduationProps) {
  return (
    <Card className="border-0 shadow-none">
      <CardHeader className="space-y-2">
        <Badge className="w-fit">Section 1</Badge>
        <CardTitle>Degree & Graduation</CardTitle>
        <CardDescription>Select your degree and expected graduation month/year.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-medium">Degree</p>
          <div className="flex flex-wrap gap-2">
            {DEGREE_OPTIONS.map((option) => (
              <Button
                key={option}
                type="button"
                variant={value.degree === option ? "default" : "outline"}
                onClick={() => onChange({ ...value, degree: option })}
              >
                {option}
              </Button>
            ))}
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <p className="text-sm font-medium">Graduation Month</p>
          <div className="flex flex-wrap gap-2">
            {MONTH_OPTIONS.map((option) => (
              <Button
                key={option}
                type="button"
                variant={value.graduationMonth === option ? "default" : "outline"}
                onClick={() => onChange({ ...value, graduationMonth: option })}
              >
                {option}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Graduation Year</p>
          <div className="flex flex-wrap gap-2">
            {YEAR_OPTIONS.map((option) => (
              <Button
                key={option}
                type="button"
                variant={value.graduationYear === option ? "default" : "outline"}
                onClick={() => onChange({ ...value, graduationYear: option })}
              >
                {option}
              </Button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
