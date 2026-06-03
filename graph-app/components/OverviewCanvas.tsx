"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle, AlertCircle, FolderGit2 } from "lucide-react";
import { BentoGrid, type BentoItem } from "@/components/ui/bento-grid";
import ExplainBlock from "@/components/ExplainBlock";
import { api } from "@/lib/api";
import type { ProjectHealthScore, ProjectHealthStatus } from "@/lib/types";

const STATUS_META: Record<
  ProjectHealthStatus,
  { label: string; icon: (cls: string) => React.ReactNode }
> = {
  healthy: { label: "Healthy", icon: (c) => <CheckCircle2 className={c} /> },
  needs_attention: { label: "Needs attention", icon: (c) => <AlertTriangle className={c} /> },
  neglected: { label: "Neglected", icon: (c) => <AlertCircle className={c} /> },
};

const STATUS_COLOR: Record<ProjectHealthStatus, string> = {
  healthy: "w-4 h-4 text-emerald-500",
  needs_attention: "w-4 h-4 text-amber-500",
  neglected: "w-4 h-4 text-red-500",
};

function lastActive(iso: string | null): string {
  if (!iso) return "never active";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "active today";
  if (days === 1) return "active yesterday";
  if (days < 30) return `active ${days}d ago`;
  return `idle ${Math.floor(days / 30)}mo`;
}

interface OverviewCanvasProps {
  onOpenProject: (name: string) => void;
}

export default function OverviewCanvas({ onOpenProject }: OverviewCanvasProps) {
  const [projects, setProjects] = useState<ProjectHealthScore[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .projectHealth()
      .then((p) => setProjects([...p].sort((a, b) => b.score - a.score)))
      .catch((e) => setError(e.message ?? "Failed to load projects"));
  }, []);

  const items = useMemo<BentoItem[]>(() => {
    if (!projects) return [];
    return projects.map((p) => {
      const meta = STATUS_META[p.status];
      return {
        title: p.project,
        meta: `${p.memoryCount} mem · ${p.staleCount} stale`,
        description: `${p.score}/100 health · ${lastActive(p.lastActivityAt)}`,
        icon: meta.icon(STATUS_COLOR[p.status]),
        status: meta.label,
        colSpan: p.score >= 70 ? 2 : 1,
        hasPersistentHover: p.status === "neglected",
        onClick: () => onOpenProject(p.project),
      };
    });
  }, [projects, onOpenProject]);

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-7xl mx-auto px-4 pt-4">
        <ExplainBlock title="What am I looking at?">
          Each tile is a project this assistant remembers. The color and label show how
          healthy its memory is — green is well-tended, red has gone stale. Bigger tiles are
          the projects with the most momentum. Click any tile to open its full story.
        </ExplainBlock>
      </div>

      {error ? (
        <div className="flex items-center justify-center h-40 text-sm text-[var(--text-muted)]">
          {error} — is the graph server running?
        </div>
      ) : !projects ? (
        <div className="flex items-center justify-center h-40 text-sm text-[var(--text-muted)]">
          <FolderGit2 className="w-4 h-4 mr-2 animate-pulse" /> Loading projects…
        </div>
      ) : projects.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-sm text-[var(--text-muted)]">
          No projects yet.
        </div>
      ) : (
        <BentoGrid items={items} />
      )}
    </div>
  );
}
