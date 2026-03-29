import { CircleHelp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useApi } from "@/hooks/useApi";
import { buildUserProfilePayloadFromSurvey } from "@/lib/buildUserProfilePayload";
import { hydrateSurveyFromUserProfile } from "@/lib/hydrateSurveyFromUserProfile";

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
  const navigate = useNavigate();
  const { state } = useLocation();
  const returnTo = (state as { returnTo?: string } | null)?.returnTo ?? "/";
  const {
    getUserProfile,
    submitUserProfile,
    profileLoading,
    profileError,
    profileSubmitLoading,
    profileSubmitError,
  } = useApi();
  const [step, setStep] = useState(1);
  const [initialHydrationDone, setInitialHydrationDone] = useState(false);
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const profile = await getUserProfile();
        if (!cancelled && profile) {
          setSurvey(hydrateSurveyFromUserProfile(profile));
        }
      } catch {
        /* defaults; profileError set in hook */
      } finally {
        if (!cancelled) setInitialHydrationDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getUserProfile]);

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
  const nextDisabled =
    !canProceed || profileSubmitLoading || !initialHydrationDone || profileLoading;
  const finishDisabled =
    !allDone || profileSubmitLoading || !initialHydrationDone || profileLoading;

  const nextDisabledReason = useMemo(() => {
    if (!initialHydrationDone || profileLoading) {
      return "Please wait for saved preferences to finish loading.";
    }
    if (profileSubmitLoading) {
      return "Please wait until the current save completes.";
    }
    if (canProceed) return "";

    if (step === 1) {
      const missing: string[] = [];
      const hasMajor = survey.degreeAndGraduation.programs.some(
        (program) => program.kind === "major"
      );
      if (!hasMajor) missing.push("at least one major");
      if (!survey.degreeAndGraduation.graduationMonth) {
        missing.push("graduation month");
      }
      if (!survey.degreeAndGraduation.graduationYear) {
        missing.push("graduation year");
      }
      return `Missing: ${missing.join(", ")}.`;
    }
    if (step === 2) {
      const hasPreset = survey.careerGoal.selected.length > 0;
      const hasCustom = Boolean(survey.careerGoal.custom.trim());
      const isExploring = survey.careerGoal.stillExploring;
      if (!hasPreset && !hasCustom && !isExploring) {
        return "Missing: career goal input (select a goal, write custom text, or choose 'Still Exploring').";
      }
      return "Please complete the career goal step.";
    }
    if (step === 3) {
      return "Select a point on the workload chart to continue.";
    }
    if (step === 4) {
      const ctp = survey.classTimePreference;
      if (ctp.noPreference) return "";
      if (ctp.customPreference.trim()) return "";

      const timeMissing = Math.max(0, 2 - ctp.selectedTimes.length);
      const dayMissing = Math.max(0, 2 - ctp.selectedDays.length);
      const parts: string[] = [];
      if (timeMissing > 0) {
        parts.push(`${timeMissing} more time range${timeMissing > 1 ? "s" : ""}`);
      }
      if (dayMissing > 0) {
        parts.push(`${dayMissing} more day${dayMissing > 1 ? "s" : ""}`);
      }
      if (parts.length > 0) {
        return `Missing: ${parts.join(" and ")}. Or enter a custom preference / choose 'No Preference'.`;
      }
      return "Please complete class time preference.";
    }
    return "Please complete this step to continue.";
  }, [canProceed, initialHydrationDone, profileLoading, profileSubmitLoading, step, survey]);

  const finishDisabledReason = useMemo(() => {
    if (!initialHydrationDone || profileLoading) {
      return "Please wait for saved preferences to finish loading.";
    }
    if (profileSubmitLoading) {
      return "Please wait until the current save completes.";
    }
    if (allDone) return "";

    const ctp = survey.classTimePreference;
    if (ctp.noPreference || ctp.customPreference.trim()) {
      return "Please complete any remaining required fields before finishing.";
    }

    const timeMissing = Math.max(0, 2 - ctp.selectedTimes.length);
    const dayMissing = Math.max(0, 2 - ctp.selectedDays.length);
    const parts: string[] = [];
    if (timeMissing > 0) {
      parts.push(`${timeMissing} more time range${timeMissing > 1 ? "s" : ""}`);
    }
    if (dayMissing > 0) {
      parts.push(`${dayMissing} more day${dayMissing > 1 ? "s" : ""}`);
    }
    if (parts.length > 0) {
      return `Missing: ${parts.join(" and ")}. Or enter a custom preference / choose 'No Preference'.`;
    }
    return "Please complete this step before finishing.";
  }, [allDone, initialHydrationDone, profileLoading, profileSubmitLoading, survey]);

  const goNext = () => {
    if (!canProceed) return;
    setStep((prev) => Math.min(prev + 1, TOTAL_STEPS));
  };

  const goBack = () => setStep((prev) => Math.max(prev - 1, 1));

  const handleFinish = async () => {
    if (!allDone || profileSubmitLoading) return;
    const payload = buildUserProfilePayloadFromSurvey(survey);
    try {
      await submitUserProfile(payload);
      navigate(returnTo);
    } catch {
      /* surfaced via profileSubmitError */
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="mx-auto w-full max-w-3xl px-4 pt-4">
        <Card className="border shadow-sm bg-card/95">
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
          {!initialHydrationDone || profileLoading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Loading saved preferences…</p>
          ) : null}
          {initialHydrationDone && profileError ? (
            <p className="text-sm text-destructive mb-3" role="alert">
              Couldn’t load saved profile: {profileError}
            </p>
          ) : null}
          <div className={`space-y-3 ${!initialHydrationDone || profileLoading ? "pointer-events-none opacity-50" : ""}`}>
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
                      stillExploring: false,
                      custom: "",
                      selected: prev.careerGoal.selected.includes(next)
                        ? prev.careerGoal.selected.filter((goal) => goal !== next)
                        : [...prev.careerGoal.selected, next],
                    },
                  }))
                }
                onCustomGoalChange={(next) =>
                  setSurvey((prev) => ({
                    ...prev,
                    careerGoal: {
                      ...prev.careerGoal,
                      stillExploring: false,
                      selected: next.trim() ? [] : prev.careerGoal.selected,
                      custom: next,
                    },
                  }))
                }
                onToggleStillExploring={() =>
                  setSurvey((prev) => {
                    const turningOn = !prev.careerGoal.stillExploring;
                    return {
                      ...prev,
                      careerGoal: {
                        ...prev.careerGoal,
                        stillExploring: turningOn,
                        selected: turningOn ? [] : prev.careerGoal.selected,
                        custom: turningOn ? "" : prev.careerGoal.custom,
                      },
                    };
                  })
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

      <div className="bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
        <div className="mx-auto w-full max-w-3xl px-4 py-4 space-y-2">
          {profileSubmitError ? (
            <p className="text-sm text-destructive" role="alert">
              {profileSubmitError}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={goBack}
              disabled={step === 1 || profileSubmitLoading || !initialHydrationDone || profileLoading}
            >
              Back
            </Button>
            {step < TOTAL_STEPS ? (
              <div className="flex items-center gap-2">
                {nextDisabled ? (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Why Next is disabled"
                        >
                          <CircleHelp className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        {nextDisabledReason}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : null}
                <Button
                  type="button"
                  data-testid="next-button"
                  onClick={goNext}
                  disabled={nextDisabled}
                >
                  Next
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {finishDisabled ? (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Why Finish is disabled"
                        >
                          <CircleHelp className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        {finishDisabledReason}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : null}
                <Button
                  type="button"
                  disabled={finishDisabled}
                  onClick={() => void handleFinish()}
                >
                  {profileSubmitLoading ? "Saving…" : "Finish"}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
