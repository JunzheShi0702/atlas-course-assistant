import { useEffect, useRef, useState } from "react";
import { ArrowRight, HelpCircle, StopCircle, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAtomValue, useSetAtom } from "jotai";
import { quotedCourseAtom } from "@/store/atoms";

interface TextAreaProps {
  onSearch?: (query: string) => void;
  loading?: boolean;
}

const MAX_TEXTAREA_HEIGHT = 200;

function autosize(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = "0px";
  const next = Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT);
  textarea.style.height = `${next}px`;
}

const HELP_TEXT =
  "This is an AI-enabled search. Enter an exact course name or code for a direct lookup, or ask in natural language and Atlas will interpret it and return suggested courses and context.";

function useResponsivePlaceholder() {
  const [placeholder, setPlaceholder] = useState("");

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      if (w < 380) setPlaceholder("");
      else if (w < 640) setPlaceholder("Ask Atlas");
      else setPlaceholder("Ask Atlas — search or chat...");
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return placeholder;
}

export default function TextArea({ onSearch, loading = false }: TextAreaProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const quotedCourse = useAtomValue(quotedCourseAtom);
  const setQuotedCourse = useSetAtom(quotedCourseAtom);
  const placeholder = useResponsivePlaceholder();

  useEffect(() => {
    autosize(textareaRef.current);
  }, [text]);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed && !quotedCourse) return;
    const reference = quotedCourse
      ? `[${quotedCourse.courseCode} - ${quotedCourse.courseTitle}]\n\n${trimmed || ""}`
      : trimmed;
    if (reference.trim()) onSearch?.(reference.trim());
    setText("");
    setQuotedCourse(null);
  };

  const onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !loading) {
      e.preventDefault();
      submit();
    }
  };

  const canSubmit = Boolean(text.trim() || quotedCourse);

  return (
    <div className="dual-textarea-shell">
      <Card className="dual-textarea-card">
        {/* Hidden on mobile — "Ask Atlas" surfaces as placeholder text instead */}
        <CardHeader className="flex-row items-start justify-between hidden gap-4 pb-3 space-y-0 sm:flex">
          <div className="space-y-1">
            <CardTitle className="text-base">Ask Atlas</CardTitle>
          </div>
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="How this search works"
                  className="h-9 w-9 shrink-0"
                >
                  <HelpCircle className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-[260px]">
                {HELP_TEXT}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardHeader>
        <CardContent className="pt-3 space-y-3 sm:pt-0">
          {quotedCourse && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-md bg-muted/60">
              <span className="text-muted-foreground">
                Quoting: <span className="text-foreground">{quotedCourse.courseCode}</span> — {quotedCourse.courseTitle}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="w-6 h-6"
                aria-label="Remove quote"
                onClick={() => setQuotedCourse(null)}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          )}
          <div className="flex items-end gap-3">
            <Textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                autosize(textareaRef.current);
              }}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              className="min-h-13 max-h-50 resize-none text-base leading-relaxed py-3.25"
              rows={1}
            />
            {/* Mobile: round icon-only button */}
            <Button
              onClick={submit}
              disabled={loading || !canSubmit}
              className="p-0 rounded-md sm:hidden h-13 w-13 shrink-0"
              aria-label={loading ? "Stop" : "Send"}
            >
              {loading ? (
                <StopCircle className="w-5 h-5" />
              ) : (
                <ArrowRight className="w-5 h-5" />
              )}
            </Button>

            {/* Desktop: text + icon button */}
            <Button
              onClick={submit}
              disabled={loading || !canSubmit}
              className="hidden px-5 sm:flex h-13"
            >
              {loading ? (
                <>
                  <span className="ml-2">Stop</span>
                  <StopCircle className="w-4 h-4" />
                </>
              ) : (
                <>
                  Send <ArrowRight className="ml-1" />
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}