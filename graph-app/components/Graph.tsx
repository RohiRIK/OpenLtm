"use client";
import { Component, forwardRef, useCallback, useEffect, useImperativeHandle, useRef, type MutableRefObject } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { ForceGraphMethods, NodeObject } from "react-force-graph-2d";
import { forceCollide, forceX, forceY } from "d3-force";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";

import { buildClusterForce } from "@/lib/clusterForce";
import { hullPoints } from "@/lib/convexHull";
import { nodeColor, NODE_COLORS, nodeRadius } from "@/lib/nodeColors";
import type { Cluster, GraphData, GraphNode } from "@/lib/types";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface GraphHandle {
  zoomToNode: (id: number) => void;
  fitToScreen: () => void;
  resetSimulation: () => void;
}

interface Props {
  data: GraphData;
  activeProject: string | null;
  dimmedIds?: Set<number>;
  highlightedIds?: Set<number>;
  clusters?: Cluster[];
  showClusters?: boolean;
  onNodeClick: (node: GraphNode) => void;
  onClusterClick?: (clusterId: string) => void;
  electricEffectsEnabled?: boolean;
}

// ─── Internal types ───────────────────────────────────────────────────────────

type FGNode = GraphNode & {
  clusterId?: string;
  x?: number; y?: number;
  vx?: number; vy?: number;
  fx?: number | undefined; fy?: number | undefined;
};

type GraphColors = {
  isDark: boolean;
  bg: string;
  linkStroke: string;
  labelFill: string;
  labelFillMuted: string;
  highlight: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Cinematic darkroom palette (inspired by monopo saigon): pure-black canvas so
// the category-colored nodes glow; achromatic chrome everywhere else.
function buildColors(isDark: boolean): GraphColors {
  return {
    isDark,
    bg: isDark ? "#000000" : "#f7f7f5",
    linkStroke: isDark ? "#1f1f1f" : "#d8d8d4",
    labelFill: isDark ? "#f5f5f3" : "#181818",
    labelFillMuted: isDark ? "#8a8a86" : "#6d6d6d",
    highlight: isDark ? "#a0e0ab" : "#1f8f4e",
  };
}

function populateTooltip(tip: HTMLDivElement, node: FGNode): void {
  while (tip.firstChild) tip.removeChild(tip.firstChild);
  const catColor = NODE_COLORS[node.category] ?? "#9ca3af";

  // Category row with colored dot
  const catRow = document.createElement("div");
  catRow.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:4px";
  const dot = document.createElement("span");
  dot.style.cssText = `display:inline-block;width:6px;height:6px;border-radius:50%;background:${catColor};flex-shrink:0`;
  catRow.appendChild(dot);
  const catLabel = document.createElement("span");
  catLabel.style.cssText = "color:#6c5f51;font-size:10px;text-transform:uppercase;letter-spacing:0.06em";
  catLabel.textContent = node.category;
  catRow.appendChild(catLabel);
  tip.appendChild(catRow);

  // Bold label
  const label = document.createElement("div");
  label.style.cssText = "color:#ffedd7;font-weight:700;font-size:12px;margin-bottom:4px";
  label.textContent = node.label;
  tip.appendChild(label);

  // Content preview (120 chars)
  const preview = document.createElement("div");
  preview.style.cssText = "color:#6c5f51;font-size:10px;line-height:1.5;margin-bottom:6px";
  preview.textContent = node.content.length > 120 ? node.content.substring(0, 119) + "…" : node.content;
  tip.appendChild(preview);

  // Footer row: importance stars + confidence %
  const footer = document.createElement("div");
  footer.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px";
  const stars = document.createElement("span");
  stars.style.cssText = "color:#dc5000;font-size:10px";
  stars.textContent = "★".repeat(node.importance) + "☆".repeat(Math.max(0, 5 - node.importance));
  footer.appendChild(stars);
  const conf = document.createElement("span");
  conf.style.cssText = "color:#6c5f51;font-size:10px";
  conf.textContent = `${Math.round((node.confidence ?? 1) * 100)}%`;
  footer.appendChild(conf);
  tip.appendChild(footer);
}

// ─── Error boundary ───────────────────────────────────────────────────────────

class GraphErrorBoundary extends Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-2 text-sm text-red-400">
          <span>Graph render error</span>
          <button
            className="text-xs text-sky-400 underline"
            onClick={() => this.setState({ error: null })}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Core graph component ─────────────────────────────────────────────────────

const Graph = forwardRef<GraphHandle, Props>(function Graph(
  { data, activeProject, dimmedIds, highlightedIds, clusters, showClusters = true, onNodeClick, onClusterClick, electricEffectsEnabled = true },
  ref
) {
  const { resolvedTheme } = useTheme();
  const router = useRouter();

  // Stable refs — updated from props/theme without causing re-renders
  const fgRef = useRef<ForceGraphMethods<FGNode> | undefined>(undefined);
  const colorsRef = useRef<GraphColors>(buildColors(true));
  const dimmedIdsRef = useRef<Set<number> | undefined>(undefined);
  const highlightedIdsRef = useRef<Set<number> | undefined>(undefined);
  const activeProjectRef = useRef<string | null>(null);
  const clustersRef = useRef<Cluster[]>([]);
  const showClustersRef = useRef(true);
  const nodesByIdRef = useRef<Map<number, FGNode>>(new Map());
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const hoveredRef = useRef<FGNode | null>(null);
  const hoverNeighborsRef = useRef<Set<number>>(new Set());
  const nodeAppearTimeRef = useRef<Map<number, number>>(new Map());
  const onNodeClickRef = useRef(onNodeClick);
  const onClusterClickRef = useRef(onClusterClick);

  // Keep callback refs fresh without recreating canvas callbacks
  useEffect(() => { onNodeClickRef.current = onNodeClick; }, [onNodeClick]);
  useEffect(() => { onClusterClickRef.current = onClusterClick; }, [onClusterClick]);
  useEffect(() => { colorsRef.current = buildColors(resolvedTheme !== "light"); }, [resolvedTheme]);
  useEffect(() => { dimmedIdsRef.current = dimmedIds; }, [dimmedIds]);
  useEffect(() => { highlightedIdsRef.current = highlightedIds; }, [highlightedIds]);
  useEffect(() => { clustersRef.current = clusters ?? []; }, [clusters]);
  useEffect(() => { showClustersRef.current = showClusters; }, [showClusters]);
  useEffect(() => { activeProjectRef.current = activeProject; }, [activeProject]);

  const electricEffectsRef = useRef(electricEffectsEnabled);
  useEffect(() => { electricEffectsRef.current = electricEffectsEnabled; }, [electricEffectsEnabled]);

  // Rebuild nodeById when data changes
  useEffect(() => {
    const map = new Map<number, FGNode>();
    for (const n of data.nodes) map.set(n.id, n as FGNode);
    nodesByIdRef.current = map;
  }, [data]);

  // Attach clusterId to node objects + update cluster force
  useEffect(() => {
    const clusterMap = new Map<number, string>();
    if (showClusters && clusters?.length) {
      for (const cl of clusters) {
        for (const nid of cl.node_ids) clusterMap.set(nid, cl.id);
      }
    }
    for (const n of data.nodes) {
      (n as FGNode).clusterId = clusterMap.get(n.id);
    }
    fgRef.current?.d3Force("cluster", buildClusterForce(clusters ?? [], showClusters));
  }, [clusters, showClusters, data.nodes]);

  // Configure D3 forces — Obsidian-style layout
  // Key insight: forceX/forceY pull EVERY node toward center individually (gravity),
  // while forceCenter only shifts the centroid. This keeps disconnected subgraphs
  // from flying apart.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    // Charge — moderate repulsion so nodes don't overlap but stay close
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const charge = fg.d3Force("charge") as any;
    charge?.strength(-80).distanceMax(200);  // cap repulsion range so far-away nodes don't push

    // Links — short distances, strong pull to form tight clusters
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const link = fg.d3Force("link") as any;
    link?.distance((l: { type?: string }) => {
      if (l.type === "context_of") return 30;
      if (l.type === "project_scope") return 50;
      return 40;
    }).strength((l: { type?: string }) => {
      if (l.type === "context_of") return 0.3;
      if (l.type === "project_scope") return 0.5;
      return 0.6;
    });

    // Collision — just enough to prevent overlap
    fg.d3Force(
      "collision",
      forceCollide<FGNode>().radius(n => nodeRadius(n.importance, "is_project" in n, "is_context" in n) + 2)
    );
    fg.d3Force("cluster", buildClusterForce(clusters ?? [], showClusters));

    // Gravity — pull every node toward center (this is what Obsidian uses)
    // Unlike forceCenter, this applies force to EACH node, keeping islands together
    const canvas = (fg as unknown as { canvas?: HTMLCanvasElement }).canvas;
    const w = canvas?.width ?? 800;
    const h = canvas?.height ?? 600;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fg.d3Force("gravityX", forceX(w / 2).strength(0.08) as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fg.d3Force("gravityY", forceY(h / 2).strength(0.08) as any);
    // Remove the old center force if it exists
    fg.d3Force("center", null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Mount/unmount tooltip div
  useEffect(() => {
    const tip = document.createElement("div");
    tip.style.cssText = [
      "position:fixed", "visibility:hidden", "pointer-events:none",
      "z-index:9999", "max-width:280px", "border-radius:12px",
      "padding:10px 12px", "font-size:11px", "line-height:1.5",
      "background:#100904", "border:1px solid #40372e",
      "font-family:var(--font-inter),sans-serif",
    ].join(";");
    document.body.appendChild(tip);
    tooltipRef.current = tip;
    return () => { tip.remove(); tooltipRef.current = null; };
  }, []);

  // ── Imperative handle ──────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    zoomToNode(id: number): void {
      const node = nodesByIdRef.current.get(id);
      if (node?.x != null && node?.y != null) {
        fgRef.current?.centerAt(node.x, node.y, 600);
        fgRef.current?.zoom(1.5, 600);
      }
    },
    fitToScreen(): void {
      fgRef.current?.zoomToFit(400, 40);
    },
    resetSimulation(): void {
      fgRef.current?.d3ReheatSimulation();
    },
  }), []);

  // ── Canvas callbacks (stable — read from refs) ─────────────────────────────

  const paintNode = useCallback((nodeObj: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number): void => {
    const node = nodeObj as FGNode;
    const colors = colorsRef.current;
    const isProject = "is_project" in node;
    const isContext = "is_context" in node;
    const r = nodeRadius(node.importance ?? 1, isProject, isContext);
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const color = nodeColor(node.category);
    const isHoverActive = hoverNeighborsRef.current.size > 0;
    const isHoverNeighbor = isHoverActive && hoverNeighborsRef.current.has(node.id);
    const dimmed = (dimmedIdsRef.current?.has(node.id) ?? false) || (isHoverActive && !isHoverNeighbor);
    const highlighted = (highlightedIdsRef.current?.has(node.id) ?? false) || (isHoverActive && node.id === hoveredRef.current?.id);
    const inActiveProject = !!activeProjectRef.current && (node as GraphNode).project_scope === activeProjectRef.current;

    ctx.save();

    // Fade-in entrance animation (600ms)
    const appearMap = nodeAppearTimeRef.current;
    if (!appearMap.has(node.id)) appearMap.set(node.id, Date.now());
    const fadeAlpha = Math.min(1, (Date.now() - appearMap.get(node.id)!) / 600);

    ctx.globalAlpha = (dimmed ? 0.10 : 1) * fadeAlpha;

    // Premium Glow / Aura based on importance
    if (electricEffectsRef.current) {
      if (isProject || highlighted) {
        ctx.shadowBlur = highlighted ? 30 : 16;
        ctx.shadowColor = highlighted ? colors.highlight : color;
      } else if (colors.isDark) {
        ctx.shadowBlur = (node.importance || 1) * 4;
        ctx.shadowColor = color;
      }
    } else {
      ctx.shadowBlur = 0;
    }

    // Circle
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.globalAlpha = (dimmed ? 0.15 : isProject ? 1 : 0.85) * fadeAlpha;
    ctx.fill();

    // Stroke
    if (isProject || highlighted || inActiveProject) {
      ctx.strokeStyle = highlighted ? colors.highlight : inActiveProject ? colors.labelFill : color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.shadowBlur = 0;
    ctx.globalAlpha = (dimmed ? 0.15 : 1) * fadeAlpha;

    // Labels
    ctx.textAlign = "center";
    if (isProject) {
      ctx.font = "600 8px sans-serif";
      ctx.fillStyle = color;
      ctx.fillText(node.label.length > 14 ? node.label.substring(0, 13) + "…" : node.label, x, y + r + 9);
    } else if (!isContext) {
      // Only show labels when heavily zoomed in or if it's the specific node being hovered/spotlighted
      const isSpotlighted = isHoverActive && (hoveredRef.current?.id === node.id || hoverNeighborsRef.current.has(node.id));
      
      const important = (node.importance ?? 1) >= 4;
      if (isSpotlighted || (important && globalScale > 1.8)) {
        ctx.font = "7px sans-serif";
        ctx.fillStyle = colors.labelFill;
        ctx.fillText(node.label.length > 18 ? node.label.substring(0, 17) + "…" : node.label, x, y + r + 7);
      } else if (globalScale > 3.0) {
        const labelAlpha = Math.min(1, (globalScale - 3.0) / 0.5);
        ctx.globalAlpha = dimmed ? 0.15 * labelAlpha : labelAlpha;
        ctx.font = "6px sans-serif";
        ctx.fillStyle = colors.labelFillMuted;
        ctx.fillText(node.label.length > 16 ? node.label.substring(0, 15) + "…" : node.label, x, y + r + 7);
      }
    }

    ctx.restore();
  }, []);

  const paintLink = useCallback((linkObj: unknown, ctx: CanvasRenderingContext2D): void => {
    const link = linkObj as { source: FGNode; target: FGNode; type?: string };
    const sx = link.source?.x ?? 0, sy = link.source?.y ?? 0;
    const tx = link.target?.x ?? 0, ty = link.target?.y ?? 0;
    const colors = colorsRef.current;
    
    const isHoverActive = hoverNeighborsRef.current.size > 0;
    const isNeighborLink = isHoverActive && (hoveredRef.current?.id === link.source.id || hoveredRef.current?.id === link.target.id);
    const dimmed = isHoverActive && !isNeighborLink;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.strokeStyle = isNeighborLink ? colors.highlight : colors.linkStroke;
    ctx.lineWidth = link.type === "project_scope" ? 1.5 : isNeighborLink ? 1.2 : 0.8;
    ctx.globalAlpha = dimmed ? 0.1 : (isNeighborLink ? 0.9 : 0.4);
    if (link.type === "context_of") ctx.setLineDash([2, 2]);
    ctx.stroke();
    ctx.restore();
  }, []);

  // Draw cluster hulls BEFORE nodes (so they appear behind)
  const drawClusterHulls = useCallback((ctx: CanvasRenderingContext2D): void => {
    if (!showClustersRef.current) return;
    const cls = clustersRef.current;
    if (!cls.length) return;
    const nodesById = nodesByIdRef.current;

    for (const cluster of cls) {
      const pts: [number, number][] = [];
      for (const nid of cluster.node_ids) {
        const n = nodesById.get(nid);
        if (n?.x != null && n?.y != null) pts.push([n.x, n.y]);
      }
      if (!pts.length) continue;
      const hull = hullPoints(pts, 18);
      if (!hull || hull.length < 2) continue;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(hull[0][0], hull[0][1]);
      for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i][0], hull[i][1]);
      ctx.closePath();
      ctx.fillStyle = cluster.color + "15";
      ctx.strokeStyle = cluster.color + "60";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }, []);

  const handleNodeClick = useCallback((nodeObj: NodeObject): void => {
    const node = nodeObj as FGNode;
    if ("is_project" in node) {
      router.push(`/project/${encodeURIComponent(node.label)}`);
    } else {
      onNodeClickRef.current(node as GraphNode);
    }
  }, [router]);

  const handleNodeHover = useCallback((nodeObj: NodeObject | null): void => {
    hoveredRef.current = nodeObj as FGNode | null;
    
    // Spotlight focus effect - compute neighbors
    if (nodeObj) {
      const neighbors = new Set<number>();
      const fgNode = nodeObj as FGNode;
      neighbors.add(fgNode.id);
      
      // Calculate 1st degree neighbors for the spotlight effect
      data.links.forEach((l: any) => {
        const src = typeof l.source === 'object' ? l.source.id : l.source;
        const tgt = typeof l.target === 'object' ? l.target.id : l.target;
        if (src === fgNode.id) neighbors.add(tgt);
        if (tgt === fgNode.id) neighbors.add(src);
      });
      hoverNeighborsRef.current = neighbors;
    } else {
      hoverNeighborsRef.current.clear();
    }
    
    const tip = tooltipRef.current;
    if (!tip) return;
    if (nodeObj) {
      const node = nodeObj as FGNode;
      populateTooltip(tip, node);
      tip.style.left = `${mouseRef.current.x + 14}px`;
      tip.style.top = `${mouseRef.current.y - 10}px`;
      tip.style.visibility = "visible";
    } else {
      tip.style.visibility = "hidden";
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent): void => {
    mouseRef.current = { x: e.clientX, y: e.clientY };
    if (hoveredRef.current && tooltipRef.current) {
      tooltipRef.current.style.left = `${e.clientX + 14}px`;
      tooltipRef.current.style.top = `${e.clientY - 10}px`;
    }
  }, []);

  return (
    <GraphErrorBoundary>
      <div
        className="w-full h-full"
        onMouseMove={handleMouseMove}
        role="img"
        aria-label="LTM memory graph"
      >
        <ForceGraph2D
          ref={fgRef as MutableRefObject<ForceGraphMethods<FGNode> | undefined>}
          graphData={data as unknown as { nodes: FGNode[]; links: object[] }}
          backgroundColor={colorsRef.current.bg}
          nodeCanvasObject={paintNode}
          nodeCanvasObjectMode={() => "replace"}
          linkCanvasObject={paintLink}
          linkCanvasObjectMode={() => "replace"}
          linkDirectionalParticles={(link: any) => {
             if (!electricEffectsRef.current) return 0;
             const isHoverActive = hoverNeighborsRef.current.size > 0;
             if (isHoverActive) {
                const src = link.source.id;
                const tgt = link.target.id;
                if (hoveredRef.current?.id === src || hoveredRef.current?.id === tgt) return 3;
                return 0;
             }
             return (link.type === "project_scope" || link.type === "reasoning") ? 2 : 0;
          }}
          linkDirectionalParticleWidth={2.5}
          linkDirectionalParticleSpeed={0.006}
          linkDirectionalParticleColor={() => colorsRef.current.highlight}
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          onRenderFramePre={drawClusterHulls}
          d3AlphaDecay={0.05}
          cooldownTicks={150}
          autoPauseRedraw={false}
        />
      </div>
    </GraphErrorBoundary>
  );
});

export default Graph;
