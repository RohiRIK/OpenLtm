import type {
  Capabilities,
  ClaudeConfig,
  ClaudeLtmConfig,
  Cluster,
  ConfigExplorerData,
  CtxItem,
  FtsResult,
  GraphData,
  HealthData,
  JanitorRunResult,
  JanitorStatus,
  MemoryDetail,
  PendingMemory,
  ProjectDetail,
  ProjectHealthScore,
  ReasoningResult,
  RelevanceSignal,
  ReasoningSearchResult,
  SearchResult,
  SemanticResult,
  SettingsModels,
  SimilarResult,
  Stats,
  SupersededMemory,
  Tag,
} from "./types";

const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  // Backend capability probe — degrades gracefully if the route is absent
  // (older servers without sqlite-vec / Honker) so the UI never hard-crashes.
  capabilities: async (): Promise<Capabilities> => {
    try {
      return await get<Capabilities>("/capabilities");
    } catch {
      return { vec: false, honker: false };
    }
  },

  // Existing routes
  graph: (): Promise<GraphData> => get("/graph"),
  stats: (): Promise<Stats> => get("/stats"),
  tags: (): Promise<Tag[]> => get("/tags"),
  memory: (id: number): Promise<MemoryDetail> => get(`/memory/${id}`),
  search: (q: string): Promise<SearchResult[]> =>
    get(`/search?q=${encodeURIComponent(q)}`),
  searchAll: (q: string): Promise<FtsResult[]> =>
    get(`/search/all?q=${encodeURIComponent(q)}`),
  context: (project: string): Promise<Record<string, CtxItem[]>> =>
    get(`/context/${encodeURIComponent(project)}`),
  project: (name: string): Promise<ProjectDetail> =>
    get(`/project/${encodeURIComponent(name)}`),
  reload: async (): Promise<void> => {
    await fetch(`${BASE}/reload`, { method: "POST" });
  },

  // Phase 2: Settings
  getSettings: (): Promise<Record<string, string>> => get("/settings"),
  updateSettings: (settings: Record<string, string>): Promise<{ ok: boolean }> =>
    put("/settings", settings),
  verifyProvider: (): Promise<{ ok: boolean; error?: string }> =>
    post("/settings/verify"),
  getModels: (): Promise<SettingsModels> => get("/settings/models"),

  // Phase 2: Janitor
  janitorStatus: (): Promise<JanitorStatus> => get("/janitor/status"),
  runJanitor: (): Promise<JanitorRunResult> => post("/janitor/run"),

  // Phase 2: Pending memories
  pending: (): Promise<PendingMemory[]> => get("/pending"),
  approveMemory: (id: number): Promise<{ ok: boolean }> =>
    post(`/memory/${id}/approve`),
  deleteMemory: (id: number): Promise<{ ok: boolean }> =>
    del(`/memory/${id}`),
  deleteContextItem: (id: number): Promise<{ ok: boolean }> =>
    del(`/context-item/${id}`),
  updateMemory: (id: number, patch: { content?: string; tags?: string[]; importance?: number }): Promise<{ ok: boolean }> =>
    put(`/memory/${id}`, patch),
  setRelevance: (id: number, signal: RelevanceSignal | null): Promise<{ ok: boolean }> =>
    put(`/memory/${id}/relevance`, { signal }),
  supersedeMemory: (newId: number, oldId: number): Promise<{ ok: boolean }> =>
    post(`/memory/${newId}/supersedes/${oldId}`),
  mergeMemories: (
    keepId: number,
    supersededId: number,
    mergedContent?: string,
  ): Promise<{ ok: boolean }> =>
    post("/memory/merge", { keepId, supersededId, mergedContent }),

  // Phase 3: Semantic search
  semanticSearch: (query: string, limit = 10, minSimilarity = 0.5): Promise<SemanticResult[]> =>
    post("/search/semantic", { query, limit, minSimilarity }),

  // sqlite-vec KNN: nearest neighbours of an existing memory
  findSimilar: (id: number, limit = 8, minSimilarity = 0.5): Promise<SimilarResult[]> =>
    get(`/memory/${id}/similar?limit=${limit}&minSimilarity=${minSimilarity}`),

  // Phase 3: Dedup merge-all
  mergeAll: (minSimilarity?: number): Promise<{ merged: number; skipped: number }> =>
    post("/dedup/merge-all", { minSimilarity }),

  // Phase 3: Health dashboard
  health: (): Promise<HealthData> => get("/health"),
  boostMemory: (id: number): Promise<{ ok: boolean }> => post(`/memory/${id}/boost`),

  // Phase 4: Project Health Score
  projectHealth: (): Promise<ProjectHealthScore[]> => get("/health/projects"),

  // Phase 5: Superseded memories
  supersededMemories: (): Promise<SupersededMemory[]> => get("/health/superseded"),

  // Graph Reasoning
  reasoning: (id: number, depth = 2): Promise<ReasoningResult> =>
    get(`/reasoning/${id}?depth=${depth}`),
  reasoningSearch: (q: string, depth = 2): Promise<ReasoningSearchResult> =>
    get(`/reasoning/search?q=${encodeURIComponent(q)}&depth=${depth}`),

  // Claude config.json
  getConfig: (): Promise<ClaudeConfig> => get("/config"),
  updateConfig: (ltmPatch: Partial<ClaudeLtmConfig>): Promise<{ ok: boolean }> =>
    put("/config", { ltm: ltmPatch }),

  // Cluster detection
  clusters: (): Promise<Cluster[]> => get("/clusters"),
  recomputeClusters: (): Promise<{ ok: boolean }> => post("/clusters/recompute"),
  renameCluster: (id: string, label: string): Promise<{ ok: boolean }> =>
    put(`/clusters/${encodeURIComponent(id)}/label`, { label }),
  mergeClusters: (sourceId: string, targetId: string): Promise<{ ok: boolean }> =>
    post("/clusters/merge", { sourceId, targetId }),
  splitCluster: (id: string, nodeIds1: number[], nodeIds2: number[]): Promise<{ ok: boolean }> =>
    post(`/clusters/${encodeURIComponent(id)}/split`, { nodeIds1, nodeIds2 }),

  // Config Explorer
  configExplorer: (): Promise<ConfigExplorerData> => get("/config-explorer"),
};
