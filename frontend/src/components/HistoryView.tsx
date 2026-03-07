import { useAtomValue, useSetAtom } from "jotai";
import { Trash2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { historyAtom, removeMessageAtom, clearHistoryAtom, type HistoryMessage } from "@/store/atoms";
import CourseCard from "@/components/CourseCard";

export default function HistoryView() {
  const history = useAtomValue(historyAtom);
  const removeMessage = useSetAtom(removeMessageAtom);
  const clearHistory = useSetAtom(clearHistoryAtom);

  const formatTimestamp = (date: Date): string => {
    return new Date(date).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (history.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <p>No history yet. Start searching or chatting!</p>
      </div>
    );
  }

  const filterHistory = (mode: "all" | "search" | "conversation") => {
    if (mode === "all") return history;
    return history.filter((m) => m.type === mode);
  };

  const renderItems = (items: HistoryMessage[]) => (
    <div className="space-y-4 p-6">
      {items.map((message) => (
        <Card key={message.id} className="shadow-sm">
          <CardHeader className="space-y-2 pb-3">
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
                <X />
              </Button>
            </div>
          </CardHeader>

          <CardContent className="space-y-3 pt-0">
            {message.response.length > 0 ? (
              <div className="space-y-3">
                {message.response.map((course) => (
                  <CourseCard key={course.id} course={course} />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
                No results found.
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-3 px-6 pt-6">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Recent</CardTitle>
          <Badge variant="outline">{history.length}</Badge>
        </div>
        <Button variant="outline" size="sm" onClick={() => clearHistory()}>
          <Trash2 className="mr-2 h-4 w-4" />
          Clear
        </Button>
      </div>

      <Tabs defaultValue="all" className="px-6 pt-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="search">Search</TabsTrigger>
          <TabsTrigger value="conversation">Chat</TabsTrigger>
        </TabsList>

        <div className="mt-4 rounded-lg border bg-background">
          <ScrollArea className="h-[460px]">
            <TabsContent value="all" className="m-0">
              {renderItems(filterHistory("all"))}
            </TabsContent>
            <TabsContent value="search" className="m-0">
              {renderItems(filterHistory("search"))}
            </TabsContent>
            <TabsContent value="conversation" className="m-0">
              {renderItems(filterHistory("conversation"))}
            </TabsContent>
          </ScrollArea>
        </div>
      </Tabs>
    </div>
  );
}