"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { nodeColor } from "@/lib/nodeColors";
import type { GraphNode } from "@/lib/types";

interface StaleMemory {
  id: number;
  content: string;
  category: string;
  confidence: number;
  project_scope: string | null;
}

export default function StaleMemoryAlert() {
  const [stale, setStale] = useState<StaleMemory[] | null>(null);

  useEffect(() => {
    let alive = true;
    api.graph().then(({ nodes }) => {
      if (!alive) return;
      const atRisk: StaleMemory[] = [];
      for (const node of nodes) {
        // Skip project nodes
        if ("is_project" in node && node.is_project) continue;
        if (node.confidence < 0.3) {
          atRisk.push({
            id: node.id,
            content: node.content,
            category: node.category,
            confidence: node.confidence,
            project_scope: node.project_scope,
          });
        }
      }
      // Sort by confidence ascending (worst first)
      atRisk.sort((a, b) => a.confidence - b.confidence);
      setStale(atRisk);
    }).catch(() => {
      if (alive) setStale([]);
    });
    return () => { alive = false; };
  }, []);

  // Don't render if loading or no stale memories
  if (stale === null || stale.length === 0) return null;

  return (
    <div className="border border-dashed border-[var(--border)] rounded-[12px] p-5 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-[var(--accent)]" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">Memories at Risk</h3>
        <span className="ml-auto text-[10px] text-[var(--text-muted)] border border-[var(--border)] px-1.5 py-0.5 rounded-full font-mono">
          {stale.length}
        </span>
      </div>

      {/* List */}
      <ul className="space-y-2">
        {stale.slice(0, 10).map((m) => (
          <li key={m.id} className="flex items-center gap-2.5 group">
            {/* Category dot */}
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: nodeColor(m.category) }}
            />
            {/* Content preview */}
            <span className="text-xs text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors truncate flex-1 min-w-0">
              {m.content.length > 60 ? m.content.slice(0, 60) + "…" : m.content}
            </span>
            {/* Project name */}
            {m.project_scope && (
              <span className="text-[10px] text-[var(--text-muted)] shrink-0 border border-[var(--border)] px-1.5 py-0.5 rounded-full">
                {m.project_scope.split("/").pop()}
              </span>
            )}
            {/* Confidence percentage */}
            <span className="text-[10px] text-[var(--accent)] font-mono shrink-0">
              {Math.round(m.confidence * 100)}%
            </span>
          </li>
        ))}
      </ul>

      {stale.length > 10 && (
        <p className="text-[10px] text-[var(--text-muted)]">
          +{stale.length - 10} more at risk
        </p>
      )}
    </div>
  );
}
