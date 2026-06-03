"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ExplainBlock from "@/components/ExplainBlock";
import { api } from "@/lib/api";
import type { ProjectHealthScore, ProjectHealthStatus } from "@/lib/types";

const STATUS_META: Record<
  ProjectHealthStatus,
  { label: string; icon: React.ReactNode; variant: "default" | "secondary" | "destructive" }
> = {
  healthy: { label: "Healthy", icon: <CheckCircle2 className="w-4 h-4 text-emerald-500" />, variant: "default" },
  needs_attention: { label: "Needs attention", icon: <AlertTriangle className="w-4 h-4 text-amber-500" />, variant: "secondary" },
  neglected: { label: "Neglected", icon: <AlertCircle className="w-4 h-4 text-red-500" />, variant: "destructive" },
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

interface HealthViewProps {
  onOpenProject: (name: string) => void;
}

export default function HealthView({ onOpenProject }: HealthViewProps) {
  const [projects, setProjects] = useState<ProjectHealthScore[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .projectHealth()
      .then((p) => setProjects([...p].sort((a, b) => b.score - a.score)))
      .catch((e) => setError(e.message ?? "Failed to load health scores"));
  }, []);

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl mx-auto px-4 py-4">
        <ExplainBlock title="How is health scored?">
          Each project earns a 0–100 score from four signals: how fresh its memories are (35%),
          how confident they are (25%), how much context is captured — goals, decisions, gotchas,
          progress (20%), and how recently it was active (20%). Higher is healthier.
        </ExplainBlock>

        {error ? (
          <div className="text-sm text-[var(--text-muted)] py-8 text-center">
            {error} — is the graph server running?
          </div>
        ) : !projects ? (
          <div className="text-sm text-[var(--text-muted)] py-8 text-center">Loading health scores…</div>
        ) : projects.length === 0 ? (
          <div className="text-sm text-[var(--text-muted)] py-8 text-center">No projects yet.</div>
        ) : (
          <div className="space-y-2">
            {projects.map((p) => {
              const meta = STATUS_META[p.status];
              return (
                <Card
                  key={p.project}
                  onClick={() => onOpenProject(p.project)}
                  className="cursor-pointer transition-colors hover:bg-[var(--bg-secondary)]"
                >
                  <CardContent className="flex items-center gap-4 py-3">
                    <div className="text-2xl font-semibold tabular-nums w-14 text-center">{p.score}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {meta.icon}
                        <span className="font-medium truncate">{p.project}</span>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                      </div>
                      <div className="text-xs text-[var(--text-muted)] mt-1">
                        {p.memoryCount} memories · {p.staleCount} stale · {p.contextItemCount}/4 context types
                      </div>
                    </div>
                    <div className="hidden sm:flex flex-col gap-0.5 text-[11px] text-[var(--text-muted)] text-right">
                      <span>fresh {pct(p.metrics.memoryFreshness)}</span>
                      <span>conf {pct(p.metrics.avgConfidence)}</span>
                      <span>coverage {pct(p.metrics.contextCoverage)}</span>
                      <span>activity {pct(p.metrics.sessionActivity)}</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
