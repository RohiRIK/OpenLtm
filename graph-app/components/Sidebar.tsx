"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { categoryBadgeColors } from "@/lib/categoryColors";
import { nodeColor } from "@/lib/nodeColors";
import ImportanceStars from "@/components/ImportanceStars";
import type { ContextNode, CtxItem, GraphNode, MemoryDetail, ProjectNode, ReasoningResult } from "@/lib/types";

interface Props {
  node: GraphNode | null;
  onClose: () => void;
  onRelationClick?: (id: number) => void;
  nodeLabelById?: (id: number) => string | undefined;
  onReasoningResult?: (ids: Set<number>, conflictIds: Set<number>, reinforceIds: Set<number>) => void;
  onUpdated?: () => void;
}

// ── Shared micro-components ──────────────────────────────────────────────────


function ConfidenceBar({ v }: { v: number }) {
  const pct = Math.round(v * 100);
  const color = pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-800 rounded-full h-1.5 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-gray-500 font-mono w-7 text-right">{pct}%</span>
    </div>
  );
}

function TagChip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 bg-gray-800 border border-gray-700 text-gray-300 text-[10px] px-2 py-0.5 rounded-full">
      {name}
    </span>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const colors = categoryBadgeColors[category] ?? "bg-gray-800 text-gray-400 border-gray-700";
  return (
    <span className={`inline-block px-2 py-0.5 text-[10px] font-medium rounded border capitalize ${colors}`}>
      {category}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[9px] font-semibold uppercase tracking-widest text-gray-600 mb-1.5">
      {children}
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 py-1.5 border-b border-gray-800/60 last:border-0">
      <span className="text-[10px] text-gray-600 shrink-0">{label}</span>
      <span className="text-[10px] text-gray-400 text-right">{children}</span>
    </div>
  );
}

function RelativeTime({ iso }: { iso: string }) {
  const date = new Date(iso);
  const now = Date.now();
  const diff = now - date.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return <span title={date.toLocaleString()}>today</span>;
  if (days === 1) return <span title={date.toLocaleString()}>yesterday</span>;
  if (days < 30) return <span title={date.toLocaleString()}>{days}d ago</span>;
  if (days < 365) return <span title={date.toLocaleString()}>{Math.floor(days / 30)}mo ago</span>;
  return <span title={date.toLocaleString()}>{Math.floor(days / 365)}y ago</span>;
}

// ── Reasoning panel ──────────────────────────────────────────────────────────

function ReasoningPanel({ result, onNodeClick }: {
  result: ReasoningResult;
  onNodeClick?: (id: number) => void;
}) {
  if (result.chain.length === 0) {
    return <p className="text-xs text-gray-600 italic text-center py-4">No connected memories found.</p>;
  }

  return (
    <div className="space-y-4">
      {/* Chain */}
      <div>
        <SectionLabel>Reasoning Chain ({result.chain.length} nodes)</SectionLabel>
        <div className="space-y-1">
          {result.chain.map((n, i) => (
            <button
              key={n.id}
              onClick={() => onNodeClick?.(n.id)}
              className="w-full flex items-center gap-2 text-[11px] bg-yellow-900/10 border border-yellow-800/30 rounded px-2.5 py-1.5 hover:border-yellow-700/50 hover:bg-yellow-900/20 transition-colors cursor-pointer text-left"
            >
              <span className="text-yellow-600 font-mono shrink-0 text-[9px]">{i + 1}</span>
              <span className="text-gray-300 truncate flex-1">{n.content.substring(0, 60)}</span>
              <span className="text-gray-600 font-mono shrink-0">#{n.id}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Conflicts */}
      {result.conflicts.length > 0 && (
        <div>
          <SectionLabel>Conflicts ({result.conflicts.length})</SectionLabel>
          <div className="space-y-1">
            {result.conflicts.map((p) => (
              <div key={`${p.a.id}-${p.b.id}-${p.type}`} className="text-[10px] bg-red-900/10 border border-red-800/30 rounded px-2.5 py-1.5">
                <span className="text-red-400">↔</span>
                <span className="text-gray-400 ml-1 italic">{p.type}</span>
                <div className="text-gray-400 mt-0.5 truncate">"{p.a.content.substring(0, 40)}"</div>
                <div className="text-gray-500 truncate">vs "{p.b.content.substring(0, 40)}"</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reinforcements */}
      {result.reinforcements.length > 0 && (
        <div>
          <SectionLabel>Reinforcements ({result.reinforcements.length})</SectionLabel>
          <div className="space-y-1">
            {result.reinforcements.map((p) => (
              <div key={`${p.a.id}-${p.b.id}-${p.type}`} className="text-[10px] bg-green-900/10 border border-green-800/30 rounded px-2.5 py-1.5">
                <span className="text-green-400">↑</span>
                <span className="text-gray-400 ml-1 italic">{p.type}</span>
                <div className="text-gray-400 mt-0.5 truncate">"{p.a.content.substring(0, 40)}"</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Inferred edges */}
      {result.inferred.length > 0 && (
        <div>
          <SectionLabel>Inferred Edges ({result.inferred.length})</SectionLabel>
          <div className="space-y-1">
            {result.inferred.map((e) => (
              <div key={`${e.a.id}-${e.b.id}`} className="text-[10px] bg-violet-900/10 border border-violet-800/30 rounded px-2.5 py-1.5">
                <span className="text-violet-400">≈</span>
                <span className="text-gray-400 ml-1 italic">{e.type}</span>
                {e.persisted && <span className="ml-1 text-[9px] text-violet-600">saved</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Memory panel ─────────────────────────────────────────────────────────────

function MemoryPanel({ node, onRelationClick, nodeLabelById, onUpdated, onClose }: {
  node: MemoryDetail;
  onRelationClick?: (id: number) => void;
  nodeLabelById?: (id: number) => string | undefined;
  onUpdated?: () => void;
  onClose?: () => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState(node.content);
  const [editTags, setEditTags] = useState(node.tags.join(", "));
  const [editImportance, setEditImportance] = useState(node.importance);
  const [saving, setSaving] = useState(false);
  const [relationIdx, setRelationIdx] = useState(-1);

  // Reset edit state when node changes
  useEffect(() => {
    setEditMode(false);
    setEditContent(node.content);
    setEditTags(node.tags.join(", "));
    setEditImportance(node.importance);
    setRelationIdx(-1);
  }, [node.id]);

  // Keyboard navigation
  const relationsRef = useRef(node.relations);
  relationsRef.current = node.relations;
  const relationIdxRef = useRef(relationIdx);
  relationIdxRef.current = relationIdx;
  const onRelationClickRef = useRef(onRelationClick);
  onRelationClickRef.current = onRelationClick;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      const relations = relationsRef.current;
      if (e.key === "Escape") {
        onCloseRef.current?.();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        const next = Math.min(relationIdxRef.current + 1, relations.length - 1);
        setRelationIdx(next);
        if (relations[next]) onRelationClickRef.current?.(relations[next].related_id);
      }
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        const prev = Math.max(relationIdxRef.current - 1, 0);
        setRelationIdx(prev);
        if (relations[prev]) onRelationClickRef.current?.(relations[prev].related_id);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const tags = editTags.split(",").map(t => t.trim()).filter(Boolean);
      await api.updateMemory(node.id, { content: editContent, tags, importance: editImportance });
      setEditMode(false);
      onUpdated?.();
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setEditContent(node.content);
    setEditTags(node.tags.join(", "));
    setEditImportance(node.importance);
    setEditMode(false);
  }

  if (editMode) {
    return (
      <div className="space-y-4">
        <div>
          <SectionLabel>Content</SectionLabel>
          <textarea
            value={editContent}
            onChange={e => setEditContent(e.target.value)}
            rows={6}
            className="w-full text-sm text-gray-200 bg-gray-800/60 border border-gray-700 rounded-lg p-3 resize-y focus:outline-none focus:border-sky-600"
          />
        </div>
        <div>
          <SectionLabel>Tags (comma-separated)</SectionLabel>
          <input
            value={editTags}
            onChange={e => setEditTags(e.target.value)}
            className="w-full text-sm text-gray-200 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-600"
          />
        </div>
        <div>
          <SectionLabel>Importance (1–5)</SectionLabel>
          <div className="flex gap-1">
            {[1,2,3,4,5].map(n => (
              <button
                key={n}
                onClick={() => setEditImportance(n)}
                className={`w-7 h-7 rounded text-sm transition-colors ${editImportance >= n ? "text-yellow-400" : "text-gray-600 hover:text-gray-400"}`}
              >
                ★
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex-1 py-1.5 text-xs bg-sky-700 hover:bg-sky-600 text-white rounded-md transition-colors disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={handleCancel}
            className="flex-1 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-md border border-gray-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Content */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <SectionLabel>Content</SectionLabel>
          <button
            onClick={() => setEditMode(true)}
            className="text-[10px] text-gray-500 hover:text-sky-400 transition-colors"
          >
            Edit
          </button>
        </div>
        <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap bg-gray-800/40 rounded-lg p-3 border border-gray-800">
          {node.content}
        </p>
      </div>

      {/* Header row: category + importance */}
      <div className="flex items-center justify-between">
        <CategoryBadge category={node.category} />
        <ImportanceStars n={node.importance} />
      </div>

      {/* Confidence */}
      <div>
        <SectionLabel>Confidence</SectionLabel>
        <ConfidenceBar v={node.confidence} />
      </div>

      {/* Tags */}
      {node.tags.length > 0 && (
        <div>
          <SectionLabel>Tags</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {node.tags.map(t => <TagChip key={t} name={t} />)}
          </div>
        </div>
      )}

      {/* Relations */}
      {node.relations.length > 0 && (
        <div>
          <SectionLabel>Relations <span className="text-gray-700 font-normal normal-case tracking-normal">(↑↓ to navigate)</span></SectionLabel>
          <div className="space-y-1">
            {node.relations.map((r, i) => {
              const label = nodeLabelById?.(r.related_id);
              const isActive = i === relationIdx;
              return (
                <button
                  key={r.relation_id ?? `${r.related_id}-${i}`}
                  onClick={() => { setRelationIdx(i); onRelationClick?.(r.related_id); }}
                  className={`w-full flex items-center gap-2 text-[11px] rounded px-2.5 py-1.5 border transition-colors cursor-pointer text-left ${
                    isActive
                      ? "bg-sky-900/30 border-sky-700/50"
                      : "bg-gray-800/40 border-gray-800 hover:border-gray-600 hover:bg-gray-700/40"
                  }`}
                >
                  <span className={r.direction === "outgoing" ? "text-sky-500" : "text-purple-500"}>
                    {r.direction === "outgoing" ? "↗" : "↙"}
                  </span>
                  <span className="text-gray-500 italic shrink-0">{r.type}</span>
                  {label && (
                    <span className="text-gray-400 truncate flex-1 text-[10px]">"{label}"</span>
                  )}
                  <span className="text-gray-600 font-mono shrink-0">#{r.related_id}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Metadata table */}
      <div>
        <SectionLabel>Metadata</SectionLabel>
        <div className="bg-gray-800/30 rounded-lg border border-gray-800 px-3 py-0.5">
          <MetaRow label="Confirmed">{node.confirm_count}×</MetaRow>
          {node.project_scope && (
            <MetaRow label="Project">
              <Link
                href={`/project/${encodeURIComponent(node.project_scope)}`}
                className="text-sky-400 hover:text-sky-300 transition-colors"
              >
                {node.project_scope}
              </Link>
            </MetaRow>
          )}
          {node.source && <MetaRow label="Source">{node.source}</MetaRow>}
          <MetaRow label="Last confirmed"><RelativeTime iso={node.last_confirmed_at} /></MetaRow>
          <MetaRow label="Created"><RelativeTime iso={node.created_at} /></MetaRow>
          {node.dedup_key && (
            <MetaRow label="Dedup key">
              <code className="text-[9px] text-gray-500 break-all">{node.dedup_key}</code>
            </MetaRow>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Context panel ─────────────────────────────────────────────────────────────

const CONTEXT_CATEGORY_COLORS: Record<string, string> = {
  goal: "bg-sky-900/40 text-sky-300 border-sky-800/50",
  decision: "bg-violet-900/40 text-violet-300 border-violet-800/50",
  gotcha: "bg-red-900/40 text-red-300 border-red-800/50",
  progress: "bg-emerald-900/40 text-emerald-300 border-emerald-800/50",
};

const CONTEXT_CATEGORY_META: Record<string, { label: string; description: string }> = {
  goal:     { label: "Current Goal",    description: "What this project is trying to achieve right now." },
  decision: { label: "Decision Made",   description: "An architectural or design choice that was intentionally made." },
  gotcha:   { label: "Watch Out",       description: "A pitfall, bug, or tricky behavior to remember and avoid." },
  progress: { label: "Progress Log",    description: "What was done in a recent session — a work log entry." },
};

function ContextPanel({ node }: { node: ContextNode }) {
  const badgeColor = CONTEXT_CATEGORY_COLORS[node.category] ?? "bg-gray-800 text-gray-400 border-gray-700";
  const meta = CONTEXT_CATEGORY_META[node.category];
  return (
    <div className="space-y-5">
      {/* Category banner with human description */}
      {meta && (
        <div className={`rounded-lg px-3 py-2.5 border ${badgeColor}`}>
          <div className="text-[11px] font-semibold mb-0.5">{meta.label}</div>
          <div className="text-[10px] opacity-80">{meta.description}</div>
        </div>
      )}
      <div>
        <SectionLabel>Content</SectionLabel>
        <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap bg-gray-800/40 rounded-lg p-3 border border-gray-800">
          {node.content}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {node.permanent && (
          <span className="text-[10px] text-amber-500 bg-amber-900/20 border border-amber-800/40 rounded px-1.5 py-0.5">
            permanent — never trimmed
          </span>
        )}
      </div>
      <div>
        <SectionLabel>Metadata</SectionLabel>
        <div className="bg-gray-800/30 rounded-lg border border-gray-800 px-3 py-0.5">
          {node.project_scope && (
            <MetaRow label="Project">
              <Link
                href={`/project/${encodeURIComponent(node.project_scope)}`}
                className="text-sky-400 hover:text-sky-300 transition-colors"
              >
                {node.project_scope}
              </Link>
            </MetaRow>
          )}
          {node.session_id && (
            <MetaRow label="Session">
              <code className="text-[9px] text-gray-500">{node.session_id.substring(0, 12)}…</code>
            </MetaRow>
          )}
          <MetaRow label="Created"><RelativeTime iso={node.created_at} /></MetaRow>
        </div>
      </div>
    </div>
  );
}

// ── Project panel ─────────────────────────────────────────────────────────────

const CONTEXT_TAB_COLORS: Record<string, string> = {
  goal: "bg-sky-600 border-sky-500",
  decision: "bg-violet-600 border-violet-500",
  gotcha: "bg-red-700 border-red-600",
  progress: "bg-emerald-600 border-emerald-500",
};

function ProjectPanel({ node }: { node: ProjectNode }) {
  const [tab, setTab] = useState<"goal" | "decision" | "gotcha" | "progress">("goal");
  const [items, setItems] = useState<Record<string, CtxItem[]>>({});
  const [newestFirst, setNewestFirst] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    api.context(node.label)
      .then(d => { if (!controller.signal.aborted) setItems(d); })
      .catch(() => { /* ignore */ });
    return () => controller.abort();
  }, [node.label]);

  const tabs = ["goal", "decision", "gotcha", "progress"] as const;
  const rawList = items[tab] ?? [];
  const list = useMemo(
    () => newestFirst ? rawList : [...rawList].reverse(),
    [newestFirst, rawList]
  );
  const color = nodeColor("project");

  return (
    <div className="space-y-4">
      {/* Project header card */}
      <div
        className="rounded-xl p-4 border"
        style={{ background: `${color}10`, borderColor: `${color}30` }}
      >
        <div className="text-xs font-semibold" style={{ color }}>{node.label}</div>
        <div className="text-[10px] text-gray-500 mt-1">{node.confirm_count} context items</div>
        <Link
          href={`/project/${encodeURIComponent(node.label)}`}
          className="inline-block mt-2 text-[10px] text-sky-400 hover:text-sky-300 transition-colors"
        >
          View full project →
        </Link>
      </div>

      {/* Context tabs */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <SectionLabel>Context</SectionLabel>
          {rawList.length > 1 && (
            <button
              onClick={() => setNewestFirst(v => !v)}
              className="text-[9px] text-gray-500 hover:text-gray-300 transition-colors"
            >
              {newestFirst ? "↓ newest" : "↑ oldest"}
            </button>
          )}
        </div>
        <div className="flex gap-1 mb-3">
          {tabs.map(t => {
            const active = tab === t;
            const cnt = items[t]?.length ?? 0;
            const tabLabel = CONTEXT_CATEGORY_META[t]?.label ?? t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                title={CONTEXT_CATEGORY_META[t]?.description}
                className={`flex-1 text-[10px] py-1.5 rounded border font-medium transition-colors ${
                  active
                    ? `${CONTEXT_TAB_COLORS[t]} text-white`
                    : "bg-gray-800/60 border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600"
                }`}
              >
                {tabLabel}
                {cnt > 0 && (
                  <span className={`ml-1 text-[9px] ${active ? "opacity-70" : "text-gray-600"}`}>
                    {cnt}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {list.length === 0 ? (
          <p className="text-xs text-gray-600 italic text-center py-4">No {CONTEXT_CATEGORY_META[tab]?.label ?? tab} items yet</p>
        ) : (
          <ul className="space-y-2">
            {list.map((item) => (
              <li key={item.created_at} className="text-xs text-gray-300 bg-gray-800/40 border border-gray-800 rounded-lg p-2.5 leading-relaxed">
                <p>{item.content}</p>
                <p className="text-[9px] text-gray-600 mt-1.5">
                  <RelativeTime iso={item.created_at} />
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Main Sidebar ──────────────────────────────────────────────────────────────

export default function Sidebar({ node, onClose, onRelationClick, nodeLabelById, onReasoningResult, onUpdated }: Props) {
  const [detail, setDetail] = useState<MemoryDetail | null>(null);
  const [reasoning, setReasoning] = useState<ReasoningResult | null>(null);
  const [reasoningLoading, setReasoningLoading] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setDetail(null);
    setReasoning(null);
    setShowReasoning(false);
    if (!node || "is_project" in node || "is_context" in node) return;
    const controller = new AbortController();
    api.memory(node.id)
      .then(d => { if (!controller.signal.aborted) setDetail(d); })
      .catch(() => { /* ignore */ });
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
      className={`transition-all duration-200 overflow-hidden shrink-0 ${node ? "w-80" : "w-0"}`}
      data-testid="sidebar"
    >
      {node && (
        <div className="min-w-[280px] bg-[var(--bg-primary)] border-l border-[var(--border)] flex flex-col overflow-hidden h-full">
          {/* Header */}
          <div
            className="px-4 pt-4 pb-3 border-b border-[var(--border)] relative"
            style={{ background: `linear-gradient(to bottom, ${accentColor}0d, transparent)` }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div
                  className="text-[9px] font-semibold uppercase tracking-widest mb-1"
                  style={{ color: accentColor }}
                >
                  {typeLabel}
                </div>
                <div className="text-sm font-semibold text-[var(--text-primary)] leading-snug truncate" title={node.label}>
                  {node.label}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {isMemory && (
                  <button
                    onClick={handleReason}
                    disabled={reasoningLoading}
                    className={`h-6 px-2 text-[10px] rounded-md border transition-colors font-medium ${
                      showReasoning
                        ? "bg-yellow-900/40 border-yellow-700/60 text-yellow-400"
                        : "bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600"
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
                    className="h-6 px-2 text-[10px] rounded-md border border-transparent text-gray-600 hover:text-red-400 hover:border-red-800/50 hover:bg-red-900/20 transition-colors disabled:opacity-50 font-medium"
                    aria-label="Delete"
                    title={isContext ? "Delete context item" : "Delete memory"}
                  >
                    {deleting ? "Deleting…" : "Delete"}
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="w-6 h-6 flex items-center justify-center rounded-md text-gray-600 hover:text-gray-300 hover:bg-gray-800 transition-colors mt-0.5"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4">
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
                      // Refetch detail after update
                      api.memory(node.id).then(setDetail).catch(() => { /* ignore */ });
                    }}
                    onClose={onClose}
                  />
                ) : (
                  <div className="flex items-center justify-center h-24 text-xs text-gray-600">
                    Loading…
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
