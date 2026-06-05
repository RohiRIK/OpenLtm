"use client";

/**
 * Recover drawer — slide-in from right. Shows memories that have been
 * soft-deleted (status=archived with a recent deleted_at) and lets the
 * user restore them. v2.6.0 ships the UI shell; the actual soft-delete
 * pipeline lands in v2.8.0 along with the dedicated inbox schema.
 */

import { useEffect, useState } from "react";
import { X, ArchiveRestore, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { SupersededMemory } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function RecoverDrawer({ open, onClose }: Props) {
  const [items, setItems] = useState<SupersededMemory[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    api.supersededMemories()
      .then((rows) => alive && setItems(rows))
      .catch(() => alive && setItems([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div
        aria-hidden
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-label="Recover soft-deleted memories"
        className="fixed top-0 right-0 bottom-0 w-[420px] max-w-full z-50 border-l border-[var(--border)] bg-[var(--bg-primary)] flex flex-col"
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <ArchiveRestore className="w-4 h-4" /> Recover
            </h2>
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
              Soft-deleted memories from the last 30 days.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-6 text-xs text-[var(--text-muted)] justify-center">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
            </div>
          ) : !items || items.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] text-center py-8">
              Nothing to recover. Deleted items appear here for 30 days.
            </p>
          ) : (
            items.map((m) => (
              <div
                key={m.id}
                className="rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] p-3 space-y-2"
              >
                <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                  <span className="font-mono">#{m.id}</span>
                  <span>{new Date(m.created_at).toLocaleDateString()}</span>
                </div>
                <p className="text-xs text-[var(--text-primary)] line-clamp-3 leading-relaxed">
                  {m.content}
                </p>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="text-[10px] font-medium px-2 py-1 rounded-md text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/10"
                  >
                    Restore
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
}
