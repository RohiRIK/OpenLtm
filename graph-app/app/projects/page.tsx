"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { ProjectHealthScore, Stats, HealthData } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Folder } from "lucide-react";
import { BentoGrid } from "@/components/ui/bento-grid";
import ActivityHeatmap from "@/components/ActivityHeatmap";
import StaleMemoryAlert from "@/components/StaleMemoryAlert";

function lastCapture(project: ProjectHealthScore): string {
  if (!project.lastActivityAt) return "Never";
  const days = Math.floor((Date.now() - new Date(project.lastActivityAt).getTime()) / 86_400_000);
  if (days <= 0) return "Active today";
  if (days === 1) return "Active yesterday";
  return `${days}d ago`;
}

export default function ProjectsHome() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [projects, setProjects] = useState<ProjectHealthScore[] | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([api.stats(), api.projectHealth(), api.health()])
      .then(([s, p, h]) => {
        if (!alive) return;
        setStats(s);
        setProjects(p);
        setHealth(h);
      })
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  const projectItems = useMemo(() => {
    if (!projects) return [];
    return projects.map(p => ({
      title: p.project.split("/").pop() || p.project,
      description: `${p.memoryCount} memories · ${lastCapture(p)}`,
      meta: `${p.score}/100`,
      icon: <Folder className="w-4 h-4 text-blue-500" />,
      status: p.status === "healthy" ? "Healthy" : p.status === "needs_attention" ? "Warning" : "Critical",
      tags: [p.staleCount > 0 ? `${p.staleCount} stale` : "Up to date"],
      onClick: () => router.push(`/projects/${encodeURIComponent(p.project)}`),
    }));
  }, [projects, router]);

  const loading = !stats || !projects || !health;

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="mx-auto max-w-7xl px-6 py-8 space-y-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">Projects</h1>
          <p className="text-sm text-[var(--text-muted)]">Every registered knowledge base, with health, activity, and stale memory alerts.</p>
        </header>

        {error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>Failed to load: {error}</AlertDescription>
          </Alert>
        ) : loading ? (
          <div className="space-y-4">
            <Skeleton className="h-[120px] w-full rounded-xl" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Skeleton className="h-[200px] w-full rounded-xl" />
              <Skeleton className="h-[200px] w-full rounded-xl" />
              <Skeleton className="h-[200px] w-full rounded-xl" />
            </div>
          </div>
        ) : (
          <>
            <div className="border border-dashed border-[var(--border)] rounded-[12px] p-6 bg-[var(--bg-secondary)] flex justify-center">
              <ActivityHeatmap />
            </div>

            <div className="mt-8">
              <StaleMemoryAlert />
            </div>

            <div className="mt-12">
              <div className="flex items-center justify-between mb-6 px-4">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">All projects</h2>
                  <p className="text-xs text-[var(--text-muted)] mt-1">Click a card to open the project sub-shell.</p>
                </div>
                <span className="text-xs text-[var(--text-muted)] tabular-nums">{projects?.length ?? 0} total</span>
              </div>
              {projectItems.length > 0 ? (
                <BentoGrid items={projectItems} />
              ) : (
                <p className="text-sm text-[var(--text-muted)] px-4">No projects yet. Capture a memory and one will appear.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
