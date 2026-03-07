import { useEffect, useRef, useState } from "react";
import { ArrowRight, HelpCircle, X } from "lucide-react";

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

export default function TextArea({ onSearch, loading = false }: TextAreaProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const quotedCourse = useAtomValue(quotedCourseAtom);
  const setQuotedCourse = useSetAtom(quotedCourseAtom);

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

  return (
    <div className="dual-textarea-shell">
      <Card className="dual-textarea-card">
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-3">
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
                  <HelpCircle className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-[260px]">
                {HELP_TEXT}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          {quotedCourse && (
            <div className="flex items-center justify-between gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                Quoting: <span className="text-foreground">{quotedCourse.courseCode}</span> — {quotedCourse.courseTitle}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                aria-label="Remove quote"
                onClick={() => setQuotedCourse(null)}
              >
                <X className="h-3 w-3" />
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
              placeholder="Type to search or chat..."
              className="min-h-[52px] max-h-[200px] resize-none text-base leading-relaxed"
              rows={1}
            />
            <Button
              onClick={submit}
              disabled={loading}
              className="h-[52px] px-5"
            >
              {loading ? (
                <>
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
                  <span className="ml-2">Searching...</span>
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