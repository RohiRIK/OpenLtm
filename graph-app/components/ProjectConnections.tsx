"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { HelpCircle } from "lucide-react";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import ExplainBlock from "@/components/ExplainBlock";
import type { ProjectDetail, GraphData, GraphLink, GraphNode } from "@/lib/types";

const Graph = dynamic(() => import("@/components/Graph"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">Loading map…</div>
  ),
});

const REL_MEANING: Record<string, string> = {
  supports: "This memory is evidence for the one it points to.",
  contradicts: "This memory conflicts with the one it points to.",
  refines: "This memory is a more specific version of the other.",
  depends_on: "This memory requires the other to make sense.",
  related_to: "A general association between the two memories.",
  supersedes: "This memory replaces an older, now-outdated one.",
};

function endpointId(v: GraphLink["source"]): number {
  return typeof v === "number" ? v : (v as GraphNode).id;
}

interface ProjectConnectionsProps {
  detail: ProjectDetail;
}

export default function ProjectConnections({ detail }: ProjectConnectionsProps) {
  const labelById = useMemo(() => {
    const map = new Map<number, string>();
    for (const m of detail.memories) map.set(m.id, m.label || m.content.slice(0, 40));
    for (const c of detail.context_items) map.set(c.id, c.label || c.content.slice(0, 40));
    return map;
  }, [detail.memories, detail.context_items]);

  const byType = useMemo(() => {
    const groups = new Map<string, GraphLink[]>();
    for (const l of detail.relations) {
      const arr = groups.get(l.type) ?? [];
      arr.push(l);
      groups.set(l.type, arr);
    }
    return [...groups.entries()];
  }, [detail.relations]);

  const graphData = useMemo<GraphData>(() => {
    const nodes = [...detail.memories, ...detail.context_items];
    const nodeIds = new Set(nodes.map((n) => n.id));
    // react-force-graph throws "node not found" if a link references an id
    // outside `nodes` — relations can point to memories in other projects.
    const links = detail.relations.filter(
      (l) => nodeIds.has(endpointId(l.source)) && nodeIds.has(endpointId(l.target)),
    );
    return { nodes, links };
  }, [detail.memories, detail.context_items, detail.relations]);

  return (
    <section>
      <h3 className="text-sm font-semibold mb-2">Connections</h3>
      <ExplainBlock title="What links these memories?">
        Memories don&apos;t stand alone — one can support, refine, or contradict another. The list
        groups every link by what it means; switch to the map to see the same links as a small graph.
      </ExplainBlock>

      {detail.relations.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">No connections recorded yet.</p>
      ) : (
        <Tabs defaultValue="list" className="w-full">
          <TabsList>
            <TabsTrigger value="list">List</TabsTrigger>
            <TabsTrigger value="map">Map</TabsTrigger>
          </TabsList>

          <TabsContent value="list">
            <TooltipProvider>
              <Accordion type="multiple" className="w-full">
                {byType.map(([type, links]) => (
                  <AccordionItem key={type} value={type}>
                    <AccordionTrigger className="text-sm">
                      <span className="flex items-center gap-2">
                        {type.replace(/_/g, " ")}
                        <Badge variant="secondary">{links.length}</Badge>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            {REL_MEANING[type] ?? "A connection between two memories."}
                          </TooltipContent>
                        </Tooltip>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <ul className="space-y-1.5">
                        {links.map((l, i) => (
                          <li key={l.relation_id ?? i} className="text-[var(--text-muted)]">
                            {labelById.get(endpointId(l.source)) ?? `#${endpointId(l.source)}`}
                            <span className="mx-1.5 text-[var(--accent)]">→</span>
                            {labelById.get(endpointId(l.target)) ?? `#${endpointId(l.target)}`}
                          </li>
                        ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </TooltipProvider>
          </TabsContent>

          <TabsContent value="map">
            <div className="h-80 rounded-lg border border-[var(--border)] overflow-hidden">
              <Graph data={graphData} activeProject={detail.name} onNodeClick={() => {}} />
            </div>
          </TabsContent>
        </Tabs>
      )}
    </section>
  );
}
