"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderTree, Network, Activity, Settings, Search as SearchIcon, Sparkles, Check, Database, Loader2 } from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { nodeColor } from "@/lib/nodeColors";
import type { FtsResult, SemanticResult } from "@/lib/types";
import { cn } from "@/lib/utils";

const ROUTES = [
  { href: "/", label: "Projects", icon: FolderTree },
  { href: "/graph", label: "Global Graph", icon: Network },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

type Mode = "keyword" | "semantic";

interface ResultRow {
  id: number;
  content: string;
  category: string;
  project_scope: string | null;
  similarity?: number;
  kind: "memory" | "context";
}

function toRow(r: FtsResult): ResultRow {
  return {
    id: r.id,
    content: r.title ? `${r.title} — ${r.content}` : r.content,
    category: r.category,
    project_scope: r.project_scope,
    kind: r.type,
  };
}

function toSemanticRow(r: SemanticResult): ResultRow {
  return {
    id: r.id,
    content: r.content,
    category: r.category,
    project_scope: r.project_scope,
    similarity: r.similarity,
    kind: "memory",
  };
}

export default function Omnibar() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("semantic");
  const [results, setResults] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        if (mode === "keyword") {
          const fts = await api.searchAll(trimmed);
          if (id === reqId.current) setResults(fts.map(toRow));
        } else {
          const sem = await api.semanticSearch(trimmed, 10, 0.4);
          if (id === reqId.current) setResults(sem.map(toSemanticRow));
        }
      } catch (e) {
        // ignore search errors in omnibar to avoid jarring UI jumps
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [trimmed, mode]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function handleResultClick(row: ResultRow) {
    setOpen(false);
    if (row.project_scope) {
      // In the future, this could navigate to the graph and center on the node
      // For now, go to the project page
      router.push(`/project/${encodeURIComponent(row.project_scope)}`);
    }
  }

  return (
    <>
      {/* Trigger Button - Ghost Input Style */}
      <button
        onClick={() => setOpen(true)}
        className="group relative flex w-96 items-center gap-2 border-b border-[var(--text-primary)] bg-transparent px-2 py-2 text-sm text-[var(--text-primary)]/50 transition-all hover:text-[var(--text-primary)] focus:outline-none"
      >
        <SearchIcon className="h-4 w-4" />
        <span className="flex-1 text-left">Search memories, projects, or jump to...</span>
        <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 bg-transparent px-1.5 font-mono text-[10px] font-medium text-[var(--text-primary)]/50 opacity-100 sm:flex group-hover:text-[var(--text-primary)]">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      {/* The Command Dialog */}
      <CommandDialog open={open} onOpenChange={setOpen}>
        <div className="flex items-center border-b border-border px-3">
          <SearchIcon className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <CommandInput 
            placeholder="Search or type a command..." 
            className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 border-none focus:ring-0" 
            value={query}
            onValueChange={setQuery}
          />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {query.length > 0 && (
          <div className="flex items-center justify-end gap-2 px-4 py-2 border-b border-border/50 bg-muted/20">
            <button
              onClick={() => setMode("semantic")}
              className={cn("text-[10px] px-2 py-1 rounded-full flex items-center gap-1 transition-colors", mode === "semantic" ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground hover:bg-muted")}
            >
              <Sparkles className="w-3 h-3" /> Semantic
            </button>
            <button
              onClick={() => setMode("keyword")}
              className={cn("text-[10px] px-2 py-1 rounded-full flex items-center gap-1 transition-colors", mode === "keyword" ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground hover:bg-muted")}
            >
              <Database className="w-3 h-3" /> Keyword
            </button>
          </div>
        )}

        <CommandList className="max-h-[60vh] overflow-y-auto p-2">
          {query.length === 0 && (
            <CommandGroup heading="Navigation">
              {ROUTES.map(({ href, label, icon: Icon }) => (
                <CommandItem key={href} value={label} onSelect={() => go(href)} className="flex items-center gap-2 cursor-pointer rounded-md">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  <span>{label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {query.length > 0 && results.length === 0 && !loading && (
            <div className="py-14 text-center text-sm text-muted-foreground">
              No results found for "{query}"
            </div>
          )}

          {results.length > 0 && (
            <CommandGroup heading="Search Results">
              {results.map((r) => (
                <CommandItem
                  key={`${r.kind}-${r.id}`}
                  value={r.content}
                  onSelect={() => handleResultClick(r)}
                  className="flex flex-col items-start gap-1 p-3 cursor-pointer rounded-lg mb-1"
                >
                  <div className="flex items-center gap-2 w-full">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: nodeColor(r.category) }}
                    />
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                      {r.category}
                    </Badge>
                    {r.project_scope && (
                      <span className="text-[10px] text-muted-foreground truncate flex-1">
                        {r.project_scope}
                      </span>
                    )}
                    {r.similarity !== undefined && (
                      <span className="text-[10px] text-primary/80 shrink-0">
                        {Math.round(r.similarity * 100)}%
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-foreground line-clamp-2 leading-relaxed">
                    {r.content}
                  </p>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
