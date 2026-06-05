"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ProjectConnections from "@/components/ProjectConnections";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import type { ProjectDetail } from "@/lib/types";

export default function ProjectConnectionsPage() {
  const { name } = useParams<{ name: string }>();
  const projectName = decodeURIComponent(name);

  const [detail, setDetail] = useState<ProjectDetail | null>(null);
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
    return <div className="h-full overflow-y-auto p-6"><p className="text-sm text-destructive">Failed to load: {error}</p></div>;
  }

  if (!detail) {
    return (
      <div className="h-full overflow-y-auto p-6 space-y-4">
        <Skeleton className="h-8 w-64 rounded-lg bg-[var(--node-memory)] animate-pulse" />
        <Skeleton className="h-[500px] rounded-xl bg-[var(--node-memory)] animate-pulse" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-6">
        <header>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">Connections</h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Force-directed view of every relation in this project.</p>
        </header>
        <div className="border border-dashed border-[var(--border)] rounded-[12px] p-6 min-h-[500px]">
          <ProjectConnections detail={detail} />
        </div>
      </div>
    </div>
  );
}
