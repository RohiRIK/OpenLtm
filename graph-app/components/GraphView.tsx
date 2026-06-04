"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SlidersHorizontal, Maximize2, RotateCcw, X, Zap, ZapOff, Search } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ClusterControls from "@/components/ClusterControls";
import ClusterPanel from "@/components/ClusterPanel";
import NodeLegend from "@/components/NodeLegend";
import Sidebar from "@/components/Sidebar";
import FilterRail from "@/components/graph/FilterRail";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { useWebSocket } from "@/lib/useWebSocket";
import { cn } from "@/lib/utils";
import type { Cluster, GraphData, GraphLink, GraphNode, Tag } from "@/lib/types";
import type { GraphHandle } from "@/components/Graph";

// D3 uses browser APIs — must be dynamically imported (no SSR)
const Graph = dynamic(() => import("@/components/Graph"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading graph…</div>
  ),
});

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:7331";

export default function GraphView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<GraphData | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeProject, setActiveProject] = useState<string | null>(() => searchParams.get("project") ?? null);
  const [importanceMin, setImportanceMin] = useState(() => {
    const p = searchParams.get("importance");
    return p ? Math.max(1, Math.min(5, Number(p))) : 1;
  });
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [hiddenProjects, setHiddenProjects] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try { return new Set(JSON.parse(localStorage.getItem("ltm_hidden_projects") ?? "[]")); }
    catch { return new Set(); }
  });
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [showClusters, setShowClusters] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem("showClusters");
    return saved === null ? true : saved === "true";
  });
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null);
  const [electricEffectsEnabled, setElectricEffectsEnabled] = useState<boolean>(() => {
    const p = searchParams.get("electric");
    if (p !== null) return p === "true";
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem("ltm_electric_effects");
    return saved === null ? true : saved === "true";
  });
  const graphRef = useRef<GraphHandle>(null);

  const loadClusters = useCallback(async () => {
    try {
      setClusters(await api.clusters());
    } catch {
      // clusters may not exist yet — ignore
    }
  }, []);

  const toggleHideProject = useCallback((name: string) => {
    setHiddenProjects(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      localStorage.setItem("ltm_hidden_projects", JSON.stringify([...next]));
      return next;
    });
  }, []);

  const graphFingerprintRef = useRef<string>("");
  const load = useCallback(async () => {
    const g = await api.graph();
    const fingerprint = `${g.nodes.length}:${g.links.length}`;
    if (fingerprint !== graphFingerprintRef.current) {
      graphFingerprintRef.current = fingerprint;
      setData(g);
    }
  }, []);

  useEffect(() => { void api.tags().then(setTags); }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadClusters(); }, [loadClusters]);

  useWebSocket(WS_URL, load, loadClusters);

  const toggleTag = useCallback((name: string) => {
    setActiveTags(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  // Sync state → URL search params
  useEffect(() => {
    const params = new URLSearchParams();
    if (activeProject) params.set("project", activeProject);
    if (importanceMin > 1) params.set("importance", String(importanceMin));
    if (!electricEffectsEnabled) params.set("electric", "false");
    const qs = params.toString();
    const target = qs ? `?${qs}` : window.location.pathname;
    if (target !== `${window.location.pathname}${window.location.search}`) {
      router.replace(target, { scroll: false });
    }
  }, [activeProject, importanceMin, electricEffectsEnabled, router]);

  // Search → highlightedIds for graph dimming
  const highlightedIds = useMemo((): Set<number> | undefined => {
    if (!searchQuery.trim() || !data) return undefined;
    const q = searchQuery.trim().toLowerCase();
    const ids = new Set<number>();
    for (const n of data.nodes) {
      if (n.label.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)) {
        ids.add(n.id);
      }
    }
    return ids.size > 0 ? ids : undefined;
  }, [searchQuery, data]);

  // Dim nodes that don't carry any active tag
  const dimmedIds = useMemo((): Set<number> | undefined => {
    if (!activeTags.size || !data) return undefined;
    const dimmed = new Set<number>();
    for (const n of data.nodes) {
      if ("is_project" in n) continue;
      if (!n.tags.some(t => activeTags.has(t))) dimmed.add(n.id);
    }
    return dimmed;
  }, [data?.nodes, activeTags]);

  const filteredData = useMemo((): GraphData | null => {
    if (!data) return null;
    const nodes = data.nodes.filter((n: GraphNode) => {
      if ("is_project" in n) return !hiddenProjects.has(n.label);
      if (n.project_scope && hiddenProjects.has(n.project_scope)) return false;
      if (activeProject && n.project_scope !== activeProject) return false;
      if (!("is_context" in n) && n.importance < importanceMin) return false;
      return true;
    });
    const nodeIds = new Set(nodes.map((n: GraphNode) => n.id));
    const links = data.links.filter((l: GraphLink) => {
      const src = typeof l.source === "number" ? l.source : (l.source as GraphNode).id;
      const tgt = typeof l.target === "number" ? l.target : (l.target as GraphNode).id;
      return nodeIds.has(src) && nodeIds.has(tgt);
    });
    return { nodes, links };
  }, [data, activeProject, importanceMin, hiddenProjects]);

  const nodeById = useMemo(() => {
    const map = new Map<number, GraphNode>();
    for (const n of data?.nodes ?? []) map.set(n.id, n);
    return map;
  }, [data?.nodes]);

  const handleRelationClick = useCallback((id: number) => {
    graphRef.current?.zoomToNode(id);
    const node = nodeById.get(id);
    if (node) setSelected(node);
  }, [nodeById]);

  const nodeLabelById = useCallback((id: number) => nodeById.get(id)?.label, [nodeById]);

  const allHidden = filteredData?.nodes.length === 0 && (data?.nodes.length ?? 0) > 0;

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      {/* Canvas layer */}
      <div className="absolute inset-0">
        {!filteredData ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Loading graph…
          </div>
        ) : allHidden ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <p className="text-sm">All projects are hidden.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHiddenProjects(() => {
                localStorage.setItem("ltm_hidden_projects", "[]");
                return new Set();
              })}
            >
              Show all projects
            </Button>
          </div>
        ) : (
          <Graph
            ref={graphRef}
            data={filteredData}
            activeProject={activeProject}
            dimmedIds={dimmedIds}
            highlightedIds={highlightedIds}
            clusters={clusters}
            showClusters={showClusters}
            electricEffectsEnabled={electricEffectsEnabled}
            onNodeClick={node => { setSelectedCluster(null); setSelected(node); }}
            onClusterClick={id => { setSelected(null); setSelectedCluster(clusters.find(c => c.id === id) ?? null); }}
          />
        )}
      </div>

      {/* Legend (token-based overlay) */}
      <NodeLegend />

      {/* Floating toolbar — top-right */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="absolute top-5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 rounded-full border border-white/10 bg-black/40 p-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-xl ring-1 ring-white/5 supports-[backdrop-filter]:bg-black/20"
      >
        <Button
          variant={filtersOpen ? "secondary" : "ghost"}
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => setFiltersOpen(o => !o)}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters
        </Button>
        <Separator orientation="vertical" className="h-4" />
        <ClusterControls
          showClusters={showClusters}
          onToggle={val => { setShowClusters(val); localStorage.setItem("showClusters", String(val)); }}
          onRecomputed={() => void loadClusters()}
        />
        <Separator orientation="vertical" className="h-4" />
        <Button 
          variant={electricEffectsEnabled ? "secondary" : "ghost"} 
          size="icon" 
          className="h-7 w-7 text-yellow-500 hover:text-yellow-400" 
          title={electricEffectsEnabled ? "Disable electric effects" : "Enable electric effects"} 
          onClick={() => {
            const next = !electricEffectsEnabled;
            setElectricEffectsEnabled(next);
            localStorage.setItem("ltm_electric_effects", String(next));
          }}
        >
          {electricEffectsEnabled ? <Zap className="h-3.5 w-3.5 fill-current" /> : <ZapOff className="h-3.5 w-3.5" />}
        </Button>
        <Separator orientation="vertical" className="h-4" />
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Fit to screen" onClick={() => graphRef.current?.fitToScreen()}>
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Reset simulation" onClick={() => graphRef.current?.resetSimulation()}>
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </motion.div>

      {/* Filter panel — floating left, non-modal so the graph updates live */}
      <AnimatePresence>
        {filtersOpen && (
          <motion.div
            initial={{ opacity: 0, x: -20, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -20, scale: 0.95 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="absolute top-5 left-5 z-10 flex w-[320px] flex-col rounded-2xl border border-white/10 bg-black/40 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-xl max-h-[calc(100%-2.5rem)] pointer-events-auto ring-1 ring-white/5 overflow-hidden"
          >
            <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-5 py-3">
              <span className="text-sm font-semibold text-white tracking-wide">Filters</span>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-white/70 hover:text-white hover:bg-white/10 rounded-full" onClick={() => setFiltersOpen(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="overflow-y-auto px-4 pb-4">
              <FilterRail
                nodes={data?.nodes ?? []}
                importanceMin={importanceMin}
                onImportanceMin={setImportanceMin}
                activeProject={activeProject}
                hiddenProjects={hiddenProjects}
                onSelectProject={setActiveProject}
                onToggleHide={toggleHideProject}
                tags={tags}
                activeTags={activeTags}
                onToggleTag={toggleTag}
                onClearTags={() => setActiveTags(new Set())}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Inspector / cluster panel — floating right, non-modal */}
      <div className="absolute top-5 right-5 z-20 flex h-[calc(100%-2.5rem)]">
        {selectedCluster ? (
          <ClusterPanel
            cluster={selectedCluster}
            onClose={() => setSelectedCluster(null)}
            onUpdated={() => void loadClusters()}
          />
        ) : (
          <Sidebar
            node={selected}
            onClose={() => setSelected(null)}
            onRelationClick={handleRelationClick}
            nodeLabelById={nodeLabelById}
            onUpdated={() => void load()}
          />
        )}
      </div>
      {/* Search-to-focus — floating bottom center */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10">
        <div className="flex items-center gap-2">
          <Search className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search nodes…"
            className="bg-transparent text-sm outline-none"
            style={{
              color: 'var(--text-primary)',
              borderBottom: '1px solid #ffedd7',
              borderRadius: 0,
              padding: '4px 0',
              width: 220,
              fontFamily: 'var(--font-inter), sans-serif',
            }}
          />
        </div>
      </div>
    </div>
  );
}
