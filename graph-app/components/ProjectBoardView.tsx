"use client";
import { useMemo, useState, useRef, useEffect } from "react";
import { LayoutDashboard, Check, X } from "lucide-react";
import { nodeColor } from "@/lib/nodeColors";
import { truncate } from "@/lib/stringUtils";
import EmptyState from "@/components/EmptyState";
import type { GraphNode, MemoryNode } from "@/lib/types";

const CATEGORIES = ["gotcha", "architecture", "pattern", "preference", "workflow", "constraint"] as const;

function Stars({ count }: { count: number }) {
  return (
    <span className="text-[var(--accent)] tracking-tight text-[10px]" aria-label={`${count} of 5 importance`}>
      {"★".repeat(count)}{"☆".repeat(5 - count)}
    </span>
  );
}

type Editing = { id: string; value: string } | null;

export default function ProjectBoardView({
  memories,
  onSelect,
  onEdit,
}: {
  memories: MemoryNode[];
  onSelect: (node: GraphNode) => void;
  onEdit?: (node: GraphNode, newContent: string) => void;
}) {
  const [editing, setEditing] = useState<Editing>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const columns = useMemo(() => {
    const map = new Map<string, MemoryNode[]>();
    for (const m of memories) {
      const col = map.get(m.category) ?? [];
      col.push(m);
      map.set(m.category, col);
    }
    for (const [, arr] of map) {
      arr.sort((a, b) => b.importance - a.importance);
    }
    return map;
  }, [memories]);

  const allCategories = [
    ...CATEGORIES.filter(c => columns.has(c)),
    ...[...columns.keys()].filter(c => !(CATEGORIES as readonly string[]).includes(c)),
  ];

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.setSelectionRange(editing.value.length, editing.value.length);
    }
  }, [editing]);

  function startEdit(m: MemoryNode) {
    setEditing({ id: m.id, value: m.content });
  }

  function commitEdit() {
    if (!editing) return;
    const m = memories.find(x => x.id === editing.id);
    if (m && onEdit && editing.value.trim() && editing.value !== m.content) {
      onEdit(m as GraphNode, editing.value.trim());
    }
    setEditing(null);
  }

  function cancelEdit() {
    setEditing(null);
  }

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
            <div className="h-9 px-3 border-b border-dashed border-[var(--border)] flex items-center gap-2 bg-transparent">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{cat}</span>
              <span className="ml-auto text-[10px] text-[var(--text-muted)] border border-[var(--border)] px-1.5 py-0.5 rounded-full font-mono tabular-nums">
                {items.length}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-2 p-2">
              {items.map(m => {
                const isEditing = editing?.id === m.id;
                const isLowConf = m.confidence != null && m.confidence < 0.4;
                return (
                  <div
                    key={m.id}
                    title={isLowConf ? "Confidence is low — this memory may be deprecated soon" : undefined}
                    className={`w-full text-left p-3 rounded-[12px] bg-transparent border transition-colors group cursor-pointer ${
                      isLowConf
                        ? "border-[var(--border)] border-b-[var(--accent)] border-b-[2px] border-b-dashed hover:border-[var(--text-primary)]"
                        : "border-[var(--border)] hover:border-[var(--text-primary)]"
                    }`}
                    onClick={() => !isEditing && onSelect(m as GraphNode)}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <Stars count={m.importance} />
                      {m.confidence != null && (
                        <span className="text-[10px] text-[var(--text-muted)] tabular-nums">{Math.round(m.confidence * 100)}%</span>
                      )}
                    </div>
                    {isEditing ? (
                      <div onClick={(e) => e.stopPropagation()}>
                        <textarea
                          ref={inputRef}
                          value={editing!.value}
                          onChange={(e) => setEditing({ ...editing!, value: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") cancelEdit();
                            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") commitEdit();
                          }}
                          rows={3}
                          className="w-full text-xs text-[var(--text-primary)] bg-transparent border border-[var(--border)] rounded p-1.5 focus:outline-none focus:border-[var(--text-primary)] resize-none"
                        />
                        <div className="flex items-center gap-1 mt-1.5">
                          <button
                            type="button"
                            onClick={commitEdit}
                            className="h-6 px-2 grid place-items-center gap-1 text-[10px] text-[var(--text-primary)] border border-[var(--text-primary)] rounded hover:bg-[var(--bg-secondary)] transition-colors"
                            title="Save (⌘+Enter)"
                          >
                            <Check className="w-3 h-3" />
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="h-6 px-2 grid place-items-center gap-1 text-[10px] text-[var(--text-muted)] border border-[var(--border)] rounded hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
                            title="Cancel (Esc)"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p
                        className="text-xs text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors leading-relaxed mb-3"
                        onDoubleClick={(e) => { e.stopPropagation(); onEdit && startEdit(m); }}
                      >
                        {truncate(m.content, 120)}
                      </p>
                    )}
                    {m.tags.length > 0 && !isEditing && (
                      <div className="flex flex-wrap gap-1">
                        {m.tags.slice(0, 4).map(t => (
                          <span key={t} className="px-1.5 py-0.5 rounded text-[10px] bg-transparent border border-[var(--border)] text-[var(--text-muted)]">{t}</span>
                        ))}
                        {m.tags.length > 4 && (
                          <span className="text-[10px] text-[var(--text-muted)]">+{m.tags.length - 4}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
