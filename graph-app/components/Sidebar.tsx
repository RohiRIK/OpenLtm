"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { nodeColor } from "@/lib/nodeColors";
import { truncate } from "@/lib/stringUtils";
import type { GraphNode, MemoryDetail, ProjectNode, ContextNode, ReasoningResult, SemanticResult } from "@/lib/types";

import { MemoryPanel } from "./inspector/MemoryPanel";
import { ProjectPanel } from "./inspector/ProjectPanel";
import { ContextPanel } from "./inspector/ContextPanel";
import { ReasoningPanel } from "./inspector/ReasoningPanel";
import InspectorContextMenu from "./InspectorContextMenu";

interface Props {
  node: GraphNode | null;
  onClose: () => void;
  onRelationClick?: (id: number) => void;
  nodeLabelById?: (id: number) => string | undefined;
  onReasoningResult?: (ids: Set<number>, conflictIds: Set<number>, reinforceIds: Set<number>) => void;
  onUpdated?: () => void;
}

export default function Sidebar({ node, onClose, onRelationClick, nodeLabelById, onReasoningResult, onUpdated }: Props) {
  const [detail, setDetail] = useState<MemoryDetail | null>(null);
  const [reasoning, setReasoning] = useState<ReasoningResult | null>(null);
  const [reasoningLoading, setReasoningLoading] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [relatedMemories, setRelatedMemories] = useState<SemanticResult[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);

  useEffect(() => {
    setDetail(null);
    setReasoning(null);
    setShowReasoning(false);
    setRelatedMemories([]);
    setRelatedLoading(false);
    if (!node || "is_project" in node || "is_context" in node) return;
    const controller = new AbortController();
    api.memory(node.id)
      .then(d => { if (!controller.signal.aborted) setDetail(d); })
      .catch(() => { /* ignore */ });

    // Fetch related memories via semantic search
    setRelatedLoading(true);
    api.semanticSearch(node.content, 5, 0.5)
      .then(results => {
        if (!controller.signal.aborted) {
          // Filter out the current node from results
          setRelatedMemories(results.filter(r => r.id !== node.id));
        }
      })
      .catch(() => { /* ignore */ })
      .finally(() => {
        if (!controller.signal.aborted) setRelatedLoading(false);
      });

    return () => controller.abort();
  }, [node]);

  function handleReason() {
    if (!node || "is_project" in node || "is_context" in node) return;
    if (reasoning) { setShowReasoning(v => !v); return; }
    setReasoningLoading(true);
    api.reasoning(node.id, 2)
      .then(r => {
        setReasoning(r);
        setShowReasoning(true);
        setReasoningLoading(false);
        const chainIds = new Set(r.chain.map(n => n.id));
        const conflictIds = new Set<number>();
        const reinforceIds = new Set<number>();
        for (const c of r.conflicts) { conflictIds.add(c.a.id); conflictIds.add(c.b.id); }
        for (const rc of r.reinforcements) { reinforceIds.add(rc.a.id); reinforceIds.add(rc.b.id); }
        onReasoningResult?.(chainIds, conflictIds, reinforceIds);
      })
      .catch(() => setReasoningLoading(false));
  }

  async function handleDelete() {
    if (!node || "is_project" in node) return;
    const isCtx = "is_context" in node;
    const label = node.label.substring(0, 60);
    if (!confirm(`Delete this ${isCtx ? "context item" : "memory"}?\n\n"${label}"\n\nThis cannot be undone.`)) return;
    setDeleting(true);
    try {
      if (isCtx) {
        await api.deleteContextItem(node.id);
      } else {
        await api.deleteMemory(node.id);
      }
      onClose();
      onUpdated?.();
    } finally {
      setDeleting(false);
    }
  }

  const isProject = node ? "is_project" in node : false;
  const isContext = node ? "is_context" in node : false;
  const isMemory = node ? !isProject && !isContext : false;

  const typeLabel = isProject ? "Project" : isContext ? "Context" : "Memory";
  const accentColor = node
    ? isProject ? nodeColor("project") : isContext ? "#6b7280" : nodeColor((node as { category: string }).category)
    : "#6b7280";

  return (
    <div
      className={`transition-all duration-300 ease-out overflow-hidden shrink-0 ${node ? "w-[360px] opacity-100 translate-x-0" : "w-0 opacity-0 translate-x-4"}`}
      data-testid="sidebar"
    >
      {node && (
        <div className="w-[360px] rounded-2xl border border-white/10 bg-black/40 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-xl flex flex-col overflow-hidden h-full ring-1 ring-white/5">
          <InspectorContextMenu node={node} />
          {/* Header */}
          <div
            className="px-5 pt-5 pb-4 border-b border-white/10 relative overflow-hidden"
            style={{ background: `linear-gradient(to bottom, ${accentColor}0d, transparent)` }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div
                  className="text-xs font-semibold uppercase tracking-widest mb-1"
                  style={{ color: accentColor }}
                >
                  {typeLabel}
                </div>
                <div className="text-sm font-semibold text-foreground leading-snug truncate" title={node.label}>
                  {node.label}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {isMemory && (
                  <button
                    onClick={handleReason}
                    disabled={reasoningLoading}
                    className={`h-6 px-2 text-xs rounded-md border transition-colors font-medium focus:outline-none focus:ring-2 focus:ring-ring ${
                      showReasoning
                        ? "bg-yellow-900/40 border-yellow-700/60 text-yellow-400"
                        : "bg-muted border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/50"
                    } disabled:opacity-50`}
                    title="Traverse graph and show reasoning chain"
                  >
                    {reasoningLoading ? "…" : "Reason"}
                  </button>
                )}
                {(isMemory || isContext) && (
                  <button
                    onClick={() => void handleDelete()}
                    disabled={deleting}
                    className="h-6 px-2 text-xs rounded-md border border-transparent text-muted-foreground hover:text-red-400 hover:border-red-800/50 hover:bg-red-900/20 transition-colors disabled:opacity-50 font-medium focus:outline-none focus:ring-2 focus:ring-ring"
                    aria-label="Delete"
                    title={isContext ? "Delete context item" : "Delete memory"}
                  >
                    {deleting ? "Deleting…" : "Delete"}
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="w-7 h-7 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors mt-0.5 focus:outline-none focus:ring-2 focus:ring-white/20"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
            {isProject && <ProjectPanel node={node as ProjectNode} />}
            {isContext && <ContextPanel node={node as ContextNode} />}
            {isMemory && (
              <>
                {showReasoning && reasoning ? (
                  <ReasoningPanel result={reasoning} onNodeClick={onRelationClick} />
                ) : detail ? (
                  <MemoryPanel
                    node={detail}
                    onRelationClick={onRelationClick}
                    nodeLabelById={nodeLabelById}
                    onUpdated={() => {
                      onUpdated?.();
                      api.memory(node.id).then(setDetail).catch(() => { /* ignore */ });
                    }}
                    onClose={onClose}
                  />
                ) : (
                  <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
                    Loading…
                  </div>
                )}

                {/* Related Memories */}
                <div className="mt-6 pt-4 border-t border-dashed border-[var(--border)]">
                  <h4 className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-primary)] mb-3">
                    Related Memories
                  </h4>
                  {relatedLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <svg className="animate-spin w-4 h-4 text-[var(--text-muted)]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    </div>
                  ) : relatedMemories.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)]">No related memories found.</p>
                  ) : (
                    <div className="flex flex-col">
                      {relatedMemories.map((rm, i) => (
                        <button
                          key={rm.id}
                          onClick={() => onRelationClick?.(rm.id)}
                          className={`w-full text-left px-2 py-2.5 flex items-start gap-2 hover:bg-[var(--node-memory)] transition-colors ${
                            i > 0 ? "border-t border-dashed border-[var(--border)]" : ""
                          }`}
                        >
                          <span
                            className="w-2 h-2 rounded-full shrink-0 mt-1"
                            style={{ backgroundColor: nodeColor(rm.category) }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                              {truncate(rm.content, 80)}
                            </p>
                          </div>
                          <span className="text-[10px] text-[var(--accent)] font-mono shrink-0 mt-0.5">
                            {Math.round(rm.similarity * 100)}%
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
