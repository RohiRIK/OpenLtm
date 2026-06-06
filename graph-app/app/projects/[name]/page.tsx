"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import ProjectRelevance from "@/components/ProjectRelevance";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { nodeColor } from "@/lib/nodeColors";
import type { GraphNode, ProjectDetail } from "@/lib/types";

const CONTEXT_TYPES = ["goal", "decision", "gotcha", "progress"] as const;

function shortName(name: string): string {
  return name.split("/").pop() || name;
}

export default function ProjectOverviewPage() {
  const { name } = useParams<{ name: string }>();
  const projectName = decodeURIComponent(name);

  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.project(projectName)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [projectName]);

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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-[300px] rounded-xl bg-[var(--node-memory)] animate-pulse" />
          <Skeleton className="h-[300px] rounded-xl bg-[var(--node-memory)] animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden relative">
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="mx-auto max-w-7xl px-6 py-8 space-y-8">
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="border border-dashed border-[var(--border)] rounded-[12px] p-6">
              <ContextSection detail={detail} />
            </div>
            <div className="border border-dashed border-[var(--border)] rounded-[12px] p-6">
              <ProjectRelevance detail={detail} />
            </div>
          </div>

          <div className="border border-dashed border-[var(--border)] rounded-[12px] p-6">
            <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <li>
                <Link
                  href={`/projects/${encodeURIComponent(projectName)}/memories`}
                  className="text-[var(--accent)] hover:underline"
                >
                  Browse all {detail.memories.length} memories →
                </Link>
              </li>
              <li>
                <Link
                  href={`/projects/${encodeURIComponent(projectName)}/connections`}
                  className="text-[var(--accent)] hover:underline"
                >
                  {detail.relations.length === 1 ? "View 1 connection" : `View ${detail.relations.length} connections`} →
                </Link>
              </li>
              <li>
                <Link
                  href={`/projects/${encodeURIComponent(projectName)}/timeline`}
                  className="text-[var(--accent)] hover:underline"
                >
                  Timeline →
                </Link>
              </li>
              <li>
                <Link
                  href={`/projects/${encodeURIComponent(projectName)}/health`}
                  className="text-[var(--accent)] hover:underline"
                >
                  Health →
                </Link>
              </li>
            </ul>
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

function BackLink() {
  return (
    <Link
      href="/projects"
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
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: nodeColor(type) }} />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{type}</span>
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
