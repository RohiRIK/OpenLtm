"use client";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { SearchX } from "lucide-react";
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
    <span className="text-[var(--accent)] tracking-tight text-xs">
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
      <span className="text-[10px] text-[var(--text-muted)]">{Math.round(value * 100)}%</span>
      {value < 0.4 && <AlertTriangle className="w-3 h-3 text-[var(--accent)] ml-1" />}
    </div>
  );
}

export default function ProjectTableView({
  memories,
  onSelect,
}: {
  memories: MemoryNode[];
  onSelect: (node: GraphNode) => void;
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

  // Reset selectedIndex when sorted list changes
  useEffect(() => {
    setSelectedIndex(-1);
  }, [sorted]);

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't capture when typing in the search input
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

  // Auto-scroll selected row into view
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
        className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)] cursor-pointer select-none hover:text-[var(--text-primary)] whitespace-nowrap transition-colors"
        onClick={() => toggleSort(col)}
      >
        {label}
        {active && <span className="ml-1 text-[var(--accent)]">{sortDir === "asc" ? "↑" : "↓"}</span>}
      </th>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search bar */}
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <input
          type="text"
          placeholder="Filter memories…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="w-full bg-transparent border-b border-[var(--text-primary)] rounded-[0px] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none transition-colors"
        />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-[var(--bg-primary)] border-b border-[var(--border)] z-10">
            <tr>
              <Th label="Category" col="category" />
              <Th label="Importance" col="importance" />
              <Th label="Confidence" col="confidence" />
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)] w-full">Content</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)] whitespace-nowrap">Tags</th>
              <Th label="Created" col="created_at" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6}>
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
                className={`border-b border-[var(--border)] hover:bg-[var(--node-memory)] cursor-pointer transition-colors group ${
                  selectedIndex === i ? "bg-[var(--node-memory)] border-l-2 border-l-[var(--accent)]" : ""
                }`}
              >
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0 group-hover:scale-110 transition-transform" style={{ backgroundColor: nodeColor(m.category) }} />
                    <span className="text-xs text-[var(--text-primary)] font-medium uppercase tracking-wider">{m.category}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <Stars count={m.importance} />
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <ConfBar value={m.confidence} />
                </td>
                <td className="px-3 py-2.5 max-w-xs">
                  <span title={m.content} className="text-xs text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors">
                    {truncate(m.content, 80)}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {m.tags.slice(0, 3).map(t => (
                      <span key={t} className="px-1.5 py-0.5 rounded text-[10px] bg-transparent border border-[var(--border)] text-[var(--text-muted)]">{t}</span>
                    ))}
                    {m.tags.length > 3 && (
                      <span className="text-[10px] text-[var(--text-muted)]">+{m.tags.length - 3}</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-[10px] text-[var(--text-muted)] font-mono">
                  {m.created_at ? relativeDate(m.created_at) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 border-t border-[var(--border)] text-xs text-[var(--text-muted)] bg-[var(--bg-primary)]">
        {sorted.length} of {memories.length} memories
      </div>
    </div>
  );
}
