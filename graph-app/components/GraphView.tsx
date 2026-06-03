"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ClusterControls from "@/components/ClusterControls";
import ClusterPanel from "@/components/ClusterPanel";
import FilterBar from "@/components/FilterBar";
import NodeLegend from "@/components/NodeLegend";
import ProjectList from "@/components/ProjectList";
import Sidebar from "@/components/Sidebar";
import SpotlightModal from "@/components/SpotlightModal";
import StatsBar from "@/components/StatsBar";
import { api } from "@/lib/api";
import { useWebSocket } from "@/lib/useWebSocket";
import type { Cluster, GraphData, GraphLink, GraphNode, SearchResult, Stats, Tag } from "@/lib/types";
import type { GraphHandle } from "@/components/Graph";

// D3 uses browser APIs — must be dynamically imported (no SSR)
const Graph = dynamic(() => import("@/components/Graph"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-gray-600 text-sm">Loading graph…</div>
  ),
});

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:7331";

export default function GraphView() {
  const [data, setData] = useState<GraphData | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [importanceMin, setImportanceMin] = useState(1);
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [spotlightOpen, setSpotlightOpen] = useState(false);
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
  const graphRef = useRef<GraphHandle>(null);

  const loadClusters = useCallback(async () => {
    try {
      const cls = await api.clusters();
      setClusters(cls);
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
    const [g, s] = await Promise.all([api.graph(), api.stats()]);
    // Skip re-render if graph shape hasn't changed (prevents flicker from hook writes)
    const fingerprint = `${g.nodes.length}:${g.links.length}:${s.memories}`;
    if (fingerprint !== graphFingerprintRef.current) {
      graphFingerprintRef.current = fingerprint;
      setData(g);
      setStats(s);
    }
  }, []);

  // Tags change rarely — fetch once on mount, not on every WS refresh
  useEffect(() => { void api.tags().then(setTags); }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadClusters(); }, [loadClusters]);

  useWebSocket(WS_URL, load, loadClusters);

  // ⌘K / Ctrl+K opens spotlight
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSpotlightOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const toggleTag = useCallback((name: string) => {
    setActiveTags(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  // Compute dimmedIds: nodes that don't have any active tag
  const dimmedIds = useMemo((): Set<number> | undefined => {
    if (!activeTags.size || !data) return undefined;
    const dimmed = new Set<number>();
    for (const n of data.nodes) {
      if ("is_project" in n) continue; // never dim project nodes
      const hasMatch = n.tags.some(t => activeTags.has(t));
      if (!hasMatch) dimmed.add(n.id);
    }
    return dimmed;
  }, [data?.nodes, activeTags]);

  // Highlight nodes matching search results
  const highlightedIds = useMemo((): Set<number> | undefined => {
    if (!searchResults?.length) return undefined;
    return new Set(searchResults.map(r => r.id));
  }, [searchResults]);

  const filteredData = useMemo((): GraphData | null => {
    if (!data) return null;
    const searchIds = searchResults ? new Set(searchResults.map(r => r.id)) : null;

    const nodes = data.nodes.filter((n: GraphNode) => {
      if ("is_project" in n) return !hiddenProjects.has(n.label);
      if (n.project_scope && hiddenProjects.has(n.project_scope)) return false;
      if (activeProject && n.project_scope !== activeProject) return false;
      if (!("is_context" in n) && n.importance < importanceMin) return false;
      if (searchIds && !("is_project" in n) && !("is_context" in n) && !searchIds.has(n.id)) return false;
      return true;
    });

    const nodeIds = new Set(nodes.map((n: GraphNode) => n.id));
    const links = data.links.filter((l: GraphLink) => {
      const src = typeof l.source === "number" ? l.source : (l.source as GraphNode).id;
      const tgt = typeof l.target === "number" ? l.target : (l.target as GraphNode).id;
      return nodeIds.has(src) && nodeIds.has(tgt);
    });

    return { nodes, links };
  }, [data, activeProject, importanceMin, searchResults, hiddenProjects]);

  const nodeById = useMemo(() => {
    const map = new Map<number, GraphNode>();
    for (const n of data?.nodes ?? []) map.set(n.id, n);
    return map;
  }, [data?.nodes]);

  const handleSpotlightSelect = useCallback((result: SearchResult) => {
    graphRef.current?.zoomToNode(result.id);
    const node = nodeById.get(result.id);
    if (node) setSelected(node);
  }, [nodeById]);

  const handleRelationClick = useCallback((id: number) => {
    graphRef.current?.zoomToNode(id);
    const node = nodeById.get(id);
    if (node) setSelected(node);
  }, [nodeById]);

  const nodeLabelById = useCallback((id: number) => nodeById.get(id)?.label, [nodeById]);

  return (
    <div className="flex flex-col h-full">
      <StatsBar stats={stats} />
      <FilterBar
        onSearch={setSearchResults}
        onImportanceMin={setImportanceMin}
        importanceMin={importanceMin}
        onSpotlightOpen={() => setSpotlightOpen(true)}
        onSemanticSelect={handleRelationClick}
      />
      <div className="flex flex-1 overflow-hidden">
        <ProjectList
          nodes={data?.nodes ?? []}
          activeProject={activeProject}
          hiddenProjects={hiddenProjects}
          onSelect={setActiveProject}
          onToggleHide={toggleHideProject}
          tags={tags}
          activeTags={activeTags}
          onToggleTag={toggleTag}
          onClearAllTags={() => setActiveTags(new Set())}
        />
        <div className="flex-1 relative overflow-hidden">
          {!filteredData ? (
            <div className="flex items-center justify-center h-full text-gray-600 text-sm">
              Loading graph…
            </div>
          ) : filteredData.nodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-600">
              <p className="text-sm">All projects are hidden.</p>
              <button
                onClick={() => setHiddenProjects(() => {
                  localStorage.setItem("ltm_hidden_projects", "[]");
                  return new Set();
                })}
                className="text-xs text-sky-400 hover:underline"
              >
                Show all projects
              </button>
            </div>
          ) : (
            <>
              <Graph
                ref={graphRef}
                data={filteredData}
                activeProject={activeProject}
                dimmedIds={dimmedIds}
                highlightedIds={highlightedIds}
                clusters={clusters}
                showClusters={showClusters}
                onNodeClick={node => { setSelectedCluster(null); setSelected(node); }}
                onClusterClick={id => { setSelected(null); setSelectedCluster(clusters.find(c => c.id === id) ?? null); }}
              />
              <NodeLegend />
              {/* Graph toolbar — top-right corner */}
              <div className="absolute top-3 right-3 flex gap-1.5 bg-[var(--bg-secondary)]/80 backdrop-blur-sm border border-[var(--border)] rounded-lg p-1 items-center">
                <ClusterControls
                  showClusters={showClusters}
                  onToggle={val => { setShowClusters(val); localStorage.setItem("showClusters", String(val)); }}
                  onRecomputed={() => void loadClusters()}
                />
                <div className="w-px h-4 bg-[var(--border)]" />
                <button
                  onClick={() => graphRef.current?.fitToScreen()}
                  title="Fit to screen"
                  className="px-2 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
                >
                  ⊞ Fit
                </button>
                <button
                  onClick={() => graphRef.current?.resetSimulation()}
                  title="Reset simulation"
                  className="px-2 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
                >
                  ↺ Reset
                </button>
              </div>
            </>
          )}
        </div>
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

      <SpotlightModal
        open={spotlightOpen}
        onClose={() => setSpotlightOpen(false)}
        onSelect={handleSpotlightSelect}
      />
    </div>
  );
}
