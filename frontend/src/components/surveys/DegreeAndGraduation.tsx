import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { PROGRAM_LIST } from "@/components/surveys/program_list";

type ProgramKind = "major" | "minor";

interface SelectedProgram {
  name: string;
  kind: ProgramKind;
}

export interface DegreeAndGraduationValue {
  graduationMonth: string;
  graduationYear: string;
  programs: SelectedProgram[];
}

interface DegreeAndGraduationProps {
  value: DegreeAndGraduationValue;
  onChange: (value: DegreeAndGraduationValue) => void;
}

const MONTH_OPTIONS = ["May", "August", "December"];
const YEAR_OPTIONS = ["2026", "2027", "2028", "2029", "2030"];
const INITIALS_STOP_WORDS = new Set(["and", "of", "the", "for", "in", "to", "a", "an"]);

export default function DegreeAndGraduation({ value, onChange }: DegreeAndGraduationProps) {
  const [query, setQuery] = useState("");
  const [pickedOption, setPickedOption] = useState<{ name: string; kind: ProgramKind } | null>(null);

  const selectablePrograms = useMemo(() => {
    const existing = new Set(value.programs.map((p) => `${p.name}:${p.kind}`));
    return PROGRAM_LIST.flatMap((program) => {
      const options: Array<{ name: string; kind: ProgramKind; label: string }> = [];
      if (program.hasMajor && !existing.has(`${program.name}:major`)) {
        options.push({
          name: program.name,
          kind: "major",
          label: `${program.name} (Major)`,
        });
      }
      if (program.hasMinor && !existing.has(`${program.name}:minor`)) {
        options.push({
          name: program.name,
          kind: "minor",
          label: `${program.name} (Minor)`,
        });
      }
      return options;
    });
  }, [value.programs]);

  const filteredPrograms = useMemo(() => {
    const cleaned = query.trim().toLowerCase();
    if (cleaned.length < 2) return [];
    const queryTokens = cleaned.split(/\s+/).filter(Boolean);

    return selectablePrograms
      .map((program) => {
        const name = program.name.toLowerCase();
        const words = program.name
          .toLowerCase()
          .split(/[\s,&-]+/)
          .filter(Boolean);
        const initials = words
          .filter((part) => !INITIALS_STOP_WORDS.has(part))
          .map((part) => part[0] ?? "")
          .join("");
        const allTokensMatchWordPrefix =
          queryTokens.length > 1 &&
          queryTokens.every((token) => words.some((word) => word.startsWith(token)));

        // Priority ranking:
        // 1) Exact letters at start of first word
        // 2) Exact letters at start of any word
        // 3) Exact initials
        // 4) Part of initials
        // 5) General appearance anywhere
        let rank = Number.POSITIVE_INFINITY;

        if (words[0]?.startsWith(cleaned)) {
          rank = 1;
        } else if (words.some((word) => word.startsWith(cleaned))) {
          rank = 2;
        } else if (allTokensMatchWordPrefix) {
          rank = 2.5;
        } else if (initials === cleaned) {
          rank = 3;
        } else if (initials.includes(cleaned)) {
          rank = 4;
        } else if (name.includes(cleaned) || program.label.toLowerCase().includes(cleaned)) {
          rank = 5;
        }

        return { program, rank };
      })
      .filter((item) => Number.isFinite(item.rank))
      .sort((a, b) => a.rank - b.rank || a.program.label.localeCompare(b.program.label))
      .map((item) => item.program)
      .slice(0, 12);
  }, [query, selectablePrograms]);

  const showDropdown = query.trim().length >= 2;

  const majors = value.programs.filter((program) => program.kind === "major");
  const minors = value.programs.filter((program) => program.kind === "minor");
  const orderedPrograms = [...majors, ...minors];

  const moveMajor = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= majors.length) return;
    const nextMajors = [...majors];
    [nextMajors[index], nextMajors[nextIndex]] = [nextMajors[nextIndex], nextMajors[index]];
    onChange({ ...value, programs: [...nextMajors, ...minors] });
  };

  const removeProgram = (target: SelectedProgram) => {
    onChange({
      ...value,
      programs: value.programs.filter(
        (program) => !(program.name === target.name && program.kind === target.kind),
      ),
    });
  };

  const addSelectedProgram = () => {
    if (!pickedOption) return;
    onChange({
      ...value,
      programs: [...majors, ...(pickedOption.kind === "major" ? [pickedOption] : []), ...minors, ...(pickedOption.kind === "minor" ? [pickedOption] : [])],
    });
    setQuery("");
    setPickedOption(null);
  };

  return (
    <Card className="border-0 shadow-none">
      <CardHeader className="space-y-2">
        <Badge className="w-fit">Section 1</Badge>
        <CardTitle>Degree & Graduation</CardTitle>
        <CardDescription>Select your programs and expected graduation month/year.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-medium">Programs (Majors/Minors)</p>
          <p className="text-xs text-muted-foreground">
            Add at least one major to continue. Majors stay before minors; reorder majors to indicate primary/secondary.
          </p>

          <div className="flex items-start gap-2">
            <div className="relative flex-1">
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPickedOption(null);
                }}
                placeholder="Type program initials or first letters (e.g., CS, comp)"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {showDropdown && (
                <div className="absolute left-0 top-full z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
                  {filteredPrograms.length > 0 ? (
                    filteredPrograms.map((program) => {
                      const selected =
                        pickedOption?.name === program.name && pickedOption?.kind === program.kind;
                      return (
                        <button
                          key={`${program.name}:${program.kind}`}
                          type="button"
                          className={`w-full rounded-sm px-2 py-1.5 text-left text-sm ${
                            selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/70"
                          }`}
                          onClick={() => setPickedOption({ name: program.name, kind: program.kind })}
                        >
                          {program.label}
                        </button>
                      );
                    })
                  ) : (
                    <p className="px-2 py-1.5 text-sm text-muted-foreground">No matching programs</p>
                  )}
                </div>
              )}
            </div>
            <Button type="button" onClick={addSelectedProgram} disabled={!pickedOption}>
              <Plus className="w-4 h-4 mr-1" /> Add
            </Button>
          </div>

          {orderedPrograms.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {orderedPrograms.map((program) => {
                const majorIndex = majors.findIndex((m) => m.name === program.name && m.kind === "major");
                const canMoveMajorUp = program.kind === "major" && majorIndex > 0;
                const canMoveMajorDown = program.kind === "major" && majorIndex < majors.length - 1;
                return (
                  <Badge key={`${program.name}:${program.kind}`} variant="secondary" className="gap-1 pl-2 pr-1 py-1">
                    <span>{program.name}</span>
                    <span className="text-xs opacity-80">({program.kind})</span>
                    {program.kind === "major" && (
                      <>
                        <button
                          type="button"
                          className="rounded p-0.5 hover:bg-accent disabled:opacity-40"
                          onClick={() => moveMajor(majorIndex, -1)}
                          disabled={!canMoveMajorUp}
                          aria-label="Move major up"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          className="rounded p-0.5 hover:bg-accent disabled:opacity-40"
                          onClick={() => moveMajor(majorIndex, 1)}
                          disabled={!canMoveMajorDown}
                          aria-label="Move major down"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="rounded p-0.5 hover:bg-accent"
                      onClick={() => removeProgram(program)}
                      aria-label={`Remove ${program.name} ${program.kind}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </Badge>
                );
              })}
            </div>
          )}
        </div>

        <Separator />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between"
                >
                  <span>{value.graduationYear || "Select year"}</span>
                  <ArrowDown className="w-4 h-4 ml-2 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
                {YEAR_OPTIONS.map((option) => (
                  <DropdownMenuItem
                    key={option}
                    onClick={() => onChange({ ...value, graduationYear: option })}
                  >
                    {option}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
