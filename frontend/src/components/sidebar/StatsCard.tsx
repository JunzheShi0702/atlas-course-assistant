import { Gauge } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export function StatsCard() {
  return (
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
  );
}
