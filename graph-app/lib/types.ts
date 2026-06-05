export interface MemoryNode {
  id: number;
  label: string;
  content: string;
  category: string;
  importance: number;
  confidence: number;
  confirm_count: number;
  source: string | null;
  dedup_key: string | null;
  last_confirmed_at: string;
  project_scope: string | null;
  created_at: string;
  tags: string[];
  relevance_signal?: RelevanceSignal | null;
  relevance_signal_at?: string | null;
}

export type RelevanceSignal = "works" | "doesnt";

export interface ContextNode {
  id: number;
  label: string;
  content: string;
  category: string; // "goal" | "decision" | "gotcha" | "progress"
  importance: number;
  confidence: number;
  confirm_count: number;
  project_scope: string | null;
  session_id: string | null;
  permanent: boolean;
  created_at: string;
  tags: string[];
  is_context: true;
}

export interface ProjectNode {
  id: number;
  label: string;
  content: string;
  category: "project";
  importance: number;
  confidence: number;
  confirm_count: number;
  project_scope: null;
  created_at: string;
  tags: string[];
  is_project: true;
}

export type GraphNode = MemoryNode | ContextNode | ProjectNode;

export interface GraphLink {
  source: number | GraphNode;
  target: number | GraphNode;
  type: string;
  relation_id?: number;
  created_at?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface Stats {
  memories: number;
  relations: number;
  projects: number;
  context_items: number;
  tags: number;
  pending: number;
  by_category: Record<string, number>;
  by_project: Record<string, number>;
}

export interface Capabilities {
  vec: boolean;
  honker: boolean;
}

export interface Tag {
  id: number;
  name: string;
  memory_count: number;
}

export interface MemoryDetail extends MemoryNode {
  relations: Array<{ relation_id: number; related_id: number; type: string; direction: string }>;
}

export interface SearchResult {
  id: number;
  content: string;
  category: string;
  importance: number;
  project_scope: string | null;
}

export interface FtsResult {
  id: number;
  content: string;
  title: string | null;
  category: string;
  importance: number;
  project_scope: string | null;
  type: "memory" | "context";
}

export interface CtxItem {
  content: string;
  created_at: string;
}

export interface ProjectDetail {
  name: string;
  context: Record<string, CtxItem[]>;
  memories: MemoryNode[];
  context_items: ContextNode[];
  relations: GraphLink[];
}

// Phase 2: Janitor types

export interface PendingMemory {
  id: number;
  content: string;
  category: string;
  importance: number;
  confidence: number;
  project_scope: string | null;
  source: string | null;
  created_at: string;
}

export interface JanitorStatus {
  running: boolean;
  lastRun: string | null;
  lastResult: JanitorRunResult | null;
  intervalMinutes: number;
  nextRun: string | null;
}

export interface JanitorRunResult {
  timestamp: string;
  durationMs: number;
  embed: { embedded: number };
  decay: { decayed: number; deprecated: number; scanned: number };
  promote: { promoted: number; skipped: number; scanned: number };
  dedup: { pairsCompared: number; candidatesFound: number };
  errors: string[];
}

export interface SettingsModels {
  embeddingProviders: string[];
  llmProviders: string[];
  embedModels: Record<string, string[]>;
  llmModels: Record<string, string[]>;
  defaults: Record<string, string>;
}

// Phase 3 types

export interface SemanticResult {
  id: number;
  content: string;
  category: string;
  importance: number;
  project_scope: string | null;
  similarity: number;
}

export interface SimilarResult {
  id: number;
  content: string;
  similarity: number;
}

export interface HealthAtRisk {
  id: number;
  content: string;
  category: string;
  confidence: number;
  project_scope: string | null;
}

export interface HealthDistribution {
  bucket: number;
  count: number;
}

export interface HealthStatusCount {
  status: string;
  count: number;
}

export interface HealthData {
  atRisk: HealthAtRisk[];
  distribution: HealthDistribution[];
  stats: HealthStatusCount[];
  avgConf: number;
}

// Phase 5: Superseded memories
export interface SupersededMemory {
  id: number;
  content: string;
  category: string;
  project_scope: string | null;
  confidence: number;
  created_at: string;
}

// Claude config.json types
export interface ClaudeLtmConfig {
  graphReasoning: boolean;
  autoRelate: boolean;
  decayEnabled: boolean;
  injectTopN: number;
}

export interface ClaudeConfig {
  ltm: ClaudeLtmConfig;
}

// Graph Reasoning types

export interface ReasoningMemoryNode {
  id: number;
  content: string;
  category: string;
  importance: number;
  project_scope: string | null;
}

export interface ReasoningPair {
  a: ReasoningMemoryNode;
  b: ReasoningMemoryNode;
  type: string;
}

export interface ReasoningResult {
  chain: ReasoningMemoryNode[];
  conflicts: ReasoningPair[];
  reinforcements: ReasoningPair[];
  clusters: number[][];
  inferred: Array<ReasoningPair & { persisted: boolean }>;
}

export interface ReasoningSearchResult {
  seedId?: number;
  insights: string | null;
  reason?: string;
  chain: number;
  conflicts: number;
  reinforcements: number;
}

// Cluster detection
export interface Cluster {
  id: string;
  label: string;
  color: string;
  node_ids: number[];
  created_at: string;
  updated_at: string;
}

// Config Explorer
export interface SkillEntry {
  name: string;
  description: string;
  slashCommand?: string;
  triggerPhrases: string[];
  workflows: string[];
  path: string;
}

export interface AgentEntry {
  name: string;
  description: string;
  whenToUse: string;
  path: string;
}

export interface HookEntry {
  event: string;
  matcher?: string;
  description: string;
}

export interface RuleEntry {
  name: string;
  summary: string;
  content: string;
  path: string;
}

export interface ConfigExplorerData {
  skills: SkillEntry[];
  agents: AgentEntry[];
  hooks: HookEntry[];
  rules: RuleEntry[];
}

// Phase 4: Project Health Score

export type ProjectHealthStatus = "healthy" | "needs_attention" | "neglected";

export interface ProjectHealthMetrics {
  memoryFreshness: number;  // 0–1: % memories accessed in last 30 days
  avgConfidence: number;    // 0–1: average confidence of active memories
  contextCoverage: number;  // 0–1: presence of goal/decision/gotcha/progress items
  sessionActivity: number;  // 0–1: any memory accessed in last 14 days
}

export interface ProjectHealthScore {
  project: string;
  score: number;                // 0–100 weighted composite
  status: ProjectHealthStatus;
  metrics: ProjectHealthMetrics;
  memoryCount: number;
  staleCount: number;           // memories not accessed in 30+ days
  contextItemCount: number;
  lastActivityAt: string | null;
}

export interface HealthHistoryPoint {
  date: string;                 // ISO date (YYYY-MM-DD)
  score: number;                // 0–100
}

export interface HealthHistory {
  project: string;
  points: HealthHistoryPoint[]; // 30 entries, oldest first
  current: number;              // current score
}
