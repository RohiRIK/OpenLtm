"use client";
import * as d3 from "d3";
import { useEffect, useRef } from "react";
import { nodeColor, nodeRadius } from "@/lib/nodeColors";
import type { ContextNode, GraphLink, MemoryNode } from "@/lib/types";

type AnyNode = MemoryNode | ContextNode;

interface Props {
  projectName: string;
  memories: MemoryNode[];
  contextItems: ContextNode[];
  relations: GraphLink[];
  onNodeClick: (node: AnyNode) => void;
}

interface RawNode {
  id: number;
  label: string;
  category: string;
  importance: number;
  is_context?: boolean;
  x: number;
  y: number;
  _original: AnyNode | undefined; // undefined for the center project node (display-only)
}

export default function MiniGraph({ projectName, memories, contextItems, relations, onNodeClick }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const W = svgEl.clientWidth || 600;
    const H = svgEl.clientHeight || 400;
    const cx = W / 2;
    const cy = H / 2;

    const svg = d3.select(svgEl);
    svg.on(".zoom", null); // remove previous zoom listeners before re-attaching
    svg.selectAll("*").remove();

    const g = svg.append("g");
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 4])
        .on("zoom", e => g.attr("transform", e.transform.toString()))
    );

    const allNodes: RawNode[] = [];

    // Project center node
    allNodes.push({
      id: -1,
      label: projectName,
      category: "project",
      importance: 5,
      x: cx,
      y: cy,
      _original: undefined, // center project node is display-only — never clicked
    });

    // Arrange connected nodes in a ring
    const connected: AnyNode[] = [...contextItems, ...memories];
    const outerR = Math.min(W, H) * 0.35;
    connected.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / connected.length - Math.PI / 2;
      allNodes.push({
        id: n.id,
        label: n.label,
        category: n.category,
        importance: n.importance,
        is_context: "is_context" in n ? true : undefined,
        x: cx + outerR * Math.cos(angle),
        y: cy + outerR * Math.sin(angle),
        _original: n,
      });
    });

    const nodeById = new Map(allNodes.map(n => [n.id, n]));

    // Draw links from project center to all connected nodes
    for (const n of allNodes) {
      if (n.id === -1) continue;
      g.append("line")
        .attr("x1", cx).attr("y1", cy)
        .attr("x2", n.x).attr("y2", n.y)
        .attr("stroke", "#374151")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", n.is_context ? "2,2" : "5,3");
    }

    // Draw memory-to-memory relation links
    for (const rel of relations) {
      const srcId = typeof rel.source === "number" ? rel.source : (rel.source as { id: number }).id;
      const tgtId = typeof rel.target === "number" ? rel.target : (rel.target as { id: number }).id;
      const src = nodeById.get(srcId);
      const tgt = nodeById.get(tgtId);
      if (src && tgt) {
        g.append("line")
          .attr("x1", src.x).attr("y1", src.y)
          .attr("x2", tgt.x).attr("y2", tgt.y)
          .attr("stroke", "#4b5563")
          .attr("stroke-width", 1);
      }
    }

    // Draw nodes
    for (const n of allNodes) {
      const isCenter = n.id === -1;
      const r = isCenter ? 22 : nodeRadius(n.importance, false, n.is_context);
      const nodeG = g.append("g")
        .style("cursor", isCenter ? "default" : "pointer");

      if (!isCenter && n._original) {
        nodeG.on("click", () => onNodeClick(n._original!));
      }

      nodeG.append("circle")
        .attr("cx", n.x).attr("cy", n.y)
        .attr("r", r)
        .attr("fill", nodeColor(n.category))
        .attr("stroke", "#1f2937")
        .attr("stroke-width", 1.5);

      if (isCenter) {
        // Acid-lime ring — the SECOND rationed use per spec §13.
        const lime = getComputedStyle(document.documentElement).getPropertyValue("--accent-lime").trim() || "#e4f222";
        nodeG.append("circle")
          .attr("cx", n.x).attr("cy", n.y)
          .attr("r", r + 5)
          .attr("fill", "none")
          .attr("stroke", lime)
          .attr("stroke-width", 2);
        nodeG.append("text")
          .attr("x", n.x).attr("y", n.y + 4)
          .attr("text-anchor", "middle")
          .attr("font-size", 9)
          .attr("fill", "#1f2937")
          .attr("font-weight", "bold")
          .text(n.label.substring(0, 8));
      }

      nodeG.append("title").text(`[${n.category}] ${n.label}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectName, memories, contextItems, relations]);

  return <svg ref={svgRef} className="w-full h-full bg-[#0d1117] rounded-lg" />;
}
