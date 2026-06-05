"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { AnimatedStatusBadge } from "@/components/ui/animated-status-badge";
import ExplainBlock from "@/components/ExplainBlock";
import { nodeColor } from "@/lib/nodeColors";
import { cn } from "@/lib/utils";
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
    const prev = signals[id] ?? null;
    const next = prev === signal ? null : signal;
    setSignals((s) => ({ ...s, [id]: next }));
    try {
      await api.setRelevance(id, next);
      setSaved(true);
    } catch {
      setSignals((s) => ({ ...s, [id]: prev }));
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
        <ul className="space-y-1 mt-4 overflow-y-auto custom-scrollbar flex-1 pr-2">
          {detail.memories.map((m) => {
            const sig = signals[m.id] ?? null;
            const accent = nodeColor(m.category);
            return (
              <li
                key={m.id}
                className="flex items-center gap-2 p-2 rounded-md hover:bg-white/5 transition-colors"
              >
                <span
                  className="flex-1 min-w-0 truncate text-sm text-muted-foreground"
                  title={m.label || m.content}
                >
                  {m.label || m.content}
                </span>
                <button
                  type="button"
                  onClick={() => rate(m.id, "works")}
                  aria-label="Works for me"
                  aria-pressed={sig === "works"}
                  className={cn(
                    "h-8 w-8 grid place-items-center rounded transition-colors shrink-0",
                    sig === "works"
                      ? "text-white"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  )}
                  style={{
                    backgroundColor: sig === "works" ? accent : "transparent",
                    border: `1px solid ${sig === "works" ? accent : "var(--border)"}`,
                  }}
                  title="Works for me"
                >
                  <ThumbsUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => rate(m.id, "doesnt")}
                  aria-label="Doesn't work for me"
                  aria-pressed={sig === "doesnt"}
                  className={cn(
                    "h-8 w-8 grid place-items-center rounded transition-colors shrink-0",
                    sig === "doesnt"
                      ? "text-white bg-rose-500 border border-rose-500"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  )}
                  style={{
                    borderColor: sig === "doesnt" ? "#f43f5e" : "var(--border)",
                  }}
                  title="Doesn't work for me"
                >
                  <ThumbsDown className="w-3.5 h-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
