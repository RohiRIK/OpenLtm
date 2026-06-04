import Link from "next/link";
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

export function ContextPanel({ node }: { node: ContextNode }) {
  const badgeColor = CONTEXT_CATEGORY_COLORS[node.category] ?? "bg-muted text-muted-foreground border-border";
  const meta = CONTEXT_CATEGORY_META[node.category];
  return (
    <div className="space-y-5">
      {/* Category banner with human description */}
      {meta && (
        <div className={`rounded-lg px-3 py-2.5 border ${badgeColor}`}>
          <div className="text-sm font-semibold mb-0.5">{meta.label}</div>
          <div className="text-xs opacity-80">{meta.description}</div>
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
