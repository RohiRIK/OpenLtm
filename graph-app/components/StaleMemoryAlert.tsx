"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Pencil, Trash2, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { nodeColor } from "@/lib/nodeColors";
import { cn } from "@/lib/utils";
import type { MemoryNode } from "@/lib/types";

interface StaleMemory {
  id: number;
  content: string;
  category: string;
  confidence: number;
  project_scope: string | null;
  last_confirmed_at: string;
}

const STALE_THRESHOLD = 0.3;
const VISIBLE_LIMIT = 10;

interface StaleMemoryAlertProps {
  memories?: MemoryNode[];
  projectName?: string;
  onEdit?: (m: MemoryNode) => void;
  onViewAll?: () => void;
  onChange?: () => void;
}

export default function StaleMemoryAlert({
  memories: memoriesProp,
  projectName,
  onEdit,
  onViewAll,
  onChange,
}: StaleMemoryAlertProps) {
  const [fetched, setFetched] = useState<MemoryNode[] | null>(null);
  const [stale, setStale] = useState<StaleMemory[]>([]);
  const [confirmedIds, setConfirmedIds] = useState<Set<number>>(new Set());
  const [forgottenIds, setForgottenIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (memoriesProp) return;
    let alive = true;
    api.graph().then(({ nodes }) => {
      if (!alive) return;
      setFetched(nodes as MemoryNode[]);
    }).catch(() => {
      if (alive) setFetched([]);
    });
    return () => { alive = false; };
  }, [memoriesProp]);

  const memories = memoriesProp ?? fetched ?? [];

  useEffect(() => {
    const list: StaleMemory[] = [];
    for (const m of memories) {
      if (m.confidence < STALE_THRESHOLD) {
        if (projectName && m.project_scope !== projectName) continue;
        list.push({
          id: m.id,
          content: m.content,
          category: m.category,
          confidence: m.confidence,
          project_scope: m.project_scope,
          last_confirmed_at: m.last_confirmed_at,
        });
      }
    }
    list.sort((a, b) => a.confidence - b.confidence);
    setStale(list);
  }, [memories, projectName]);

  async function handleConfirm(id: number) {
    const m = memories.find((x) => x.id === id);
    if (!m) return;
    setConfirmedIds((prev) => new Set(prev).add(id));
    onChange?.();
  }

  async function handleForget(id: number) {
    if (!confirm("Forget this memory? It can be recovered from Settings → Health → Recover for 30 days.")) return;
    try {
      await api.deleteMemory(id);
      setForgottenIds((prev) => new Set(prev).add(id));
      onChange?.();
    } catch (e) {
      alert(`Failed to forget: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (stale.length === 0) return null;

  const visible = stale.filter((m) => !forgottenIds.has(m.id)).slice(0, VISIBLE_LIMIT);
  const hiddenCount = stale.length - visible.length;

  return (
    <div className="border border-dashed border-[var(--border)] rounded-[12px] p-5 space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-[var(--accent)]" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">Memories at Risk</h3>
        <span className="ml-auto text-[10px] text-[var(--text-muted)] border border-[var(--border)] px-1.5 py-0.5 rounded-full font-mono tabular-nums">
          {stale.length}
        </span>
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1"
          >
            View all
            <ExternalLink className="w-2.5 h-2.5" />
          </button>
        )}
      </div>

      <ul className="space-y-1">
        {visible.map((m) => {
          const isConfirmed = confirmedIds.has(m.id);
          const fullMemory = memories.find((x) => x.id === m.id);
          return (
            <li
              key={m.id}
              className="group flex items-center gap-2 px-2 py-1.5 -mx-2 rounded hover:bg-white/5 transition-colors"
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: nodeColor(m.category) }}
                aria-hidden
              />
              <span
                className="text-xs text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors truncate flex-1 min-w-0"
                title={m.content}
              >
                {m.content.length > 60 ? m.content.slice(0, 60) + "…" : m.content}
              </span>
              <span className="text-[10px] text-[var(--accent)] font-mono shrink-0 tabular-nums">
                {Math.round(m.confidence * 100)}%
              </span>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => handleConfirm(m.id)}
                  disabled={isConfirmed}
                  className={cn(
                    "h-6 w-6 grid place-items-center rounded transition-colors shrink-0",
                    isConfirmed
                      ? "text-emerald-500"
                      : "text-[var(--text-muted)] hover:text-emerald-500 hover:bg-emerald-500/10"
                  )}
                  title={isConfirmed ? "Confirmed" : "Confirm still relevant"}
                  aria-label="Confirm"
                >
                  <Check className="w-3 h-3" />
                </button>
                {onEdit && fullMemory && (
                  <button
                    type="button"
                    onClick={() => onEdit(fullMemory)}
                    className="h-6 w-6 grid place-items-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-colors shrink-0"
                    title="Edit"
                    aria-label="Edit"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleForget(m.id)}
                  className="h-6 w-6 grid place-items-center rounded text-[var(--text-muted)] hover:text-rose-500 hover:bg-rose-500/10 transition-colors shrink-0"
                  title="Forget"
                  aria-label="Forget"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {hiddenCount > 0 && (
        <p className="text-[10px] text-[var(--text-muted)] tabular-nums">
          +{hiddenCount} more at risk
        </p>
      )}
    </div>
  );
}
