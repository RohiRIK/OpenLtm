"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { List, LayoutDashboard, Filter } from "lucide-react";
import ProjectTableView from "@/components/ProjectTableView";
import ProjectBoardView from "@/components/ProjectBoardView";
import Sidebar from "@/components/Sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import type { GraphNode, ProjectDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

type ViewMode = "table" | "board";

export default function ProjectMemoriesPage() {
  const { name } = useParams<{ name: string }>();
  const projectName = decodeURIComponent(name);

  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewMode>("table");
  const [categoryFilter, setCategoryFilter] = useState<string | "All">("All");

  useEffect(() => {
    let alive = true;
    api.project(projectName)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [projectName]);

  const allCategories = useMemo(() => {
    if (!detail) return ["All"];
    const cats = new Set<string>();
    for (const m of detail.memories) cats.add(m.category);
    return ["All", ...Array.from(cats)].sort();
  }, [detail]);

  const filteredMemories = useMemo(() => {
    if (!detail) return [];
    if (categoryFilter === "All") return detail.memories;
    return detail.memories.filter((m) => m.category === categoryFilter);
  }, [detail, categoryFilter]);

  if (error) {
    return (
      <div className="h-full overflow-y-auto p-6 space-y-4">
        <p className="text-sm text-destructive">Failed to load: {error}</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="h-full overflow-y-auto p-6 space-y-6">
        <Skeleton className="h-10 w-full rounded-lg bg-[var(--node-memory)] animate-pulse" />
        <Skeleton className="h-[400px] rounded-xl bg-[var(--node-memory)] animate-pulse" />
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden relative">
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="mx-auto max-w-7xl px-6 py-6 space-y-4">
          <header className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">Memories</h1>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {filteredMemories.length} of {detail.memories.length} shown
                {categoryFilter !== "All" && ` · filtered by ${categoryFilter}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveView("table")}
                className={cn(
                  "px-3 py-1.5 rounded-[22.5px] text-xs font-medium transition-colors flex items-center gap-2 border",
                  activeView === "table"
                    ? "text-[var(--text-primary)] border-[var(--text-primary)]"
                    : "bg-transparent text-[var(--text-muted)] border-transparent hover:text-[var(--text-primary)]"
                )}
              >
                <List className="w-3.5 h-3.5" /> Table
              </button>
              <button
                onClick={() => setActiveView("board")}
                className={cn(
                  "px-3 py-1.5 rounded-[22.5px] text-xs font-medium transition-colors flex items-center gap-2 border",
                  activeView === "board"
                    ? "text-[var(--text-primary)] border-[var(--text-primary)]"
                    : "bg-transparent text-[var(--text-muted)] border-transparent hover:text-[var(--text-primary)]"
                )}
              >
                <LayoutDashboard className="w-3.5 h-3.5" /> Board
              </button>
            </div>
          </header>

          <div className="flex items-center gap-2 px-1">
            <Filter className="w-3.5 h-3.5 text-muted-foreground" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-transparent border-b border-[var(--text-primary)] rounded-none px-3 py-1 text-xs text-[var(--text-primary)] focus:outline-none transition-colors appearance-none custom-select"
            >
              {allCategories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div className="border border-dashed border-[var(--border)] rounded-[12px] overflow-hidden min-h-[500px] p-4">
            {activeView === "table" ? (
              <ProjectTableView memories={filteredMemories} onSelect={setSelected} />
            ) : (
              <ProjectBoardView memories={filteredMemories} onSelect={setSelected} />
            )}
          </div>
        </div>
      </div>

      {selected && (
        <div className="w-[400px] shrink-0 border-l border-[var(--border)] bg-[var(--bg-primary)] z-20 h-full">
          <Sidebar node={selected} onClose={() => setSelected(null)} />
        </div>
      )}
    </div>
  );
}
