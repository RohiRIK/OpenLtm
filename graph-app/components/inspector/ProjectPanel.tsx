import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { nodeColor } from "@/lib/nodeColors";
import { CtxItem, ProjectNode } from "@/lib/types";
import { SectionLabel, RelativeTime } from "./shared";
import { CONTEXT_CATEGORY_META } from "./ContextPanel";

const CONTEXT_TAB_COLORS: Record<string, string> = {
  goal: "bg-sky-600 border-sky-500",
  decision: "bg-violet-600 border-violet-500",
  gotcha: "bg-red-700 border-red-600",
  progress: "bg-emerald-600 border-emerald-500",
};

export function ProjectPanel({ node }: { node: ProjectNode }) {
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
        className="rounded-xl p-4 border bg-card"
        style={{ borderColor: `${color}30` }}
      >
        <div className="text-sm font-semibold" style={{ color }}>{node.label}</div>
        <div className="text-xs text-muted-foreground mt-1">{node.confirm_count} context items</div>
        <Link
          href={`/project/${encodeURIComponent(node.label)}`}
          className="inline-block mt-2 text-xs text-primary hover:text-primary/80 transition-colors"
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
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
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
                className={`h-7 px-3 text-xs rounded-md border transition-colors font-medium ${
                  active
                    ? "bg-white/10 border-white/20 text-white"
                    : "bg-white/5 border-white/10 text-muted-foreground hover:text-white hover:border-white/20"
                }`}
              >
                {tabLabel}
                {cnt > 0 && (
                  <span className={`ml-1 text-xs ${active ? "opacity-70" : "text-muted-foreground"}`}>
                    {cnt}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground italic text-center py-4">No {CONTEXT_CATEGORY_META[tab]?.label ?? tab} items yet</p>
        ) : (
          <ul className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
            {list.map((item) => (
              <li key={item.created_at} className="text-sm text-foreground bg-white/5 border border-white/10 rounded-lg p-3 leading-relaxed">
                <p>{item.content}</p>
                <p className="text-xs text-muted-foreground mt-1.5">
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
