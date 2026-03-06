import { Bookmark, Gauge } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

export default function Sidebar() {
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
              <Badge variant="secondary">0</Badge>
            </div>
            <CardDescription>Pin courses you want to compare later.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[280px]">
              <div className="p-6 pt-0">
                <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
                  No courses shortlisted yet.
                </div>
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