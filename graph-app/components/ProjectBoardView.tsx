"use client";
import { useMemo } from "react";
import { LayoutDashboard } from "lucide-react";
import { nodeColor } from "@/lib/nodeColors";
import { truncate } from "@/lib/stringUtils";
import EmptyState from "@/components/EmptyState";
import type { GraphNode, MemoryNode } from "@/lib/types";

const CATEGORIES = ["gotcha", "architecture", "pattern", "preference", "workflow", "constraint"] as const;

function Stars({ count }: { count: number }) {
  return (
    <span className="text-[var(--accent)] tracking-tight text-[10px]">
      {"★".repeat(count)}{"☆".repeat(5 - count)}
    </span>
  );
}

export default function ProjectBoardView({
  memories,
  onSelect,
}: {
  memories: MemoryNode[];
  onSelect: (node: GraphNode) => void;
}) {
  const columns = useMemo(() => {
    const map = new Map<string, MemoryNode[]>();
    for (const m of memories) {
      const col = map.get(m.category) ?? [];
      col.push(m);
      map.set(m.category, col);
    }
    // Sort each column by importance desc
    for (const [, arr] of map) {
      arr.sort((a, b) => b.importance - a.importance);
    }
    return map;
  }, [memories]);

  // Use defined order, but also include any unlisted categories
  const allCategories = [
    ...CATEGORIES.filter(c => columns.has(c)),
    ...[...columns.keys()].filter(c => !(CATEGORIES as readonly string[]).includes(c)),
  ];

  if (allCategories.length === 0) {
    return (
      <EmptyState
        icon={LayoutDashboard}
        title="No memories to display"
        description="Memories will appear here once they're added to this project."
      />
    );
  }

  return (
    <div className="flex h-full overflow-x-auto overflow-y-hidden gap-3 px-4 py-4">
      {allCategories.map(cat => {
        const items = columns.get(cat) ?? [];
        const color = nodeColor(cat);
        return (
          <div
            key={cat}
            className="flex flex-col flex-shrink-0 w-64 rounded-[12px] bg-transparent border border-dashed border-[var(--border)] overflow-hidden"
          >
            {/* Column header */}
            <div className="px-3 py-2.5 border-b border-dashed border-[var(--border)] flex items-center gap-2 bg-transparent">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{cat}</span>
              <span className="ml-auto text-[10px] text-[var(--text-muted)] border border-[var(--border)] px-1.5 py-0.5 rounded-full font-mono">
                {items.length}
              </span>
            </div>

            {/* Cards */}
            <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-2 p-2">
              {items.map(m => (
                <button
                  key={m.id}
                  onClick={() => onSelect(m as GraphNode)}
                  title={m.confidence != null && m.confidence < 0.4 ? "Confidence is low — this memory may be deprecated soon" : undefined}
                  className={`w-full text-left p-3 rounded-[12px] bg-transparent border transition-colors group ${
                    m.confidence != null && m.confidence < 0.4
                      ? "border-[var(--border)] border-b-[var(--accent)] border-b-[2px] border-b-dashed hover:border-[var(--text-primary)]"
                      : "border-[var(--border)] hover:border-[var(--text-primary)]"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <Stars count={m.importance} />
                    {m.confidence != null && (
                      <span className="text-[10px] text-[var(--text-muted)]">{Math.round(m.confidence * 100)}%</span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors leading-relaxed mb-3">
                    {truncate(m.content, 120)}
                  </p>
                  {m.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {m.tags.slice(0, 4).map(t => (
                        <span key={t} className="px-1.5 py-0.5 rounded text-[10px] bg-transparent border border-[var(--border)] text-[var(--text-muted)]">{t}</span>
                      ))}
                      {m.tags.length > 4 && (
                        <span className="text-[10px] text-[var(--text-muted)]">+{m.tags.length - 4}</span>
                      )}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
