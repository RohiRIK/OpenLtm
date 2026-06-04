import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import ImportanceStars from "@/components/ImportanceStars";
import { MemoryDetail, SimilarResult } from "@/lib/types";
import {
  SectionLabel,
  CategoryBadge,
  ConfidenceBar,
  TagChip,
  MetaRow,
  RelativeTime
} from "./shared";

function SimilarSection({ memoryId, onRelationClick }: {
  memoryId: number;
  onRelationClick?: (id: number) => void;
}) {
  const [results, setResults] = useState<SimilarResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setResults(null);
    setError(false);
  }, [memoryId]);

  async function handleFind() {
    setLoading(true);
    setError(false);
    try {
      setResults(await api.findSimilar(memoryId));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <SectionLabel>Find Similar</SectionLabel>
        <button
          onClick={() => void handleFind()}
          disabled={loading}
          className="text-xs text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
        >
          {loading ? "Searching…" : results ? "Refresh" : "Find similar"}
        </button>
      </div>
      {error && <p className="text-xs text-destructive">Vector search unavailable.</p>}
      {results && results.length === 0 && !error && (
        <p className="text-xs text-muted-foreground italic">No similar memories found.</p>
      )}
      {results && results.length > 0 && (
        <div className="space-y-1">
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => onRelationClick?.(r.id)}
              className="w-full flex items-center gap-2 text-xs rounded-lg px-2.5 py-1.5 border bg-white/5 border-white/10 hover:border-white/20 hover:bg-white/10 transition-colors cursor-pointer text-left focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <span className="text-muted-foreground truncate flex-1 text-xs">
                {r.content.substring(0, 60)}
              </span>
              <span className="text-primary font-mono shrink-0">{Math.round(r.similarity * 100)}%</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MemoryPanel({ node, onRelationClick, nodeLabelById, onUpdated, onClose }: {
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

  // Reset edit state when node changes
  useEffect(() => {
    setEditMode(false);
    setEditContent(node.content);
    setEditTags(node.tags.join(", "));
    setEditImportance(node.importance);
  }, [node.id]);

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
            className="w-full text-sm text-foreground bg-black/40 border border-white/10 rounded-lg p-3 resize-y focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <SectionLabel>Tags (comma-separated)</SectionLabel>
          <input
            value={editTags}
            onChange={e => setEditTags(e.target.value)}
            className="w-full text-sm text-foreground bg-black/40 border border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <SectionLabel>Importance (1–5)</SectionLabel>
          <div className="flex gap-1">
            {[1,2,3,4,5].map(n => (
              <button
                key={n}
                onClick={() => setEditImportance(n)}
                className={`w-8 h-8 rounded-md text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${editImportance >= n ? "text-yellow-400" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
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
            className="flex-1 py-2 text-sm bg-primary hover:bg-primary/90 text-primary-foreground rounded-md transition-colors disabled:opacity-50 font-medium"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={handleCancel}
            className="flex-1 py-2 text-sm bg-white/5 hover:bg-white/10 text-foreground rounded-md border border-white/10 transition-colors font-medium"
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
            className="text-xs text-muted-foreground hover:text-primary transition-colors focus:outline-none focus:underline"
          >
            Edit
          </button>
        </div>
        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap bg-white/5 rounded-lg p-3 border border-white/10">
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
          <SectionLabel>Relations</SectionLabel>
          <ul className="space-y-1" role="listbox" aria-label="Memory relations">
            {node.relations.map((r, i) => {
              const label = nodeLabelById?.(r.related_id);
              return (
                <li key={r.relation_id ?? `${r.related_id}-${i}`}>
                  <button
                    onClick={() => { onRelationClick?.(r.related_id); }}
                    className="w-full flex items-center gap-2 text-xs rounded-lg px-2.5 py-1.5 border transition-colors cursor-pointer text-left bg-white/5 border-white/10 hover:border-white/20 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-ring"
                    role="option"
                    aria-selected="false"
                  >
                    <span className={r.direction === "outgoing" ? "text-primary" : "text-purple-500"}>
                      {r.direction === "outgoing" ? "↗" : "↙"}
                    </span>
                    <span className="text-muted-foreground italic shrink-0">{r.type}</span>
                    {label && (
                      <span className="text-foreground truncate flex-1 text-xs">"{label}"</span>
                    )}
                    <span className="text-muted-foreground font-mono shrink-0">#{r.related_id}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Find similar (sqlite-vec KNN) */}
      <SimilarSection memoryId={node.id} onRelationClick={onRelationClick} />

      {/* Metadata table */}
      <div>
        <SectionLabel>Metadata</SectionLabel>
        <div className="bg-white/5 rounded-lg border border-white/10 px-3 py-0.5">
          <MetaRow label="Confirmed">{node.confirm_count}×</MetaRow>
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
          {node.source && <MetaRow label="Source">{node.source}</MetaRow>}
          <MetaRow label="Last confirmed"><RelativeTime iso={node.last_confirmed_at} /></MetaRow>
          <MetaRow label="Created"><RelativeTime iso={node.created_at} /></MetaRow>
          {node.dedup_key && (
            <MetaRow label="Dedup key">
              <code className="text-xs text-muted-foreground break-all">{node.dedup_key}</code>
            </MetaRow>
          )}
        </div>
      </div>
    </div>
  );
}
