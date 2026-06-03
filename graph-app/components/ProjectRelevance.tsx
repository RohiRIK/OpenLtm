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
    <section className="relative">
      <h3 className="text-sm font-semibold mb-2">Works for me / doesn&apos;t</h3>
      <AnimatedStatusBadge trigger={saved} onAnimationComplete={() => setSaved(false)} />
      <ExplainBlock title="Why mark relevance?">
        Not every remembered thing is useful to you. Mark what actually helped with a thumbs up,
        and what got in the way with a thumbs down — the assistant uses this to favor what works
        for you and quietly downweight what doesn&apos;t.
      </ExplainBlock>

      {detail.memories.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">No memories to rate yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {detail.memories.map((m) => {
            const sig = signals[m.id] ?? null;
            return (
              <li key={m.id} className="flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate text-[var(--text-muted)]">
                  {m.label || m.content}
                </span>
                <Button
                  variant={sig === "works" ? "default" : "ghost"}
                  size="icon"
                  aria-label="Works for me"
                  onClick={() => rate(m.id, "works")}
                >
                  <ThumbsUp className="w-4 h-4" />
                </Button>
                <Button
                  variant={sig === "doesnt" ? "destructive" : "ghost"}
                  size="icon"
                  aria-label="Doesn't work for me"
                  onClick={() => rate(m.id, "doesnt")}
                >
                  <ThumbsDown className="w-4 h-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
