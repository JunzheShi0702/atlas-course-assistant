/**
 * ScheduleChat — schedule-aware chat panel (#121)
 *
 * Adapts the existing Atlas chat flow for a specific schedule page.
 * Sends { message, scheduleId } to POST /api/agent and renders responses
 * as user/assistant message bubbles. Supports AbortController so the
 * Stop button (#124) can cancel in-flight requests.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, Loader2, Square, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
}

interface AgentResponse {
  type: "text" | "search" | "summary" | "details" | "error";
  message?: string;
  error?: string;
  summaryText?: string;
  results?: Array<{ code?: string; title?: string; shortDescription?: string }>;
  course?: { title?: string; offeringName?: string; instructors?: string[] };
}

function agentResponseToText(data: AgentResponse): string {
  switch (data.type) {
    case "text":
      return data.message ?? "";
    case "error":
      return data.error ?? "Something went wrong.";
    case "summary":
      return data.summaryText ?? data.message ?? "No summary available.";
    case "details":
      if (data.course) {
        const { title, offeringName, instructors } = data.course;
        const parts = [title ?? offeringName];
        if (instructors?.length) parts.push(`Instructor: ${instructors.join(", ")}`);
        return parts.filter(Boolean).join("\n");
      }
      return "No details found.";
    case "search":
      if (!data.results?.length) return "No courses found for that query.";
      const list = data.results
        .slice(0, 5)
        .map((r, i) => `${i + 1}. **${r.code}** — ${r.title}`)
        .join("\n");
      return `Here are some courses I found:\n\n${list}`;
    default:
      return data.message ?? "";
  }
}

const API_BASE = (
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_API_URL ?? ""
).replace(/\/$/, "");

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";

  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {/* Avatar */}
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium
          ${isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground"
          }`}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>

      {/* Bubble */}
      <div
        className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap
          ${isUser
            ? "rounded-tr-sm bg-primary text-primary-foreground"
            : msg.isError
              ? "rounded-tl-sm bg-destructive/10 text-destructive border border-destructive/20"
              : "rounded-tl-sm bg-muted text-foreground"
          }`}
        data-testid={isUser ? "user-message" : "assistant-message"}
      >
        {msg.content}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ScheduleChatProps {
  scheduleId: string;
  scheduleName?: string;
}

export default function ScheduleChat({ scheduleId, scheduleName }: ScheduleChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const appendMessage = (msg: Omit<ChatMessage, "id">) => {
    setMessages((prev) => [
      ...prev,
      { ...msg, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
    ]);
  };

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setError(null);
    appendMessage({ role: "user", content: text });
    setLoading(true);

    abortRef.current = new AbortController();

    try {
      const url = API_BASE ? `${API_BASE}/api/agent` : "/api/agent";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, scheduleId }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) errMsg = body.error;
        } catch {
          /* ignore */
        }
        throw new Error(errMsg);
      }

      const data: AgentResponse = await res.json();
      appendMessage({ role: "assistant", content: agentResponseToText(data) });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        appendMessage({
          role: "assistant",
          content: "Response stopped.",
          isError: false,
        });
      } else {
        const msg = err instanceof Error ? err.message : "Request failed";
        setError(msg);
        appendMessage({ role: "assistant", content: msg, isError: true });
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [input, loading, scheduleId]);

  const stopResponse = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex h-full flex-col" data-testid="schedule-chat">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-4 py-3">
        <p className="text-sm font-medium">Chat</p>
        <p className="text-xs text-muted-foreground">
          Ask about {scheduleName ? `your ${scheduleName} schedule` : "this schedule"} — workload, alternatives, planning
        </p>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
        data-testid="chat-message-list"
      >
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center py-12"
            data-testid="chat-empty-state"
          >
            <Bot className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium text-muted-foreground">
              Ask about this schedule
            </p>
            <p className="text-xs text-muted-foreground/70 max-w-48">
              Try: "Is this workload manageable?" or "Suggest lighter alternatives"
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        {loading && (
          <div className="flex gap-2.5" data-testid="chat-loading">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
              <Bot className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Thinking…</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Error banner */}
      {error && !loading && (
        <div className="shrink-0 mx-4 mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive border border-destructive/20">
          {error}
        </div>
      )}

      {/* Input area */}
      <div className="shrink-0 border-t border-border p-3">
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about workload, alternatives, planning…"
            rows={1}
            disabled={loading}
            className="min-h-10 max-h-32 resize-none text-sm leading-relaxed py-2.5"
            data-testid="chat-input"
          />

          {loading ? (
            <Button
              size="icon"
              variant="outline"
              onClick={stopResponse}
              className="h-10 w-10 shrink-0"
              aria-label="Stop response"
              data-testid="stop-button"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={sendMessage}
              disabled={!input.trim()}
              className="h-10 w-10 shrink-0"
              aria-label="Send message"
              data-testid="send-button"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
