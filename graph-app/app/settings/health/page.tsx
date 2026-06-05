"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Loader2, Sparkles, ArchiveRestore } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { JanitorRunResult, JanitorStatus } from "@/lib/types";
import { AnimatedStatusBadge } from "@/components/ui/animated-status-badge";
import { RecoverDrawer } from "@/components/settings/RecoverDrawer";

function formatKeeperResult(r: JanitorRunResult): string {
  return (
    `Done in ${r.durationMs}ms: ${r.embed.embedded} embedded, ` +
    `${r.decay.decayed} decayed (${r.decay.deprecated} deprecated), ` +
    `${r.promote.promoted} promoted, ${r.dedup.candidatesFound} dedup candidates` +
    (r.errors.length > 0 ? ` | Errors: ${r.errors.join("; ")}` : "")
  );
}

export default function HealthSection() {
  const [status, setStatus] = useState<JanitorStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [recoverOpen, setRecoverOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    api.janitorStatus()
      .then((s) => alive && setStatus(s))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }

  async function runJanitor() {
    setRunning(true);
    setResult(null);
    try {
      await api.runJanitor();
    } catch (e) {
      setResult(`Error: ${String(e)}`);
      setRunning(false);
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const s = await api.janitorStatus();
        if (!s.running) {
          stopPolling();
          setRunning(false);
          setStatus({ running: false, lastRun: s.lastRun });
          if (s.lastResult) setResult(formatKeeperResult(s.lastResult));
        }
      } catch {
        // ignore transient poll errors
      }
    }, 2000);
    timeoutRef.current = setTimeout(() => {
      stopPolling();
      setRunning(false);
      setResult("Timed out waiting for Memory Keeper to complete.");
    }, 60_000);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Memory Keeper</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Decay unused memories, promote high-confidence ones, dedup, and embed new content.
            </p>
            {status?.lastRun && (
              <p className="text-[10px] text-[var(--text-muted)] mt-2">
                Last run: {new Date(status.lastRun).toLocaleString()}
              </p>
            )}
          </div>
          {running ? (
            <AnimatedStatusBadge status="verifying" label="Running…" />
          ) : (
            <Button
              size="sm"
              onClick={() => void runJanitor()}
              className="bg-[var(--accent-blue)] text-[var(--accent-blue-foreground)] hover:opacity-90"
            >
              {running ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
              Run Janitor
            </Button>
          )}
        </div>
        {result && (
          <div className="mt-4 text-xs px-3 py-2 rounded-lg bg-black/40 border border-[var(--border)] text-[var(--text-muted)] font-mono">
            {result}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <ArchiveRestore className="w-4 h-4" /> Recover
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Restore memories soft-deleted in the last 30 days.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRecoverOpen(true)}
          className="border-[var(--accent-blue)] text-[var(--accent-blue)] hover:bg-[var(--accent-blue)] hover:text-[var(--accent-blue-foreground)]"
        >
          <ArchiveRestore className="w-3.5 h-3.5 mr-1" /> Open
        </Button>
      </section>

      <RecoverDrawer open={recoverOpen} onClose={() => setRecoverOpen(false)} />
    </div>
  );
}
