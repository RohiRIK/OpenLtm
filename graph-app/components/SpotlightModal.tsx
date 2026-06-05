"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { Clock } from "lucide-react";
import { api } from "@/lib/api";
import { nodeColor } from "@/lib/nodeColors";
import { cn } from "@/lib/utils";
import type { SearchResult } from "@/lib/types";

const HISTORY_KEY = "ltm.searchHistory";
const HISTORY_MAX = 10;

function loadHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string").slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

function saveHistory(items: string[]) {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_MAX)));
  } catch {
    // localStorage unavailable (private mode, quota) — silently degrade
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (result: SearchResult) => void;
}

export default function SpotlightModal({ open, onClose, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<SearchResult[]>([]);
  const activeIdxRef = useRef(0);
  const onCloseRef = useRef(onClose);
  const onSelectRef = useRef(onSelect);
  const historyRef = useRef<string[]>([]);

  useEffect(() => { resultsRef.current = results; }, [results]);
  useEffect(() => { activeIdxRef.current = activeIdx; }, [activeIdx]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { historyRef.current = history; }, [history]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setActiveIdx(0);
      setHistory(loadHistory());
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await api.search(query);
        if (!cancelled) { setResults(res); setActiveIdx(0); }
      } catch { /* ignore */ }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  const commitQuery = useCallback((q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    const next = [trimmed, ...historyRef.current.filter((h) => h !== trimmed)].slice(0, HISTORY_MAX);
    setHistory(next);
    saveHistory(next);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onCloseRef.current(); return; }
      if (e.key === "ArrowDown") {
        setActiveIdx(i => { const next = Math.min(i + 1, resultsRef.current.length - 1); activeIdxRef.current = next; return next; });
        e.preventDefault();
      }
      if (e.key === "ArrowUp") {
        setActiveIdx(i => { const next = Math.max(i - 1, 0); activeIdxRef.current = next; return next; });
        e.preventDefault();
      }
      if (e.key === "Enter") {
        const r = resultsRef.current[activeIdxRef.current];
        if (r) { onSelectRef.current(r); onCloseRef.current(); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  if (!open) return null;

  const showHistory = query.length < 2 && history.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)]">
          <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && query.length >= 2) commitQuery(query); }}
            placeholder="Jump to memory…"
            className="flex-1 bg-transparent text-[var(--text-primary)] text-sm outline-none placeholder-[var(--text-muted)]"
          />
          <span className="text-[var(--text-muted)] text-xs">ESC</span>
        </div>

        {results.length > 0 && (
          <ul className="max-h-80 overflow-y-auto py-1">
            {results.map((r, i) => (
              <li
                key={r.id}
                className={cn(
                  "px-4 py-2.5 cursor-pointer flex gap-3 items-start transition-colors",
                  i === activeIdx ? "bg-[#1f2937]" : "hover:bg-[#1a2030]"
                )}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => { onSelect(r); onClose(); }}
              >
                <span
                  className="mt-0.5 w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: nodeColor(r.category) }}
                />
                <div className="min-w-0">
                  <p className="text-sm text-gray-200 truncate">{r.content}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {r.category}
                    {r.project_scope && ` · ${r.project_scope}`}
                    {` · imp ${r.importance}`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {showHistory && (
          <ul className="max-h-80 overflow-y-auto py-1">
            <li className="px-4 pt-2 pb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-medium">
              <Clock className="w-3 h-3" />
              Recent searches
            </li>
            {history.map((q, i) => (
              <li
                key={q}
                className="px-4 py-2 cursor-pointer flex gap-3 items-center hover:bg-[#1a2030] transition-colors"
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => setQuery(q)}
              >
                <Clock className="w-3 h-3 text-[var(--text-muted)] shrink-0" />
                <span className="text-sm text-gray-300 truncate">{q}</span>
              </li>
            ))}
          </ul>
        )}

        {query.length >= 2 && results.length === 0 && (
          <p className="px-4 py-4 text-sm text-gray-500">No results for "{query}"</p>
        )}
      </div>
    </div>
  );
}
