"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import ExplainBlock from "@/components/ExplainBlock";
import ProjectTimeline from "@/components/ProjectTimeline";
import ProjectConnections from "@/components/ProjectConnections";
import ProjectRelevance from "@/components/ProjectRelevance";
import { api } from "@/lib/api";
import type { ProjectDetail } from "@/lib/types";

interface ProjectSheetProps {
  projectName: string | null;
  onClose: () => void;
}

const CTX_ORDER: { key: string; label: string }[] = [
  { key: "goal", label: "Goals" },
  { key: "decision", label: "Decisions" },
  { key: "progress", label: "Progress" },
  { key: "gotcha", label: "Gotchas" },
];

/** Detail view for a single project, opened from the Overview/Health tiles.
 *  Four sections (overview, timeline, connections, personal relevance) are
 *  filled in across Phases 4–6 — this shell wires the data fetch + layout. */
export default function ProjectSheet({ projectName, onClose }: ProjectSheetProps) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectName) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    api
      .project(projectName)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => { if (!cancelled) setError(e.message ?? "Failed to load project"); });
    return () => { cancelled = true; };
  }, [projectName]);

  return (
    <Sheet open={!!projectName} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{projectName ?? ""}</SheetTitle>
          <SheetDescription>
            The full story of this project — what it is, what changed, what connects, and what works for you.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-6">
          {error ? (
            <div className="text-sm text-[var(--text-muted)]">{error}</div>
          ) : !detail ? (
            <div className="text-sm text-[var(--text-muted)]">Loading…</div>
          ) : (
            <>
              <section>
                <h3 className="text-sm font-semibold mb-2">Overview</h3>
                <ExplainBlock title="What is this project?">
                  A snapshot of what the assistant remembers here: {detail.memories.length} memories
                  across {detail.context_items.length} context items. Expand each group below to read
                  the goals, decisions, progress, and gotchas it has captured.
                </ExplainBlock>
                <Accordion type="multiple" className="w-full">
                  {CTX_ORDER.map(({ key, label }) => {
                    const items = detail.context[key] ?? [];
                    if (items.length === 0) return null;
                    return (
                      <AccordionItem key={key} value={key}>
                        <AccordionTrigger className="text-sm">
                          <span className="flex items-center gap-2">
                            {label}
                            <Badge variant="secondary">{items.length}</Badge>
                          </span>
                        </AccordionTrigger>
                        <AccordionContent>
                          <ul className="space-y-2">
                            {items.map((it, i) => (
                              <li key={i} className="text-[var(--text-muted)] leading-snug">
                                {it.content}
                              </li>
                            ))}
                          </ul>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              </section>

              <ProjectTimeline detail={detail} />

              <ProjectConnections detail={detail} />

              <ProjectRelevance detail={detail} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
