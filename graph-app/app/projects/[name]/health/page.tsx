"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { HeartPulse, Sparkles, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { ProjectDetail, ProjectHealthScore } from "@/lib/types";

interface HealthHistoryPoint {
  date: string;
  score: number;
}

export default function ProjectHealthPage() {
  const { name } = useParams<{ name: string }>();
  const projectName = decodeURIComponent(name);

  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [score, setScore] = useState<ProjectHealthScore | null>(null);
  const [history, setHistory] = useState<HealthHistoryPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([api.project(projectName), api.projectHealth(), api.healthHistory(projectName)])
      .then(([d, all, hist]) => {
        if (!alive) return;
        setDetail(d);
        setScore(all.find((p) => p.project === projectName) ?? null);
        setHistory(hist.points);
      })
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [projectName]);

  async function runJanitor() {
    setRunning(true);
    try {
      await api.runJanitor();
    } catch {
      // non-fatal; result will be polled
    } finally {
      setTimeout(() => setRunning(false), 1500);
    }
  }

  if (error) {
    return <div className="h-full overflow-y-auto p-6"><p className="text-sm text-destructive">Failed to load: {error}</p></div>;
  }

  if (!detail || !score) {
    return (
      <div className="h-full overflow-y-auto p-6 space-y-4">
        <Skeleton className="h-[200px] w-full rounded-xl bg-[var(--node-memory)] animate-pulse" />
        <Skeleton className="h-[300px] w-full rounded-xl bg-[var(--node-memory)] animate-pulse" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="mx-auto max-w-5xl px-6 py-6 space-y-6">
        <header className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)] flex items-center gap-2">
              <HeartPulse className="w-5 h-5" /> Health
            </h1>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Score, sub-metrics, and a 30-day history.</p>
          </div>
          <Button
            size="sm"
            onClick={() => void runJanitor()}
            disabled={running}
            className="bg-[var(--accent-blue)] text-[var(--accent-blue-foreground)] hover:opacity-90"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
            {running ? "Running…" : "Run Janitor"}
          </Button>
        </header>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-8 flex items-center gap-8">
          <div className="relative w-32 h-32 flex items-center justify-center">
            <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
              <circle cx="50" cy="50" r="44" fill="none" stroke="var(--border)" strokeWidth="6" />
              <circle
                cx="50" cy="50" r="44" fill="none"
                stroke="var(--accent-blue)" strokeWidth="6" strokeLinecap="round"
                strokeDasharray={`${(score.score / 100) * 276.5} 276.5`}
              />
            </svg>
            <span className="text-3xl font-semibold tabular-nums text-[var(--text-primary)]">{score.score}</span>
          </div>
          <div className="flex-1 grid grid-cols-2 gap-3">
            <SubMetric label="Freshness" value={score.metrics.memoryFreshness} />
            <SubMetric label="Confidence" value={score.metrics.avgConfidence} />
            <SubMetric label="Coverage" value={score.metrics.contextCoverage} />
            <SubMetric label="Activity" value={score.metrics.sessionActivity} />
          </div>
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Score history (30 days)</h2>
          <HealthSparkline points={history ?? []} />
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1">What to fix</h2>
          <p className="text-xs text-[var(--text-muted)] mb-4">Run the janitor or open individual stale memories.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <ActionRow
              title={`${score.staleCount} stale memories`}
              hint="Confirm, edit, or forget each one."
            />
            <ActionRow
              title={`${detail.relations.length} relations`}
              hint="Inspect for conflicting or redundant edges."
            />
            <ActionRow
              title={`${detail.memories.length} memories`}
              hint="Run the Janitor to re-embed and re-rank."
            />
            <ActionRow
              title="Open project settings"
              hint="Tune importance default, decay, and capture rules."
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function SubMetric({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-1">
        <span>{label}</span>
        <span className="tabular-nums text-[var(--text-primary)]">{pct}</span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
        <div
          className="h-full rounded-full bg-[var(--accent-blue)]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function HealthSparkline({ points }: { points: HealthHistoryPoint[] }) {
  if (points.length === 0) {
    return <p className="text-xs text-[var(--text-muted)]">No history yet — first janitor run will populate it.</p>;
  }
  const max = 100;
  const min = 0;
  const w = 600;
  const h = 80;
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const path = points
    .map((p, i) => {
      const x = i * step;
      const y = h - ((p.score - min) / (max - min)) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20" preserveAspectRatio="none">
      <path d={path} fill="none" stroke="var(--accent-blue)" strokeWidth="2" />
    </svg>
  );
}

function ActionRow({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg-primary)] p-3">
      <div className="text-sm font-medium text-[var(--text-primary)]">{title}</div>
      <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{hint}</div>
    </div>
  );
}
