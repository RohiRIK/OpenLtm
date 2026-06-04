"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, useMemo } from "react";
import { ArrowLeft, Network, LayoutDashboard, List, Maximize2, ChevronDown, ChevronUp, Filter } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import ProjectTableView from "@/components/ProjectTableView";
import ProjectBoardView from "@/components/ProjectBoardView";
import ProjectConnections from "@/components/ProjectConnections";
import ProjectRelevance from "@/components/ProjectRelevance";
import ProjectTimeline from "@/components/ProjectTimeline";
import ProjectActivityLog from "@/components/ProjectActivityLog";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { nodeColor } from "@/lib/nodeColors";
import type { GraphNode, ProjectDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

// MiniGraph removed per design update

const CONTEXT_TYPES = ["goal", "decision", "gotcha", "progress"] as const;

function shortName(name: string): string {
  return name.split("/").pop() || name;
}

export default function ProjectPage() {
  const { name } = useParams<{ name: string }>();
  const projectName = decodeURIComponent(name);

  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Simple state to toggle between views at the bottom
  const [activeView, setActiveView] = useState<"table" | "board" | "connections">("table");
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
        <BackLink />
        <p className="text-sm text-destructive">Failed to load: {error}</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="h-full overflow-y-auto p-6 space-y-6">
        <BackLink />
        <Skeleton className="h-8 w-64 rounded-lg bg-[var(--node-memory)] animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="col-span-2 h-[400px] rounded-xl bg-[var(--node-memory)] animate-pulse" />
          <Skeleton className="h-[400px] rounded-xl bg-[var(--node-memory)] animate-pulse" />
        </div>
      </div>
    );
  }
  const hasNodes = detail ? (detail.memories.length > 0 || detail.context_items.length > 0) : false;

  return (
    <div className="flex h-full overflow-hidden relative">
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="mx-auto max-w-7xl px-6 py-8 space-y-8">
          {/* Header */}
          <div className="flex flex-col gap-4">
            <BackLink />
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground truncate" title={projectName}>
                {shortName(projectName)}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {detail.memories.length} memories · {detail.context_items.length} context items ·{" "}
                {detail.relations.length} relations
              </p>
            </div>
          </div>

          {/* Context & Relevance Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="flex flex-col gap-6">
              <div className="border border-dashed border-[var(--border)] rounded-[12px] p-6">
                <ContextSection detail={detail} />
              </div>
            </div>
            
            <div className="flex flex-col gap-6">
              <div className="border border-dashed border-[var(--border)] rounded-[12px] p-6">
                <ProjectRelevance detail={detail} />
              </div>
            </div>
          </div>

          {/* Timeline Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="border border-dashed border-[var(--border)] rounded-[12px] p-6">
              <h3 className="text-lg font-semibold tracking-tight mb-4 text-[var(--text-primary)]">Project Timeline</h3>
              <ProjectTimeline detail={detail} />
            </div>
            
            <div className="border border-dashed border-[var(--border)] rounded-[12px] p-6">
              <h3 className="text-lg font-semibold tracking-tight mb-4 text-[var(--text-primary)]">Recent Activity</h3>
              <ProjectActivityLog memories={detail.memories} />
            </div>
          </div>

          {/* Detailed Views Section */}
          <div className="border border-dashed border-[var(--border)] rounded-[12px] overflow-hidden flex flex-col min-h-[600px]">
            <div className="flex items-center border-b border-dashed border-[var(--border)] px-4 py-3 bg-transparent gap-2 overflow-x-auto custom-scrollbar">
              <button
                onClick={() => setActiveView("table")}
                className={cn("px-4 py-1.5 rounded-[22.5px] text-xs font-medium transition-colors flex items-center gap-2 border", activeView === "table" ? "text-[var(--text-primary)] border-[var(--text-primary)]" : "bg-transparent text-[var(--text-muted)] border-transparent hover:text-[var(--text-primary)]")}
              >
                <List className="w-3.5 h-3.5" /> Table
              </button>
              <button
                onClick={() => setActiveView("board")}
                className={cn("px-4 py-1.5 rounded-[22.5px] text-xs font-medium transition-colors flex items-center gap-2 border", activeView === "board" ? "text-[var(--text-primary)] border-[var(--text-primary)]" : "bg-transparent text-[var(--text-muted)] border-transparent hover:text-[var(--text-primary)]")}
              >
                <LayoutDashboard className="w-3.5 h-3.5" /> Board
              </button>
              <button
                onClick={() => setActiveView("connections")}
                className={cn("px-4 py-1.5 rounded-[22.5px] text-xs font-medium transition-colors flex items-center gap-2 border", activeView === "connections" ? "text-[var(--text-primary)] border-[var(--text-primary)]" : "bg-transparent text-[var(--text-muted)] border-transparent hover:text-[var(--text-primary)]")}
              >
                <Network className="w-3.5 h-3.5" /> Connections
              </button>

              <div className="ml-auto flex items-center gap-2">
                <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="bg-transparent border-b border-[var(--text-primary)] rounded-none px-3 py-1 text-xs text-[var(--text-primary)] focus:outline-none transition-colors appearance-none custom-select"
                >
                  {allCategories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>
            
            <div className="flex-1 p-6 relative">
              {activeView === "table" && (
                <ProjectTableView memories={filteredMemories} onSelect={setSelected} />
              )}
              {activeView === "board" && (
                <ProjectBoardView memories={filteredMemories} onSelect={setSelected} />
              )}
              {activeView === "connections" && (
                <ProjectConnections detail={detail} />
              )}
            </div>
          </div>
          
        </div>
      </div>

      {/* Slide-over Sidebar */}
      {selected && (
        <div className="w-[400px] shrink-0 border-l border-[var(--border)] bg-[var(--bg-primary)] z-20 h-full">
          <Sidebar node={selected} onClose={() => setSelected(null)} />
        </div>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-2 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors w-fit border-b border-transparent hover:border-[var(--accent)] rounded-none pb-0.5"
    >
      <ArrowLeft className="w-4 h-4" />
      Projects
    </Link>
  );
}

function ContextSection({ detail }: { detail: ProjectDetail }) {
  const [collapsed, setCollapsed] = useState(false);
  const groups = CONTEXT_TYPES.map((type) => ({ type, items: detail.context[type] ?? [] })).filter(
    (g) => g.items.length > 0,
  );

  if (groups.length === 0) {
    return (
      <div className="space-y-3">
        <h3 className="text-lg font-semibold tracking-tight">Context</h3>
        <p className="text-sm text-muted-foreground">No context items recorded for this project.</p>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold tracking-tight text-white">Project Context</h3>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-muted-foreground hover:text-white transition-colors p-1 rounded hover:bg-white/10"
          title={collapsed ? "Expand context" : "Collapse context"}
        >
          {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
      </div>
      
      {!collapsed && (
        <div className="space-y-4">
          {groups.map(({ type, items }) => (
            <div key={type} className="space-y-2">
              <div className="flex items-center gap-2 pb-1">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: nodeColor(type) }}
                />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                  {type}
                </span>
              </div>
              <ul className="flex flex-wrap gap-2">
                {items.map((item, idx) => (
                  <li
                    key={`${item.created_at}-${idx}`}
                    className="text-xs text-[var(--text-primary)] bg-transparent border border-[var(--border)] rounded-[12px] px-3 py-2 max-w-full leading-relaxed"
                  >
                    {item.content}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
