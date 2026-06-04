"use client";

import { useMemo } from "react";
import { nodeColor } from "@/lib/nodeColors";
import type { MemoryNode } from "@/lib/types";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function actionDescription(m: MemoryNode): string {
  if (m.confidence < 0.3) {
    return `Confidence decayed to ${Math.round(m.confidence * 100)}%`;
  }
  if (m.confidence < 0.5) {
    return `Confidence low at ${Math.round(m.confidence * 100)}%`;
  }
  // Derive action from category
  const categoryActions: Record<string, string> = {
    gotcha: "New gotcha added",
    architecture: "Architecture decision recorded",
    pattern: "Pattern captured",
    preference: "Preference noted",
    workflow: "Workflow documented",
    constraint: "Constraint identified",
    goal: "Goal set",
    decision: "Decision made",
    progress: "Progress logged",
  };
  return categoryActions[m.category] ?? `New ${m.category} memory added`;
}

export default function ProjectActivityLog({ memories }: { memories: MemoryNode[] }) {
  const events = useMemo(() => {
    return [...memories]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 20);
  }, [memories]);

  if (events.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">No recent activity.</p>
    );
  }

  return (
    <div className="relative pl-6">
      {/* Vertical dashed connector line */}
      <div
        className="absolute left-[7px] top-1 bottom-1 w-px border-l border-dashed border-[var(--border)]"
      />

      <div className="space-y-4">
        {events.map((m, i) => (
          <div key={m.id} className="relative flex items-start gap-3">
            {/* Dot */}
            <div
              className="absolute -left-6 top-1 w-[14px] h-[14px] rounded-full border-2 border-[var(--bg-primary)] shrink-0"
              style={{ backgroundColor: nodeColor(m.category) }}
            />

            {/* Content */}
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--text-primary)] font-medium">
                  {actionDescription(m)}
                </span>
                <span className="text-[10px] text-[var(--text-muted)] font-mono shrink-0">
                  {relativeTime(m.created_at)}
                </span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)] leading-relaxed truncate">
                {m.content.length > 100 ? m.content.slice(0, 100) + "…" : m.content}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
