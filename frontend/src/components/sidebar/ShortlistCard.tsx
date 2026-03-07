import { useAtomValue, useSetAtom } from "jotai";
import { Bookmark, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { shortlistAtom, removeFromShortlistAtom } from "@/store/atoms";

interface ShortlistCardProps {
  /** Wrap list in a fixed-height ScrollArea (desktop). Disable for mobile panels that scroll themselves. */
  scrollable?: boolean;
}

export function ShortlistCard({ scrollable = true }: ShortlistCardProps) {
  const shortlist = useAtomValue(shortlistAtom);
  const removeFromShortlist = useSetAtom(removeFromShortlistAtom);

  const items = (
    <div className={scrollable ? "p-6 pt-0" : ""}>
      {shortlist.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
          No courses shortlisted yet.
        </div>
      ) : (
        <div className="space-y-2">
          {shortlist.map((item) => (
            <div
              key={item.id}
              className="flex items-start justify-between gap-2 rounded-lg border bg-card p-3 text-sm"
            >
              <div className="min-w-0">
                <div className="font-medium">{item.courseCode}</div>
                <div className="text-muted-foreground line-clamp-2">{item.courseTitle}</div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                aria-label="Remove from shortlist"
                onClick={() => removeFromShortlist(item.id)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Card>
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Bookmark className="h-4 w-4 text-muted-foreground" />
            Shortlist
          </CardTitle>
          <Badge variant="secondary">{shortlist.length}</Badge>
        </div>
        <CardDescription>Pin courses you want to compare later.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {scrollable ? (
          <ScrollArea className="h-[280px]">{items}</ScrollArea>
        ) : (
          <div className="px-6 pb-4">{items}</div>
        )}
      </CardContent>
    </Card>
  );
}
