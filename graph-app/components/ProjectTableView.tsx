"use client";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { SearchX, ExternalLink, Pencil } from "lucide-react";
import { nodeColor } from "@/lib/nodeColors";
import { truncate } from "@/lib/stringUtils";
import EmptyState from "@/components/EmptyState";
import type { GraphNode, MemoryNode } from "@/lib/types";

type SortKey = "category" | "importance" | "confidence" | "content" | "created_at";
type SortDir = "asc" | "desc";

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function Stars({ count }: { count: number }) {
  return (
    <span className="text-[var(--accent)] tracking-tight text-xs" aria-label={`${count} of 5 importance`}>
      {"★".repeat(count)}{"☆".repeat(5 - count)}
    </span>
  );
}

import { AlertTriangle } from "lucide-react";

function ConfBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-1.5" title={value < 0.4 ? "Confidence is low — this memory may be deprecated soon" : undefined}>
      <div className="w-16 h-1.5 bg-[var(--node-memory)] rounded-[0px] overflow-hidden">
        <div className="h-full bg-[var(--accent)]" style={{ width: `${value * 100}%` }} />
      </div>
      <span className="text-[10px] text-[var(--text-muted)] tabular-nums">{Math.round(value * 100)}%</span>
      {value < 0.4 && <AlertTriangle className="w-3 h-3 text-[var(--accent)] ml-1" />}
    </div>
  );
}

export default function ProjectTableView({
  memories,
  onSelect,
  onEdit,
}: {
  memories: MemoryNode[];
  onSelect: (node: GraphNode) => void;
  onEdit?: (node: GraphNode) => void;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("importance");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return memories.filter(
      m =>
        !q ||
        m.content.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        m.tags.some(t => t.toLowerCase().includes(q))
    );
  }, [memories, query]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av: string | number, bv: string | number;
      if (sortKey === "category") { av = a.category; bv = b.category; }
      else if (sortKey === "importance") { av = a.importance; bv = b.importance; }
      else if (sortKey === "confidence") { av = a.confidence; bv = b.confidence; }
      else if (sortKey === "content") { av = a.content; bv = b.content; }
      else { av = a.created_at; bv = b.created_at; }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  useEffect(() => {
    setSelectedIndex(-1);
  }, [sorted]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Skip when user is typing in the search input.
      if ((e.target as HTMLElement).tagName === "INPUT") return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, sorted.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        setSelectedIndex(prev => {
          if (prev >= 0 && prev < sorted.length) {
            onSelect(sorted[prev] as GraphNode);
          }
          return prev;
        });
      } else if (e.key === "Escape") {
        setSelectedIndex(-1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sorted, onSelect]);

  useEffect(() => {
    if (selectedIndex >= 0 && rowRefs.current[selectedIndex]) {
      rowRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const setRowRef = useCallback((index: number) => (el: HTMLTableRowElement | null) => {
    rowRefs.current[index] = el;
  }, []);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function Th({ label, col }: { label: string; col: SortKey }) {
    const active = sortKey === col;
    return (
      <th
        className="h-8 px-3 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)] cursor-pointer select-none hover:text-[var(--text-primary)] whitespace-nowrap transition-colors"
        onClick={() => toggleSort(col)}
      >
        {label}
        {active && <span className="ml-1 text-[var(--accent)]">{sortDir === "asc" ? "↑" : "↓"}</span>}
      </th>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 h-10 flex items-center border-b border-[var(--border)]">
        <input
          type="text"
          placeholder="Filter memories…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="w-full bg-transparent text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none transition-colors"
        />
      </div>

      <div className="flex-1 overflow-auto custom-scrollbar">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-[var(--bg-primary)] border-b border-[var(--border)] z-10">
            <tr>
              <Th label="Category" col="category" />
              <Th label="Importance" col="importance" />
              <Th label="Confidence" col="confidence" />
              <th className="h-8 px-3 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)] w-full">Content</th>
              <th className="h-8 px-3 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap">Tags</th>
              <Th label="Created" col="created_at" />
              <th className="h-8 w-0 p-0" aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState
                    icon={SearchX}
                    title="No memories match"
                    description="Try adjusting your filter or clearing the search query."
                  />
                </td>
              </tr>
            )}
            {sorted.map((m, i) => (
              <tr
                key={m.id}
                ref={setRowRef(i)}
                onClick={() => { setSelectedIndex(i); onSelect(m as GraphNode); }}
                className={`group border-b border-[var(--border)] cursor-pointer transition-colors ${
                  selectedIndex === i
                    ? "bg-[var(--node-memory)]"
                    : "hover:bg-[var(--node-memory)]"
                }`}
              >
                <td className="h-8 px-3 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0 group-hover:scale-125 transition-transform" style={{ backgroundColor: nodeColor(m.category) }} />
                    <span className="text-[11px] text-[var(--text-primary)] font-medium uppercase tracking-wider">{m.category}</span>
                  </div>
                </td>
                <td className="h-8 px-3 whitespace-nowrap">
                  <Stars count={m.importance} />
                </td>
                <td className="h-8 px-3 whitespace-nowrap">
                  <ConfBar value={m.confidence} />
                </td>
                <td className="h-8 px-3 max-w-xs">
                  <span title={m.content} className="text-xs text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors block truncate">
                    {truncate(m.content, 80)}
                  </span>
                </td>
                <td className="h-8 px-3">
                  <div className="flex flex-wrap gap-1">
                    {m.tags.slice(0, 3).map(t => (
                      <span key={t} className="px-1.5 py-0 rounded text-[10px] bg-transparent border border-[var(--border)] text-[var(--text-muted)]">{t}</span>
                    ))}
                    {m.tags.length > 3 && (
                      <span className="text-[10px] text-[var(--text-muted)]">+{m.tags.length - 3}</span>
                    )}
                  </div>
                </td>
                <td className="h-8 px-3 whitespace-nowrap text-[10px] text-[var(--text-muted)] font-mono tabular-nums">
                  {m.created_at ? relativeDate(m.created_at) : "—"}
                </td>
                <td className="h-8 pr-3 w-0">
                  <div className="flex items-center gap-0.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onSelect(m as GraphNode); }}
                      title="Open in inspector"
                      className="h-6 w-6 grid place-items-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </button>
                    {onEdit && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onEdit(m as GraphNode); }}
                        title="Edit"
                        className="h-6 w-6 grid place-items-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="h-8 px-4 flex items-center text-xs text-[var(--text-muted)] bg-[var(--bg-primary)] border-t border-[var(--border)] tabular-nums">
        {sorted.length} of {memories.length} memories
      </div>
    </div>
  );
}
