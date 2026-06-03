"use client";

import { useMemo } from "react";
import {
  Timeline,
  TimelineItem,
  TimelineDot,
  TimelineContent,
  TimelineHeading,
  TimelineLine,
} from "@/components/ui/timeline";
import ExplainBlock from "@/components/ExplainBlock";
import type { ProjectDetail, MemoryNode } from "@/lib/types";

type EventKind = "learned" | "reinforced";

interface TimelineEvent {
  key: string;
  kind: EventKind;
  label: string;
  detail: string;
  at: number;
  when: string;
}

function whenLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
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
        when: whenLabel(m.created_at),
      });
    }
    if (
      m.last_confirmed_at &&
      m.confirm_count > 0 &&
      m.last_confirmed_at !== m.created_at
    ) {
      events.push({
        key: `${m.id}-reinforced`,
        kind: "reinforced",
        label: m.label || m.content.slice(0, 60),
        detail: `reinforced ×${m.confirm_count}`,
        at: new Date(m.last_confirmed_at).getTime(),
        when: whenLabel(m.last_confirmed_at),
      });
    }
  }
  return events.sort((a, b) => b.at - a.at);
}

interface ProjectTimelineProps {
  detail: ProjectDetail;
}

export default function ProjectTimeline({ detail }: ProjectTimelineProps) {
  const events = useMemo(() => buildEvents(detail.memories), [detail.memories]);

  return (
    <section>
      <h3 className="text-sm font-semibold mb-2">Timeline</h3>
      <ExplainBlock title="What changed over time?">
        Every memory leaves a mark: when it was first learned, and each time it was
        reinforced by coming up again. Newest is at the top — read down to see how this
        project&apos;s knowledge built up.
      </ExplainBlock>

      {events.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">No dated events yet.</p>
      ) : (
        <Timeline positions="left">
          {events.map((e, i) => (
            <TimelineItem key={e.key} status={e.kind === "learned" ? "done" : "default"}>
              <TimelineHeading>{e.label}</TimelineHeading>
              <TimelineDot status={e.kind === "learned" ? "done" : "current"} />
              {i < events.length - 1 && <TimelineLine done={e.kind === "learned"} />}
              <TimelineContent>
                {e.detail} · {e.when}
              </TimelineContent>
            </TimelineItem>
          ))}
        </Timeline>
      )}
    </section>
  );
}
