"use client";

import { useMemo, useState } from "react";
import { ArrowUp, ArrowDown, Circle, Sparkles, History } from "lucide-react";
import ExplainBlock from "@/components/ExplainBlock";
import { cn } from "@/lib/utils";
import type { MemoryNode } from "@/lib/types";

type EventKind = "learned" | "confirmed" | "relevance-up" | "relevance-down";

interface TimelineEvent {
  key: string;
  kind: EventKind;
  label: string;
  detail: string;
  at: number;
  atIso: string;
  memory: MemoryNode;
}

type Range = "7d" | "30d" | "90d" | "all";

const RANGE_DAYS: Record<Range, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(d.toISOString()) === dayKey(today.toISOString())) return "Today";
  if (dayKey(d.toISOString()) === dayKey(yesterday.toISOString())) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function buildEvents(memories: MemoryNode[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const m of memories) {
    if (m.created_at) {
      events.push({
        key: `${m.id}-learned`,
        kind: "learned",
        label: m.label || m.content.slice(0, 60),
        detail: m.category,
        at: new Date(m.created_at).getTime(),
        atIso: m.created_at,
        memory: m,
      });
    }
    if (m.last_confirmed_at && m.confirm_count > 0 && m.last_confirmed_at !== m.created_at) {
      events.push({
        key: `${m.id}-confirmed`,
        kind: "confirmed",
        label: m.label || m.content.slice(0, 60),
        detail: `confirmed ×${m.confirm_count}`,
        at: new Date(m.last_confirmed_at).getTime(),
        atIso: m.last_confirmed_at,
        memory: m,
      });
    }
    if (m.relevance_signal && m.relevance_signal_at) {
      events.push({
        key: `${m.id}-${m.relevance_signal}`,
        kind: m.relevance_signal === "works" ? "relevance-up" : "relevance-down",
        label: m.label || m.content.slice(0, 60),
        detail: m.relevance_signal === "works" ? "Marked as still relevant" : "Marked as no longer relevant",
        at: new Date(m.relevance_signal_at).getTime(),
        atIso: m.relevance_signal_at,
        memory: m,
      });
    }
  }
  return events.sort((a, b) => b.at - a.at);
}

const KIND_STYLES: Record<EventKind, { dot: string; ring: string; pill: string; icon: React.ElementType; label: string }> = {
  "learned":        { dot: "bg-emerald-500", ring: "ring-emerald-500/30", pill: "text-emerald-500 border-emerald-500/30 bg-emerald-500/10", icon: Sparkles, label: "Learned" },
  "confirmed":      { dot: "bg-[var(--accent-blue,#5266eb)]", ring: "ring-[var(--accent-blue,#5266eb)]/30", pill: "text-[var(--accent-blue,#5266eb)] border-[var(--accent-blue,#5266eb)]/30 bg-[var(--accent-blue,#5266eb)]/10", icon: Circle, label: "Confirmed" },
  "relevance-up":   { dot: "bg-emerald-500", ring: "ring-emerald-500/30", pill: "text-emerald-500 border-emerald-500/30 bg-emerald-500/10", icon: ArrowUp, label: "Relevance up" },
  "relevance-down": { dot: "bg-rose-500", ring: "ring-rose-500/30", pill: "text-rose-500 border-rose-500/30 bg-rose-500/10", icon: ArrowDown, label: "Relevance down" },
};

interface ProjectTimelineProps {
  memories: MemoryNode[];
  onSelect?: (memory: MemoryNode) => void;
}

export default function ProjectTimeline({ memories, onSelect }: ProjectTimelineProps) {
  const [range, setRange] = useState<Range>("30d");

  const allEvents = useMemo(() => buildEvents(memories), [memories]);

  const events = useMemo(() => {
    const days = RANGE_DAYS[range];
    if (days === null) return allEvents;
    const cutoff = Date.now() - days * 86_400_000;
    return allEvents.filter((e) => e.at >= cutoff);
  }, [allEvents, range]);

  const grouped = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>();
    for (const e of events) {
      const k = dayKey(e.atIso);
      const arr = map.get(k) ?? [];
      arr.push(e);
      map.set(k, arr);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [events]);

  const counts = useMemo(() => {
    const c: Record<Range, number> = { "7d": 0, "30d": 0, "90d": 0, all: allEvents.length };
    for (const e of allEvents) {
      for (const r of ["7d", "30d", "90d"] as Range[]) {
        const d = RANGE_DAYS[r]!;
        if (e.at >= Date.now() - d * 86_400_000) c[r]++;
      }
    }
    return c;
  }, [allEvents]);

  return (
    <section>
      <header className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <History className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            Activity
          </h3>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5 tabular-nums">
            {events.length} of {allEvents.length} events
          </p>
        </div>
        <div className="flex items-center gap-0.5 border border-[var(--border)] rounded p-0.5">
          {(["7d", "30d", "90d", "all"] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={cn(
                "h-6 px-2 text-[10px] font-medium uppercase tracking-wider rounded transition-colors tabular-nums",
                range === r
                  ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </header>

      <ExplainBlock title="What changed over time?">
        Every memory leaves a mark: when it was first learned, each time it was
        reinforced, and when someone marked it more or less relevant. Newest at the top.
      </ExplainBlock>

      {grouped.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] mt-3">No activity in this range.</p>
      ) : (
        <div className="mt-3 space-y-5">
          {grouped.map(([day, dayEvents]) => (
            <div key={day}>
              <div className="flex items-baseline gap-2 mb-2 pl-7 relative">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-primary)]">
                  {dayLabel(dayEvents[0].atIso)}
                </span>
                <span className="text-[10px] text-[var(--text-muted)] tabular-nums">
                  {dayEvents.length} event{dayEvents.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="relative pl-7">
                <div
                  aria-hidden
                  className="absolute left-2.5 top-0 bottom-0 w-px bg-[var(--border)]"
                />
                <ul className="space-y-0.5">
                  {dayEvents.map((e, i) => {
                    const style = KIND_STYLES[e.kind];
                    const Icon = style.icon;
                    return (
                      <li
                        key={e.key}
                        className="relative flex items-center gap-3 py-1.5"
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "absolute -left-[18px] top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full ring-4",
                            style.dot,
                            style.ring
                          )}
                        />
                        <button
                          type="button"
                          onClick={() => onSelect?.(e.memory)}
                          className="flex items-center gap-2 min-w-0 flex-1 text-left group"
                        >
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border whitespace-nowrap",
                              style.pill
                            )}
                          >
                            <Icon className="w-2.5 h-2.5" />
                            {style.label}
                          </span>
                          <span className="text-xs text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors truncate min-w-0">
                            {e.label}
                          </span>
                          <span className="ml-auto text-[10px] text-[var(--text-muted)] tabular-nums whitespace-nowrap">
                            {timeOfDay(e.atIso)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
