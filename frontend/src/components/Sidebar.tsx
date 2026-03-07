import { useAtomValue, useSetAtom } from "jotai";
import { Bookmark, Gauge, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { shortlistAtom, removeFromShortlistAtom } from "@/store/atoms";

export default function Sidebar() {
  const shortlist = useAtomValue(shortlistAtom);
  const removeFromShortlist = useSetAtom(removeFromShortlistAtom);

  return (
    <aside className="sidebar-root">
      <div className="space-y-4">
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
            <ScrollArea className="h-[280px]">
              <div className="p-6 pt-0">
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
                          <div className="text-muted-foreground line-clamp-2">
                            {item.courseTitle}
                          </div>
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
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-muted-foreground" />
              Current stats
            </CardTitle>
            <CardDescription>Quick summary of the selected course.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Credits</span>
              <span className="font-medium">—</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Workload</span>
              <span className="font-medium">—</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Difficulty</span>
              <span className="font-medium">—</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </aside>
  );
}