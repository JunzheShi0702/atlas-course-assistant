import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { historyAtom, removeMessageAtom, type HistoryMessage } from "@/store/atoms";
import CourseCard from "@/components/CourseCard";

interface HistoryViewProps {
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export default function HistoryView({ loading = false, error, onRetry }: HistoryViewProps) {
  const history = useAtomValue(historyAtom);
  const removeMessage = useSetAtom(removeMessageAtom);
  const lastCardRef = useRef<HTMLDivElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (history.length > 0) {
      lastCardRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [history.length]);

  useEffect(() => {
    if (loading || error) {
      feedbackRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [loading, error]);

  const formatTimestamp = (date: Date): string => {
    return new Date(date).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (history.length === 0 && !loading && !error) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <p>No history yet. Start searching or chatting!</p>
      </div>
    );
  }

  const renderItems = (items: HistoryMessage[]) => (
    <div className="space-y-4">
      {items.map((message, index) => (
        <div
          key={message.id}
          ref={index === items.length - 1 ? lastCardRef : undefined}
        >
        <Card className="border-0 shadow-none">
          <CardHeader className="pb-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={message.type === "search" ? "secondary" : "default"}>
                    {message.type === "search" ? "Search" : "Chat"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatTimestamp(message.timestamp)}
                  </span>
                </div>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {message.prompt}
                </div>
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeMessage(message.id)}
                aria-label="Remove message"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>

          <CardContent className="pt-0 space-y-3">
            {message.response.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {message.response.map((course) => (
                  <CourseCard key={course.id} course={course} />
                ))}
              </div>
            ) : (
              <div className="p-3 text-sm border border-dashed rounded-lg bg-muted/30 text-muted-foreground">
                No results found.
              </div>
            )}
          </CardContent>
        </Card>
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col items-stretch min-h-0 space-y-2">
      {renderItems(history)}
      {(loading || error) && (
        <div ref={feedbackRef} className="py-8 px-6">
          {loading ? (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="p-4 text-red-800 bg-red-100 border border-dashed rounded-sm text-md">
              <p>{error}</p>
              {onRetry && (
                <div className="flex justify-end mt-3">
                  <Button variant="outline" onClick={onRetry} className="px-5 h-13">
                    <RotateCcw className="w-4 h-4 mr-2" /> Retry
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
