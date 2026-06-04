"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatedStatusBadge } from "@/components/ui/animated-status-badge";
import ExplainBlock from "@/components/ExplainBlock";
import { api } from "@/lib/api";
import type { ProjectDetail, RelevanceSignal } from "@/lib/types";

interface ProjectRelevanceProps {
  detail: ProjectDetail;
}

export default function ProjectRelevance({ detail }: ProjectRelevanceProps) {
  const [signals, setSignals] = useState<Record<number, RelevanceSignal | null>>(() =>
    Object.fromEntries(detail.memories.map((m) => [m.id, m.relevance_signal ?? null])),
  );
  const [saved, setSaved] = useState(false);

  async function rate(id: number, signal: RelevanceSignal) {
    const next = signals[id] === signal ? null : signal;
    setSignals((prev) => ({ ...prev, [id]: next }));
    try {
      await api.setRelevance(id, next);
      setSaved(true);
    } catch {
      // revert on failure
      setSignals((prev) => ({ ...prev, [id]: signals[id] ?? null }));
    }
  }

  return (
    <section className="relative flex flex-col h-full max-h-[400px]">
      <h3 className="text-lg font-semibold tracking-tight mb-2 text-foreground">Works for me / doesn&apos;t</h3>
      <AnimatedStatusBadge trigger={saved} onAnimationComplete={() => setSaved(false)} />
      <ExplainBlock title="Why mark relevance?">
        Not every remembered thing is useful to you. Mark what actually helped with a thumbs up,
        and what got in the way with a thumbs down — the assistant uses this to favor what works
        for you and quietly downweight what doesn&apos;t.
      </ExplainBlock>

      {detail.memories.length === 0 ? (
        <p className="text-sm text-muted-foreground mt-4">No memories to rate yet.</p>
      ) : (
        <ul className="space-y-2 mt-4 overflow-y-auto custom-scrollbar flex-1 pr-2">
          {detail.memories.map((m) => {
            const sig = signals[m.id] ?? null;
            return (
              <li key={m.id} className="flex items-center gap-2 p-2 rounded-md hover:bg-white/5 transition-colors">
                <span className="flex-1 min-w-0 truncate text-sm text-muted-foreground" title={m.label || m.content}>
                  {m.label || m.content}
                </span>
                <Button
                  variant={sig === "works" ? "default" : "ghost"}
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label="Works for me"
                  onClick={() => rate(m.id, "works")}
                >
                  <ThumbsUp className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant={sig === "doesnt" ? "destructive" : "ghost"}
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label="Doesn't work for me"
                  onClick={() => rate(m.id, "doesnt")}
                >
                  <ThumbsDown className="w-3.5 h-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
