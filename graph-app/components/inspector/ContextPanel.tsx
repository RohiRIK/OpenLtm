import Link from "next/link";
import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { ContextNode } from "@/lib/types";
import { SectionLabel, MetaRow, RelativeTime } from "./shared";

const CONTEXT_CATEGORY_COLORS: Record<string, string> = {
  goal: "bg-sky-900/40 text-sky-300 border-sky-800/50",
  decision: "bg-violet-900/40 text-violet-300 border-violet-800/50",
  gotcha: "bg-red-900/40 text-red-300 border-red-800/50",
  progress: "bg-emerald-900/40 text-emerald-300 border-emerald-800/50",
};

export const CONTEXT_CATEGORY_META: Record<string, { label: string; description: string }> = {
  goal:     { label: "Current Goal",    description: "What this project is trying to achieve right now." },
  decision: { label: "Decision Made",   description: "An architectural or design choice that was intentionally made." },
  gotcha:   { label: "Watch Out",       description: "A pitfall, bug, or tricky behavior to remember and avoid." },
  progress: { label: "Progress Log",    description: "What was done in a recent session — a work log entry." },
};

function DecisionWhyTooltip({ node }: { node: ContextNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-[10px] text-violet-300 hover:text-violet-200 border border-violet-800/60 rounded px-1.5 py-0.5"
        aria-expanded={open}
        title="Why was this decision made?"
      >
        <HelpCircle className="w-3 h-3" />
        Why?
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 w-72 rounded-md border border-violet-800/60 bg-black/80 backdrop-blur p-3 shadow-lg">
          <div className="text-[10px] uppercase tracking-wider text-violet-300 mb-1.5 font-semibold">
            Why this decision
          </div>
          <p className="text-xs text-foreground/90 leading-relaxed mb-2">
            {node.content}
          </p>
          {node.session_id && (
            <div className="text-[10px] text-muted-foreground border-t border-violet-800/40 pt-1.5">
              Source session: <code className="font-mono">{node.session_id.substring(0, 12)}…</code>
            </div>
          )}
          <div className="text-[10px] text-muted-foreground mt-1.5">
            Tip: use <span className="font-mono">Recall</span> with this content to find related memories and the
            trade-offs considered at the time.
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute top-1 right-1 w-5 h-5 grid place-items-center text-muted-foreground hover:text-foreground text-xs"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

export function ContextPanel({ node }: { node: ContextNode }) {
  const badgeColor = CONTEXT_CATEGORY_COLORS[node.category] ?? "bg-muted text-muted-foreground border-border";
  const meta = CONTEXT_CATEGORY_META[node.category];
  return (
    <div className="space-y-5">
      {meta && (
        <div className={`rounded-lg px-3 py-2.5 border ${badgeColor}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold mb-0.5">{meta.label}</div>
              <div className="text-xs opacity-80">{meta.description}</div>
            </div>
            {node.category === "decision" && <DecisionWhyTooltip node={node} />}
          </div>
        </div>
      )}
      <div>
        <SectionLabel>Content</SectionLabel>
        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap bg-white/5 rounded-lg p-3 border border-white/10">
          {node.content}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {node.permanent && (
          <span className="text-xs text-amber-500 bg-amber-900/20 border border-amber-800/40 rounded px-1.5 py-0.5">
            permanent — never trimmed
          </span>
        )}
      </div>
      <div>
        <SectionLabel>Metadata</SectionLabel>
        <div className="bg-white/5 rounded-lg border border-white/10 px-3 py-0.5">
          {node.project_scope && (
            <MetaRow label="Project">
              <Link
                href={`/project/${encodeURIComponent(node.project_scope)}`}
                className="text-primary hover:text-primary/80 transition-colors"
              >
                {node.project_scope}
              </Link>
            </MetaRow>
          )}
          {node.session_id && (
            <MetaRow label="Session">
              <code className="text-xs text-muted-foreground">{node.session_id.substring(0, 12)}…</code>
            </MetaRow>
          )}
          <MetaRow label="Created"><RelativeTime iso={node.created_at} /></MetaRow>
        </div>
      </div>
    </div>
  );
}
