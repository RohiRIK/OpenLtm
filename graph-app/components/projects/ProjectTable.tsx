"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, FolderTree, Search } from "lucide-react";
import type { ProjectHealthScore, ProjectHealthStatus } from "@/lib/types";
import { Input } from "@/components/ui/input";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

type SortKey = "project" | "memoryCount" | "score" | "lastActivityAt";

const STATUS_LABEL: Record<ProjectHealthStatus, string> = {
  healthy: "Healthy",
  needs_attention: "Needs attention",
  neglected: "Neglected",
};

const STATUS_DOT: Record<ProjectHealthStatus, string> = {
  healthy: "bg-[var(--accent)]",
  needs_attention: "bg-amber-400",
  neglected: "bg-red-400",
};

function scoreColor(score: number): string {
  return score >= 70 ? "text-[var(--accent)]" : score >= 40 ? "text-amber-400" : "text-red-400";
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function shortName(name: string): string {
  return name.split("/").pop() || name;
}

const GRID = "grid grid-cols-[minmax(0,1fr)_4rem_8.5rem_7.5rem_5rem] items-center gap-4";

export default function ProjectTable({ projects }: { projects: ProjectHealthScore[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "score",
    dir: "desc",
  });

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = q ? projects.filter((p) => p.project.toLowerCase().includes(q)) : projects;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      if (sort.key === "project") {
        av = a.project.toLowerCase();
        bv = b.project.toLowerCase();
      } else if (sort.key === "lastActivityAt") {
        av = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
        bv = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
      } else {
        av = a[sort.key];
        bv = b[sort.key];
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [projects, filter, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" },
    );
  }

  function SortHead({ label, sortKey, align = "left" }: { label: string; sortKey: SortKey; align?: "left" | "right" }) {
    const active = sort.key === sortKey;
    return (
      <button
        onClick={() => toggleSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em] transition-colors",
          align === "right" && "justify-end",
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {label}
        {active &&
          (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    );
  }

  if (projects.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderTree />
          </EmptyMedia>
          <EmptyTitle>No projects yet</EmptyTitle>
          <EmptyDescription>
            Memories captured during your sessions will appear here, grouped by project.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Filter projects…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-8 pl-9 text-[13px]"
        />
        {filter && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground">
            {rows.length}
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className={cn(GRID, "border-b border-border bg-[var(--bg-secondary)] px-5 py-2")}>
          <SortHead label="Project" sortKey="project" />
          <div className="text-right">
            <SortHead label="Mem" sortKey="memoryCount" align="right" />
          </div>
          <SortHead label="Health" sortKey="score" />
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Status
          </span>
          <div className="text-right">
            <SortHead label="Active" sortKey="lastActivityAt" align="right" />
          </div>
        </div>

        <div className="divide-y divide-border">
          {rows.map((p) => (
            <button
              key={p.project}
              onClick={() => router.push(`/project/${encodeURIComponent(p.project)}`)}
              className={cn(GRID, "group w-full px-5 py-2 text-left transition-colors hover:bg-[var(--bg-tertiary)]")}
            >
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-[13px] font-medium text-foreground" title={p.project}>
                  {shortName(p.project)}
                </span>
                {p.staleCount > 0 && (
                  <span className="shrink-0 text-[10px] tabular-nums text-amber-400/70">
                    {p.staleCount} stale
                  </span>
                )}
              </div>

              <div className="text-right text-[13px] tabular-nums text-muted-foreground">
                {p.memoryCount}
              </div>

              <div className="flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${p.score}%`, opacity: 0.5 + (p.score / 100) * 0.5 }}
                  />
                </div>
                <span className={cn("w-6 text-right text-[11px] font-medium tabular-nums", scoreColor(p.score))}>
                  {p.score}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[p.status])} />
                <span className="truncate text-[11px] text-muted-foreground">{STATUS_LABEL[p.status]}</span>
              </div>

              <div className="text-right text-[11px] tabular-nums text-muted-foreground">
                {relativeTime(p.lastActivityAt)}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
