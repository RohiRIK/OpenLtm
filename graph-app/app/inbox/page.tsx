"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Inbox, Check, X } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";
import type { PendingMemory } from "@/lib/types";

function shortName(name: string): string {
  return name.split("/").pop() || name;
}

export default function PendingPage() {
  const [pending, setPending] = useState<PendingMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);

  const loadPending = useCallback(async () => {
    setLoading(true);
    try {
      setPending(await api.pending());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  async function handleApprove(id: number) {
    setBusy(id);
    try {
      await api.approveMemory(id);
      setPending((prev) => prev.filter((m) => m.id !== id));
    } finally {
      setBusy(null);
    }
  }

  async function handleReject(id: number) {
    setBusy(id);
    try {
      await api.deleteMemory(id);
      setPending((prev) => prev.filter((m) => m.id !== id));
    } finally {
      setBusy(null);
    }
  }

  async function handleApproveAll() {
    setBusy(-1);
    try {
      await Promise.all(pending.map((m) => api.approveMemory(m.id)));
      setPending([]);
    } finally {
      setBusy(null);
    }
  }

  const dedupCandidates = pending.filter((m) => m.source?.startsWith("dedup:"));

  async function handleMergeAll() {
    setBusy(-2);
    try {
      await api.mergeAll(0.95);
      await loadPending();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold">Inbox</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Memories Claude wants to keep — approve the good ones, reject noise.
          </p>
        </div>
        <div className="flex gap-2">
          {dedupCandidates.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => void handleMergeAll()} disabled={busy !== null}>
              Merge duplicates (≥95%)
            </Button>
          )}
          {pending.length > 1 && (
            <Button size="sm" onClick={() => void handleApproveAll()} disabled={busy !== null}>
              Approve all
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : pending.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Inbox />
            </EmptyMedia>
            <EmptyTitle>Inbox zero</EmptyTitle>
            <EmptyDescription>
              No pending memories. Run the janitor to auto-promote decisions and gotchas.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline" size="sm">
              <Link href="/settings">Go to Settings</Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-2">
          {pending.map((mem) => (
            <div key={mem.id} className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-md p-4 flex items-start justify-between gap-4 transition-colors hover:bg-white/10">
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" className="font-normal bg-white/10 text-white border-white/10">
                    {mem.category}
                  </Badge>
                  <span className="text-xs text-muted-foreground">imp {mem.importance}</span>
                  {mem.project_scope && (
                    <span className="text-xs text-muted-foreground">
                      {shortName(mem.project_scope)}
                    </span>
                  )}
                  {mem.source && (
                    <span className="text-xs text-muted-foreground italic">via {mem.source}</span>
                  )}
                </div>
                <p className="text-sm leading-relaxed text-foreground">{mem.content}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(mem.created_at).toLocaleString()}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  size="icon"
                  className="w-8 h-8 rounded-full bg-primary/20 text-primary hover:bg-primary/40 border border-primary/20"
                  onClick={() => void handleApprove(mem.id)}
                  disabled={busy !== null}
                  title="Approve — promote to active memory"
                >
                  <Check className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8 rounded-full text-muted-foreground hover:text-red-400 hover:bg-red-400/20"
                  onClick={() => void handleReject(mem.id)}
                  disabled={busy !== null}
                  title="Reject — delete and reset context item"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
