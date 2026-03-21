import { useMemo, useState } from "react";
import CareerGoal from "@/components/surveys/CareerGoal";
import ClassTimePreference from "@/components/surveys/ClassTimePreference";
import type { ClassTimePreferenceValue } from "@/components/surveys/ClassTimePreference";
import DegreeAndGraduation from "@/components/surveys/DegreeAndGraduation";
import type { DegreeAndGraduationValue } from "@/components/surveys/DegreeAndGraduation";
import WorkloadTolerance from "@/components/surveys/WorkloadTolerance";
import type { WorkloadPreference } from "@/components/surveys/WorkloadTolerance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface SurveyState {
  degreeAndGraduation: DegreeAndGraduationValue;
  careerGoal: {
    selected: string[];
    custom: string;
    stillExploring: boolean;
  };
  workloadTolerance: WorkloadPreference | null;
  classTimePreference: ClassTimePreferenceValue;
}

const TOTAL_STEPS = 4;

export default function Onboard() {
  const [step, setStep] = useState(1);
  const [survey, setSurvey] = useState<SurveyState>({
    degreeAndGraduation: {
      graduationMonth: "",
      graduationYear: "",
      programs: [],
    },
    careerGoal: {
      selected: [],
      custom: "",
      stillExploring: false,
    },
    workloadTolerance: null,
    classTimePreference: {
      selectedTimes: [],
      selectedDays: [],
      customPreference: "",
      noPreference: false,
    },
  });

  const stepComplete = useMemo(() => {
    const degreeDone =
      Boolean(survey.degreeAndGraduation.graduationMonth) &&
      Boolean(survey.degreeAndGraduation.graduationYear) &&
      survey.degreeAndGraduation.programs.some((program) => program.kind === "major");
    const careerDone =
      survey.careerGoal.selected.length > 0 ||
      Boolean(survey.careerGoal.custom.trim()) ||
      survey.careerGoal.stillExploring;
    const workloadDone = Boolean(survey.workloadTolerance);
    const ctp = survey.classTimePreference;
    // Step 4: (≥2 time slots AND ≥2 weekdays) OR non-empty custom text OR No Preference
    const timeDone =
      ctp.noPreference ||
      Boolean(ctp.customPreference.trim()) ||
      (ctp.selectedTimes.length >= 2 && ctp.selectedDays.length >= 2);
    return [degreeDone, careerDone, workloadDone, timeDone];
  }, [survey]);

  const canProceed = stepComplete[step - 1];
  const allDone = stepComplete.every(Boolean);

  const goNext = () => {
    if (!canProceed) return;
    setStep((prev) => Math.min(prev + 1, TOTAL_STEPS));
  };

  const goBack = () => setStep((prev) => Math.max(prev - 1, 1));

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="mx-auto w-full max-w-3xl px-4 pt-4">
        <Card className="border-1 shadow-sm bg-card/95">
          <CardContent className="py-5">
            <div className="text-center space-y-2">
              <h2 className="text-xl font-semibold tracking-tight">
                Preference Survey
              </h2>
              <p className="text-sm text-muted-foreground">
                Please answer the following questions to help us personalize your experience
              </p>
              <Badge variant="secondary">
                Step {step} of {TOTAL_STEPS}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-4">
          <div className="space-y-3">
            {step === 1 && (
              <DegreeAndGraduation
                value={survey.degreeAndGraduation}
                onChange={(next) =>
                  setSurvey((prev) => ({
                    ...prev,
                    degreeAndGraduation: next,
                  }))
                }
              />
            )}

            {step === 2 && (
              <CareerGoal
                selectedGoals={survey.careerGoal.selected}
                customGoal={survey.careerGoal.custom}
                stillExploring={survey.careerGoal.stillExploring}
                onToggleGoal={(next) =>
                  setSurvey((prev) => ({
                    ...prev,
                    careerGoal: {
                      ...prev.careerGoal,
                      selected: prev.careerGoal.selected.includes(next)
                        ? prev.careerGoal.selected.filter((goal) => goal !== next)
                        : [...prev.careerGoal.selected, next],
                      stillExploring: false,
                    },
                  }))
                }
                onCustomGoalChange={(next) =>
                  setSurvey((prev) => ({
                    ...prev,
                    careerGoal: {
                      ...prev.careerGoal,
                      custom: next,
                    },
                  }))
                }
                onToggleStillExploring={() =>
                  setSurvey((prev) => ({
                    ...prev,
                    careerGoal: {
                      ...prev.careerGoal,
                      stillExploring: !prev.careerGoal.stillExploring,
                      selected: prev.careerGoal.stillExploring ? prev.careerGoal.selected : [],
                    },
                  }))
                }
              />
            )}

            {step === 3 && (
              <WorkloadTolerance
                value={survey.workloadTolerance}
                onChange={(next) =>
                  setSurvey((prev) => ({
                    ...prev,
                    workloadTolerance: next,
                  }))
                }
              />
            )}

            {step === 4 && (
              <ClassTimePreference
                value={survey.classTimePreference}
                onChange={(next) =>
                  setSurvey((prev) => ({
                    ...prev,
                    classTimePreference: next,
                  }))
                }
              />
            )}
          </div>
        </div>
      </div>

      <div className="bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto w-full max-w-3xl px-4 py-4">
          <div className="flex items-center justify-between">
            <Button type="button" variant="outline" onClick={goBack} disabled={step === 1}>
              Back
            </Button>
            {step < TOTAL_STEPS ? (
              <Button type="button" onClick={goNext} disabled={!canProceed}>
                Next
              </Button>
            ) : (
              <Button type="button" disabled={!allDone}>
                Finish
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
