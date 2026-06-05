"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  ArrowRight,
  Scale,
  Layers,
  Link2,
  Plug,
  Network,
  Replace,
  Info,
} from "lucide-react";
import ExplainBlock from "@/components/ExplainBlock";
import { cn } from "@/lib/utils";
import type { ProjectDetail, GraphData, GraphLink, GraphNode } from "@/lib/types";

const Graph = dynamic(() => import("@/components/Graph"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">Loading map…</div>
  ),
});

interface RelationMeta {
  type: string;
  label: string;
  description: string;
  color: string;
  icon: React.ElementType;
}

const RELATIONS: RelationMeta[] = [
  { type: "supports",     label: "Supports",     description: "A backs B's claim",         color: "#10b981", icon: ArrowRight },
  { type: "contradicts",  label: "Contradicts",  description: "A conflicts with B",         color: "#f43f5e", icon: Scale },
  { type: "refines",      label: "Refines",      description: "A is a sharper version of B", color: "#5266eb", icon: Layers },
  { type: "depends_on",   label: "Depends on",   description: "A requires B to make sense", color: "#f59e0b", icon: Plug },
  { type: "related_to",   label: "Related to",   description: "General association",        color: "#8b5cf6", icon: Network },
  { type: "supersedes",   label: "Supersedes",   description: "A replaces the older B",     color: "#64748b", icon: Replace },
];

function endpointId(v: GraphLink["source"]): number {
  return typeof v === "number" ? v : (v as GraphNode).id;
}

interface ProjectConnectionsProps {
  detail: ProjectDetail;
  onSelect?: (node: GraphNode) => void;
}

export default function ProjectConnections({ detail, onSelect }: ProjectConnectionsProps) {
  const [enabled, setEnabled] = useState<Set<string>>(
    () => new Set(RELATIONS.map((r) => r.type))
  );
  const [legendOpen, setLegendOpen] = useState(true);
  const [whyOpen, setWhyOpen] = useState(true);

  const labelById = useMemo(() => {
    const map = new Map<number, string>();
    for (const m of detail.memories) map.set(m.id, m.label || m.content.slice(0, 40));
    for (const c of detail.context_items) map.set(c.id, c.label || c.content.slice(0, 40));
    return map;
  }, [detail.memories, detail.context_items]);

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const l of detail.relations) c.set(l.type, (c.get(l.type) ?? 0) + 1);
    return c;
  }, [detail.relations]);

  const graphData = useMemo<GraphData>(() => {
    const nodes = [...detail.memories, ...detail.context_items];
    const nodeIds = new Set(nodes.map((n) => n.id));
    const links = detail.relations
      .filter((l) => enabled.has(l.type))
      .filter((l) => nodeIds.has(endpointId(l.source)) && nodeIds.has(endpointId(l.target)));
    return { nodes, links };
  }, [detail.memories, detail.context_items, detail.relations, enabled]);

  function toggle(type: string) {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  return (
    <section className="flex flex-col h-full">
      <header className="mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Link2 className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          Connections
        </h3>
        <p className="text-[10px] text-[var(--text-muted)] mt-0.5 tabular-nums">
          {detail.relations.length} link{detail.relations.length === 1 ? "" : "s"} · {detail.memories.length + detail.context_items.length} node{(detail.memories.length + detail.context_items.length) === 1 ? "" : "s"}
        </p>
      </header>

      {detail.relations.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">No connections recorded yet.</p>
      ) : (
        <>
          {whyOpen && (
            <div className="mb-3">
              <ExplainBlock title="Why this exists">
                The relationship map shows how memories in this project support, contradict,
                refine, or depend on each other. Click a relation type below to filter the
                graph; click a node to open it in the inspector.
                <button
                  type="button"
                  onClick={() => setWhyOpen(false)}
                  className="ml-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] underline-offset-2 hover:underline"
                >
                  dismiss
                </button>
              </ExplainBlock>
            </div>
          )}

          <div className="flex items-center gap-1.5 flex-wrap mb-3">
            {RELATIONS.map((r) => {
              const active = enabled.has(r.type);
              const count = counts.get(r.type) ?? 0;
              const Icon = r.icon;
              return (
                <button
                  key={r.type}
                  type="button"
                  onClick={() => toggle(r.type)}
                  className={cn(
                    "h-7 inline-flex items-center gap-1.5 px-2.5 rounded-full border text-[11px] font-medium transition-colors tabular-nums",
                    active
                      ? "text-[var(--text-primary)]"
                      : "text-[var(--text-muted)] opacity-50 hover:opacity-80"
                  )}
                  style={{
                    borderColor: active ? r.color : "var(--border)",
                    backgroundColor: active ? `${r.color}10` : "transparent",
                  }}
                  title={`${r.label}: ${r.description}`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: active ? r.color : "var(--text-muted)" }}
                  />
                  <Icon className="w-3 h-3" />
                  {r.label}
                  <span className="text-[10px] text-[var(--text-muted)]">{count}</span>
                </button>
              );
            })}
          </div>

          <div className="relative flex-1 min-h-[500px] rounded-lg border border-[var(--border)] overflow-hidden">
            <Graph data={graphData} activeProject={detail.name} onNodeClick={onSelect} />

            {legendOpen && (
              <div className="absolute bottom-3 right-3 w-64 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)]/90 backdrop-blur shadow-lg p-3 z-10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    Relation legend
                  </span>
                  <button
                    type="button"
                    onClick={() => setLegendOpen(false)}
                    className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    aria-label="Hide legend"
                  >
                    ×
                  </button>
                </div>
                <ul className="space-y-1.5">
                  {RELATIONS.map((r) => (
                    <li key={r.type} className="flex items-start gap-2 text-[11px]">
                      <span
                        className="mt-1 w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: r.color }}
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-[var(--text-primary)]">{r.label}</div>
                        <div className="text-[10px] text-[var(--text-muted)] leading-tight">
                          {r.description}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!legendOpen && (
              <button
                type="button"
                onClick={() => setLegendOpen(true)}
                className="absolute bottom-3 right-3 h-8 w-8 grid place-items-center rounded-lg border border-[var(--border)] bg-[var(--bg-primary)]/90 backdrop-blur shadow-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] z-10"
                aria-label="Show legend"
                title="Show legend"
              >
                <Info className="w-4 h-4" />
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
