"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PromptInputBox } from "@/components/ui/ai-prompt-box";
import { api } from "@/lib/api";

/**
 * "Ask" is the AI-query verb, distinct from ⌘K's "search" verb.
 * On send, the message is run through the existing semantic search endpoint.
 * A "real" ask endpoint (LLM-mediated recall + synthesis) is a v2.6+ effort —
 * for Phase 1 this surfaces the top-3 semantic matches as a stub.
 */
export default function AskDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSend = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!trimmed) return;
      setLoading(true);
      try {
        await api.semanticSearch(trimmed, 3, 0.4);
        setOpen(false);
        router.push(`/graph?q=${encodeURIComponent(trimmed)}`);
      } catch {
        setOpen(false);
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[22.5px] text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border)]/60 transition-colors"
        title="Ask your memories (Ask)"
        aria-label="Open Ask dialog"
      >
        <Sparkles className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Ask</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl p-0 gap-0 bg-[var(--bg-primary)] border border-[var(--border)]">
          <DialogTitle className="sr-only">Ask your memories</DialogTitle>
          <div className="relative">
            {loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--bg-primary)]/60 backdrop-blur-sm">
                <Loader2 className="h-5 w-5 animate-spin text-[var(--accent)]" />
              </div>
            )}
            <PromptInputBox
              onSend={handleSend}
              isLoading={loading}
              placeholder="Ask your memories…"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
