import { useEffect, useRef, useState } from "react";
import { ArrowRight, HelpCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface TextAreaProps {
  onSearch?: (query: string) => void;
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

export default function TextArea({ onSearch }: TextAreaProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    autosize(textareaRef.current);
  }, [text]);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSearch?.(trimmed);
  };

  const onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
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
            <CardDescription>
              AI-enabled search across courses and evaluations. Press{" "}
              <span className="font-mono text-foreground">⌘/Ctrl</span>+
              <span className="font-mono text-foreground">Enter</span> to send.
            </CardDescription>
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
          <div className="flex items-end gap-3">
            <Textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                autosize(textareaRef.current);
              }}
              onKeyDown={onKeyDown}
              placeholder="Type an exact course name or ask what you should take next..."
              className="min-h-[52px] max-h-[200px] resize-none text-base leading-relaxed"
              rows={1}
            />
            <Button onClick={submit} className="h-[52px] px-5">
              Send <ArrowRight className="ml-1" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}