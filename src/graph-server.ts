/**
 * server.ts — LTM Graph Visualization Server
 * Bun.serve() on port 7331 with WebSocket live-reload and fs.watch DB change detection.
 * Phase 2: includes janitor routes (settings, pending, approve, dedup, decay).
 */
import type { SQLQueryBindings } from "bun:sqlite";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync, watch } from "fs";
import { dirname, join } from "path";

import { homedir } from "os";
import {
  getAllSettings, getDb, getSetting, setSetting,
  approveMemory, getEmbeddingProvider, getJanitorStatus, getPendingMemories,
  mergeMemories, parseDedupSource, rejectMemory, runJanitor, startAutoRun, supersede,
  semanticSearch,
  SETTING_DEFAULTS, SETTING_KEYS,
  anthropicLLM,
  traverseGraph, buildReasoningContext,
  embedText, getSimilarMemories,
  cohereEmbedding, geminiEmbedding, ollamaEmbedding, openaiEmbedding, openrouterEmbedding,
  runPendingMigrations,
  startEmbeddingWorker, startJanitorScheduler,
  startLtmListener,
} from "@rohirik/ltm-core";
import { detectCommunities, generateClusterLabel, assignClusterColors } from "./cluster.js";
import { getDbPath, getSchemaPath } from "./paths.js";
import type { Cluster } from "./graph-app/lib/types.js";

const CLAUDE_DIR = join(homedir(), ".claude");

/** Parse a clamped integer from URL search params. */
function parseClampedInt(params: URLSearchParams, key: string, defaultVal: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, parseInt(params.get(key) ?? String(defaultVal), 10)));
}

/** Provider instances indexed by provider id, used by the /api/settings/verify route. */
const PROVIDER_VERIFY_MAP: Record<string, { verify(): Promise<{ ok: boolean; error?: string }> }> = {
  gemini: geminiEmbedding,
  openai: openaiEmbedding,
  anthropic: anthropicLLM,
  cohere: cohereEmbedding,
  openrouter: openrouterEmbedding,
  ollama: ollamaEmbedding,
};

/** Fetch real model lists from each provider's API after successful key verification. */
async function fetchProviderModels(
  provider: string,
  key: string,
): Promise<{ embedModels: string[]; llmModels: string[] }> {
  const empty = { embedModels: [] as string[], llmModels: [] as string[] };

  try {
    if (provider === "gemini") {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=100`,
      );
      if (!res.ok) return empty;
      const data = (await res.json()) as {
        models: Array<{ name: string; supportedGenerationMethods: string[] }>;
      };
      const embedModels = data.models
        .filter((m) => m.supportedGenerationMethods.includes("embedContent") || m.supportedGenerationMethods.includes("batchEmbedContents"))
        .map((m) => m.name.replace("models/", ""));
      const llmModels = data.models
        .filter((m) => m.supportedGenerationMethods.includes("generateContent"))
        .map((m) => m.name.replace("models/", ""))
        .filter((n) => !n.includes("embedding") && !n.includes("aqa"));
      return { embedModels, llmModels };
    }

    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return empty;
      const data = (await res.json()) as { data: Array<{ id: string }> };
      const ids = data.data.map((m) => m.id).sort();
      const embedModels = ids.filter((id) => id.startsWith("text-embedding"));
      const llmModels = ids.filter(
        (id) => id.startsWith("gpt-") || id.startsWith("o1") || id.startsWith("o3") || id.startsWith("o4"),
      );
      return { embedModels, llmModels };
    }

    if (provider === "anthropic") {
      // Anthropic has no public model list API — return well-known models
      return {
        embedModels: [],
        llmModels: [
          "claude-haiku-4-5-20251001",
          "claude-sonnet-4-6",
          "claude-opus-4-6",
          "claude-3-5-haiku-20241022",
          "claude-3-5-sonnet-20241022",
        ],
      };
    }

    if (provider === "cohere") {
      const res = await fetch("https://api.cohere.com/v2/models?page_size=50", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return empty;
      const data = (await res.json()) as {
        models: Array<{ name: string; endpoints: string[] }>;
      };
      const embedModels = data.models
        .filter((m) => m.endpoints.includes("embed"))
        .map((m) => m.name);
      const llmModels = data.models
        .filter((m) => m.endpoints.includes("chat"))
        .map((m) => m.name);
      return { embedModels, llmModels };
    }

    if (provider === "openrouter") {
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return empty;
      const data = (await res.json()) as { data: Array<{ id: string }> };
      const ids = data.data.map((m) => m.id).sort();
      const embedModels = ids.filter((id) => id.includes("embedding"));
      const llmModels = ids.filter((id) => !id.includes("embedding"));
      return { embedModels, llmModels };
    }

    if (provider === "ollama") {
      const baseUrl = getSetting("ltm.ollama.baseUrl") || "http://localhost:11434";
      const res = await fetch(`${baseUrl}/api/tags`).catch(() => null);
      if (!res?.ok) return empty;
      const data = (await res.json()) as { models: Array<{ name: string }> };
      const names = data.models.map((m) => m.name).sort();
      return { embedModels: names, llmModels: names };
    }
  } catch {
    // fall through to empty
  }
  return empty;
}

const DB_PATH = getDbPath();
const CONFIG_PATH = join(CLAUDE_DIR, "config.json");

function readClaudeConfig(): Record<string, unknown> {
  if (!existsSync(CONFIG_PATH)) return {};
  try { return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Record<string, unknown>; }
  catch { return {}; }
}

function writeClaudeConfig(patch: Record<string, unknown>): void {
  const current = readClaudeConfig();
  const merged = deepMerge(current, patch);
  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2) + "\n");
}

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== null && typeof v === "object" && !Array.isArray(v) &&
        typeof out[k] === "object" && out[k] !== null && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}
const SCHEMA_PATH = getSchemaPath();
const PID_PATH = join(CLAUDE_DIR, "tmp", "ltm-server.pid");
const PORT = 7331;

// Cache schema at startup — it never changes at runtime
const SCHEMA = readFileSync(SCHEMA_PATH, "utf-8");

// Ensure tmp dir and write PID
mkdirSync(join(CLAUDE_DIR, "tmp"), { recursive: true });
await Bun.write(PID_PATH, String(process.pid));

// Persistent DB — opened once, PRAGMAs run once
const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode=WAL;");
db.exec("PRAGMA foreign_keys=ON;");
db.exec(SCHEMA);
// Run all pending migrations (idempotent — adds Phase 7 columns to existing DBs)
await runPendingMigrations(db);

type Params = SQLQueryBindings[];

function queryDb<T = unknown>(sql: string, params: Params = []): T[] {
  return db.query<T, Params>(sql).all(...params);
}

function truncate(s: string, len: number): string {
  return s.length > len ? s.substring(0, len) + "…" : s;
}

function parseTags(raw: string | null): string[] {
  return raw ? raw.split(",").filter(Boolean) : [];
}

function queryOne<T = unknown>(sql: string, params: Params = []): T | null {
  return db.query<T, Params>(sql).get(...params) ?? null;
}

type MemoryRow = {
  id: number; content: string; title: string | null; category: string; importance: number;
  project_scope: string | null; confidence: number; confirm_count: number;
  source: string | null; dedup_key: string | null; last_confirmed_at: string;
  created_at: string; tags: string | null;
  hidden: number; color: string | null; icon: string | null; user_note: string | null;
  decay_score: number | null;
};

type CtxRow = {
  id: number; project_name: string; type: string; content: string;
  session_id: string | null; permanent: number; created_at: string;
};

function getMemoriesWithTags(includeHidden = false): MemoryRow[] {
  const hiddenClause = includeHidden ? "" : "AND m.hidden = 0";
  return queryDb<MemoryRow>(`
    SELECT m.id, m.content, m.title, m.category, m.importance, m.project_scope,
           m.confidence, m.confirm_count, m.source, m.dedup_key,
           m.last_confirmed_at, m.created_at,
           m.hidden, m.color, m.icon, m.user_note,
           m.decay_score,
           GROUP_CONCAT(t.name, ',') as tags
    FROM memories m
    LEFT JOIN memory_tags mt ON m.id = mt.memory_id
    LEFT JOIN tags t ON mt.tag_id = t.id
    WHERE m.status = 'active' ${hiddenClause}
    GROUP BY m.id
  `);
}

function getProjectNodes() {
  const projects = queryDb<{ name: string; goal: string | null; item_count: number }>(`
    SELECT c.project_name as name,
           (SELECT content FROM context_items WHERE project_name=c.project_name AND type='goal' LIMIT 1) as goal,
           COUNT(*) as item_count
    FROM context_items c
    GROUP BY c.project_name
    ORDER BY c.project_name
  `);

  return projects.map((p, i) => ({
    id: -(i + 1),
    label: p.name,
    content: p.goal ?? p.name,
    category: "project",
    importance: 5,
    project_scope: null,
    confidence: 1,
    confirm_count: p.item_count,
    created_at: "",
    tags: [] as string[],
    is_project: true,
  }));
}

function getContextNodes(): Array<ReturnType<typeof toCtxNode>> {
  const rows = queryDb<CtxRow>(`
    WITH ranked_progress AS (
      SELECT id, project_name, type, content, session_id, permanent, created_at,
             ROW_NUMBER() OVER (PARTITION BY project_name ORDER BY id DESC) AS rn
      FROM context_items WHERE type='progress'
    )
    SELECT id, project_name, type, content, session_id, permanent, created_at
    FROM context_items WHERE type IN ('goal','decision','gotcha')
    UNION ALL
    SELECT id, project_name, type, content, session_id, permanent, created_at
    FROM ranked_progress WHERE rn <= 5
    ORDER BY project_name, type, id
  `);
  return rows.map(toCtxNode);
}

function toCtxNode(c: CtxRow) {
  return {
    id: -(1000 + c.id),
    label: truncate(c.content, 55),
    content: c.content,
    category: c.type,
    importance: c.type === "goal" ? 3 : 2,
    project_scope: c.project_name,
    confidence: 1,
    confirm_count: 0,
    session_id: c.session_id,
    permanent: Boolean(c.permanent),
    created_at: c.created_at,
    tags: [] as string[],
    is_context: true,
  };
}

function buildProjectEdges(
  memories: MemoryRow[],
  ctxNodes: Array<{ id: number; project_scope: string | null }>,
  projectIdMap: Map<string, number>,
): Array<{ source: number; target: number; type: string }> {
  const edges: Array<{ source: number; target: number; type: string }> = [];
  for (const m of memories) {
    const pid = projectIdMap.get(m.project_scope ?? "");
    if (pid !== undefined) edges.push({ source: pid, target: m.id, type: "project_scope" });
  }
  for (const c of ctxNodes) {
    const pid = projectIdMap.get(c.project_scope ?? "");
    if (pid !== undefined) edges.push({ source: pid, target: c.id, type: "context_of" });
  }
  return edges;
}

function getGraphData(includeHidden = false) {
  const memories = getMemoriesWithTags(includeHidden);

  type LinkRow = { source: number; target: number; type: string; relation_id: number; created_at: string; note: string | null; weight: number; decay_a: number | null; decay_b: number | null };
  const rawLinks = queryDb<LinkRow>(`
    SELECT r.id as relation_id,
           r.source_memory_id as source,
           r.target_memory_id as target,
           r.relationship_type as type,
           r.created_at,
           r.note,
           r.weight,
           ms.decay_score as decay_a,
           mt.decay_score as decay_b
    FROM memory_relations r
    LEFT JOIN memories ms ON ms.id = r.source_memory_id
    LEFT JOIN memories mt ON mt.id = r.target_memory_id
  `);

  const memLinks = rawLinks.map(r => {
    const decayA = r.decay_a ?? 1;
    const decayB = r.decay_b ?? 1;
    const effectiveWeight = r.weight * Math.min(decayA, decayB);
    return { source: r.source, target: r.target, type: r.type, relation_id: r.relation_id, created_at: r.created_at, note: r.note, weight: effectiveWeight };
  });
  const projectNodes = getProjectNodes();
  const projectIdMap = new Map(projectNodes.map(p => [p.label, p.id]));
  const ctxNodes = getContextNodes();
  const projectEdges = buildProjectEdges(memories, ctxNodes, projectIdMap);

  return {
    nodes: [
      ...projectNodes,
      ...ctxNodes,
      ...memories.map(m => ({
        id: m.id,
        label: m.title ?? truncate(m.content, 60),
        content: m.content,
        title: m.title,
        category: m.category,
        importance: m.importance,
        project_scope: m.project_scope,
        confidence: m.confidence,
        confirm_count: m.confirm_count,
        source: m.source,
        dedup_key: m.dedup_key,
        last_confirmed_at: m.last_confirmed_at,
        created_at: m.created_at,
        tags: parseTags(m.tags),
        hidden: Boolean(m.hidden),
        color: m.color,
        icon: m.icon,
        user_note: m.user_note,
      })),
    ],
    links: [...memLinks, ...projectEdges],
  };
}

// Context items for a specific project (for sidebar)
function getProjectContext(projectName: string) {
  const rows = queryDb<{ type: string; content: string; created_at: string }>(
    `SELECT type, content, created_at FROM context_items WHERE project_name=? ORDER BY type, id DESC`,
    [projectName]
  );
  const grouped: Record<string, { content: string; created_at: string }[]> = { goal: [], decision: [], gotcha: [], progress: [] };
  for (const r of rows) { (grouped[r.type] ??= []).push({ content: r.content, created_at: r.created_at }); }
  return grouped;
}

function getStats() {
  const row = queryOne<{ memories: number; relations: number; projects: number; context_items: number; tags: number; pending: number }>(`
    SELECT
      (SELECT COUNT(*) FROM memories WHERE status IN ('active', 'pending')) as memories,
      (SELECT COUNT(*) FROM memory_relations) as relations,
      (SELECT COUNT(DISTINCT project_name) FROM context_items) as projects,
      (SELECT COUNT(*) FROM context_items) as context_items,
      (SELECT COUNT(*) FROM tags) as tags,
      (SELECT COUNT(*) FROM memories WHERE status = 'pending') as pending
  `);
  const byCategory = queryDb<{ category: string; cnt: number }>(
    `SELECT category, COUNT(*) as cnt FROM memories GROUP BY category`
  );
  const byProject = queryDb<{ project_scope: string; cnt: number }>(
    `SELECT project_scope, COUNT(*) as cnt FROM memories WHERE project_scope IS NOT NULL GROUP BY project_scope`
  );
  return {
    memories: row?.memories ?? 0,
    relations: row?.relations ?? 0,
    projects: row?.projects ?? 0,
    context_items: row?.context_items ?? 0,
    tags: row?.tags ?? 0,
    pending: row?.pending ?? 0,
    by_category: Object.fromEntries(byCategory.map(r => [r.category, r.cnt])),
    by_project: Object.fromEntries(byProject.map(r => [r.project_scope, r.cnt])),
  };
}

function getTags() {
  return queryDb<{ id: number; name: string; memory_count: number }>(
    `SELECT t.id, t.name, COUNT(mt.memory_id) as memory_count FROM tags t LEFT JOIN memory_tags mt ON t.id=mt.tag_id GROUP BY t.id ORDER BY memory_count DESC`
  );
}

function getMemoryById(id: number) {
  const m = queryOne<Omit<MemoryRow, "tags">>(
    `SELECT id, content, category, importance, project_scope, confidence, confirm_count, source, dedup_key, last_confirmed_at, created_at FROM memories WHERE id=?`,
    [id]
  );
  if (!m) return null;
  const tags = queryDb<{ name: string }>(
    `SELECT t.name FROM tags t JOIN memory_tags mt ON t.id=mt.tag_id WHERE mt.memory_id=?`,
    [id]
  ).map(r => r.name);
  const relations = queryDb<{ relation_id: number; related_id: number; type: string; direction: string }>(`
    SELECT id as relation_id, target_memory_id as related_id, relationship_type as type, 'outgoing' as direction FROM memory_relations WHERE source_memory_id=?
    UNION ALL
    SELECT id as relation_id, source_memory_id as related_id, relationship_type as type, 'incoming' as direction FROM memory_relations WHERE target_memory_id=?
  `, [id, id]);
  return { ...m, tags, relations };
}

function getProjectDetail(projectName: string) {
  const context = getProjectContext(projectName);

  const memories = queryDb<MemoryRow>(
    `SELECT m.id, m.content, m.title, m.category, m.importance, m.confidence, m.confirm_count,
            m.source, m.dedup_key, m.last_confirmed_at, m.created_at,
            m.hidden, m.color, m.icon, m.user_note,
            GROUP_CONCAT(t.name, ',') as tags
     FROM memories m
     LEFT JOIN memory_tags mt ON m.id = mt.memory_id
     LEFT JOIN tags t ON mt.tag_id = t.id
     WHERE m.project_scope = ?
     GROUP BY m.id
     ORDER BY m.importance DESC, m.id DESC`,
    [projectName]
  ).map(m => ({
    ...m,
    label: m.title ?? truncate(m.content, 60),
    project_scope: projectName,
    tags: parseTags(m.tags),
  }));

  const ctxRows = queryDb<CtxRow>(
    `SELECT id, project_name, type, content, session_id, permanent, created_at FROM context_items WHERE project_name=? ORDER BY type, id DESC`,
    [projectName]
  );
  const context_items = ctxRows.map(toCtxNode);

  const relations = queryDb<{ source: number; target: number; type: string; relation_id: number }>(
    `SELECT r.id as relation_id, r.source_memory_id as source, r.target_memory_id as target, r.relationship_type as type
     FROM memory_relations r
     WHERE r.source_memory_id IN (SELECT id FROM memories WHERE project_scope = ?)
        OR r.target_memory_id IN (SELECT id FROM memories WHERE project_scope = ?)`,
    [projectName, projectName]
  );

  return { name: projectName, context, memories, context_items, relations };
}

function searchMemories(q: string) {
  try {
    return queryDb<{ id: number; content: string; category: string; importance: number; project_scope: string | null }>(
      `SELECT m.id, m.content, m.category, m.importance, m.project_scope
       FROM memories_fts
       JOIN memories m ON memories_fts.rowid = m.id
       WHERE memories_fts MATCH ?
       ORDER BY rank
       LIMIT 50`,
      [q]
    );
  } catch {
    return [];
  }
}

// ─── Config Explorer ─────────────────────────────────────────────────────────

import { readdirSync } from "fs";

interface SkillEntry {
  name: string;
  description: string;
  slashCommand?: string;
  triggerPhrases: string[];
  workflows: string[];
  path: string;
}

interface AgentEntry {
  name: string;
  description: string;
  whenToUse: string;
  path: string;
}

interface HookEntry {
  event: string;
  matcher?: string;
  description: string;
}

interface RuleEntry {
  name: string;
  summary: string;
  content: string;
  path: string;
}

function parseSkills(): SkillEntry[] {
  const skillsDir = join(CLAUDE_DIR, "skills");
  if (!existsSync(skillsDir)) return [];

  const entries: SkillEntry[] = [];
  let dirs: string[] = [];
  try { dirs = readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); }
  catch { return []; }

  for (const dir of dirs) {
    const skillPath = join(skillsDir, dir, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    let raw = "";
    try { raw = readFileSync(skillPath, "utf-8"); } catch { continue; }

    // Extract frontmatter name/description
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    let name = dir;
    let description = "";
    if (fmMatch) {
      const nameM = fmMatch[1].match(/^name:\s*(.+)$/m);
      const descM = fmMatch[1].match(/^description:\s*(.+)$/m);
      if (nameM) name = nameM[1].trim();
      if (descM) description = descM[1].trim();
    }
    if (!description) {
      // Fallback: first non-empty, non-heading line
      const line = raw.split("\n").find(l => l.trim() && !l.startsWith("#") && !l.startsWith("---") && !l.startsWith("name:") && !l.startsWith("description:"));
      description = line?.trim() ?? "";
    }

    // Slash command: any `/word` appearing in the file
    const cmdM = raw.match(/`(\/[\w-]+)`/);
    const slashCommand = cmdM ? cmdM[1] : undefined;

    // Trigger phrases: lines after "USE WHEN" or "Trigger"
    const triggerPhrases: string[] = [];
    const triggerSection = raw.match(/(?:USE WHEN|Triggers?)[:\s]+([\s\S]*?)(?:\n##|\n---|\n\n\n|$)/i);
    if (triggerSection) {
      triggerPhrases.push(
        ...triggerSection[1]
          .split("\n")
          .map(l => l.replace(/^[-*]\s*/, "").trim())
          .filter(l => l.length > 0 && l.length < 120)
          .slice(0, 6)
      );
    }

    // Workflows: subdirectories named Workflows/
    const workflowsDir = join(skillsDir, dir, "Workflows");
    let workflows: string[] = [];
    if (existsSync(workflowsDir)) {
      try {
        workflows = readdirSync(workflowsDir)
          .filter(f => f.endsWith(".md"))
          .map(f => f.replace(/\.md$/, ""));
      } catch { /* empty */ }
    }

    entries.push({ name, description, slashCommand, triggerPhrases, workflows, path: `skills/${dir}/SKILL.md` });
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function parseAgents(): AgentEntry[] {
  const agentsDir = join(CLAUDE_DIR, "agents");
  if (!existsSync(agentsDir)) return [];

  const entries: AgentEntry[] = [];
  let files: string[] = [];
  try { files = readdirSync(agentsDir).filter(f => f.endsWith(".md")); }
  catch { return []; }

  for (const file of files) {
    const agentPath = join(agentsDir, file);
    let raw = "";
    try { raw = readFileSync(agentPath, "utf-8"); } catch { continue; }

    const name = file.replace(/\.md$/, "");

    // Description: first paragraph after the H1 or first non-empty line
    const lines = raw.split("\n");
    let description = "";
    let foundHeading = false;
    for (const line of lines) {
      if (line.startsWith("# ")) { foundHeading = true; continue; }
      if (foundHeading && line.trim()) { description = line.trim(); break; }
    }
    if (!description) description = lines.find(l => l.trim() && !l.startsWith("#"))?.trim() ?? "";

    // When to use: content after "When to use" or "Use when" heading
    let whenToUse = "";
    const whenMatch = raw.match(/##\s+(?:When to [Uu]se|Use [Ww]hen)[^\n]*\n([\s\S]*?)(?:\n##|$)/);
    if (whenMatch) {
      whenToUse = whenMatch[1]
        .split("\n")
        .map(l => l.replace(/^[-*]\s*/, "").trim())
        .filter(l => l.length > 0)
        .slice(0, 3)
        .join(" · ");
    }

    entries.push({ name, description, whenToUse, path: `agents/${file}` });
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function parseHooks(): HookEntry[] {
  const settingsPath = join(CLAUDE_DIR, "settings.json");
  if (!existsSync(settingsPath)) return [];

  let settings: Record<string, unknown> = {};
  try { settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<string, unknown>; }
  catch { return []; }

  const hooks = settings["hooks"] as Record<string, unknown[]> | undefined;
  if (!hooks) return [];

  const entries: HookEntry[] = [];
  for (const [event, hookList] of Object.entries(hooks)) {
    if (!Array.isArray(hookList)) continue;
    for (const hook of hookList) {
      const h = hook as Record<string, unknown>;
      const matcher = typeof h["matcher"] === "string" ? h["matcher"] : undefined;
      const hooks2 = Array.isArray(h["hooks"]) ? h["hooks"] as Array<Record<string, unknown>> : [];
      for (const inner of hooks2) {
        const cmd = typeof inner["command"] === "string" ? inner["command"] as string : "";
        const friendly = cmd.replace(/\/Users\/[^/]+/g, "~").slice(0, 80);
        entries.push({ event, matcher, description: friendly });
      }
      // Flat hook (no nested hooks array)
      if (hooks2.length === 0 && typeof h["command"] === "string") {
        const cmd = h["command"] as string;
        const friendly = cmd.replace(/\/Users\/[^/]+/g, "~").slice(0, 80);
        entries.push({ event, matcher, description: friendly });
      }
    }
  }
  return entries;
}

function parseRules(): RuleEntry[] {
  const rulesDir = join(CLAUDE_DIR, "rules");
  if (!existsSync(rulesDir)) return [];

  const entries: RuleEntry[] = [];
  let files: string[] = [];
  try { files = readdirSync(rulesDir).filter(f => f.endsWith(".md")); }
  catch { return []; }

  for (const file of files) {
    const rulePath = join(rulesDir, file);
    let raw = "";
    try { raw = readFileSync(rulePath, "utf-8"); } catch { continue; }

    const name = file.replace(/\.md$/, "");
    // Summary: first heading text + first content line
    const heading = raw.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? name;
    const firstLine = raw.split("\n").find(l => l.trim() && !l.startsWith("#"))?.trim() ?? "";
    const summary = firstLine.length > 0 ? firstLine.slice(0, 120) : heading;

    entries.push({ name, summary, content: raw, path: `rules/${file}` });
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function getConfigExplorer() {
  return {
    skills: parseSkills(),
    agents: parseAgents(),
    hooks: parseHooks(),
    rules: parseRules(),
  };
}

// WebSocket clients — typed to the minimal interface we actually use
type WsClient = { send(data: string): void };
const clients = new Set<WsClient>();

function broadcast(data: object): void {
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    try { ws.send(msg); } catch { clients.delete(ws); }
  }
}

// Incremental cluster recompute trigger
let newMemoriesSinceLastCluster = 0;
let recomputeScheduled = false;

function scheduledRecompute(): void {
  if (recomputeScheduled) return;
  recomputeScheduled = true;
  // Run async so we don't block the request
  Promise.resolve().then(async () => {
    try {
      const graphData = getGraphData();
      const nodeIdSet = new Set(graphData.nodes.map(n => n.id));
      const nodeMap = graphData.nodes as import("./graph-app/lib/types.js").GraphNode[];
      const communityMap = detectCommunities(nodeMap, graphData.links as import("./graph-app/lib/types.js").GraphLink[]);

      // Group nodes by cluster
      const clusterNodes = new Map<string, number[]>();
      for (const [nodeId, clusterId] of communityMap) {
        if (!nodeIdSet.has(nodeId)) continue;
        const arr = clusterNodes.get(clusterId) ?? [];
        arr.push(nodeId);
        clusterNodes.set(clusterId, arr);
      }

      // Build node tag lookup for label generation
      const tagsByNodeId = new Map<number, string[]>();
      for (const n of graphData.nodes) {
        if ("tags" in n) tagsByNodeId.set(n.id, n.tags);
      }

      const clusterList = [...clusterNodes.entries()];
      const colors = assignClusterColors(clusterList.length);
      const now = new Date().toISOString();

      // Snapshot manual-labeled clusters keyed by sorted node_ids so we can
      // re-apply them after the recompute wipes the table (migration 021).
      const manualRows = queryDb<{ label: string; node_ids: string }>(
        "SELECT label, node_ids FROM memory_clusters WHERE manual_label=1"
      );
      const manualByKey = new Map<string, string>();
      for (const row of manualRows) {
        const key = JSON.stringify([...(JSON.parse(row.node_ids) as number[])].sort((a, b) => a - b));
        manualByKey.set(key, row.label);
      }

      const insert = db.prepare<void, [string, string, string, string, number, string, string]>(
        "INSERT INTO memory_clusters(id,label,color,node_ids,manual_label,created_at,updated_at) VALUES(?,?,?,?,?,?,?)"
      );
      db.transaction(() => {
        db.exec("DELETE FROM memory_clusters");
        for (let i = 0; i < clusterList.length; i++) {
          const [clusterId, nodeIds] = clusterList[i]!;
          const sortedKey = JSON.stringify([...nodeIds].sort((a, b) => a - b));
          const manualLabel = manualByKey.get(sortedKey);
          const tagGroups = nodeIds.map(nid => tagsByNodeId.get(nid) ?? []);
          const label = manualLabel ?? generateClusterLabel(tagGroups, `Cluster ${i + 1}`);
          const color = colors[i] ?? `hsl(${i * 47 % 360}, 65%, 55%)`;
          insert.run(clusterId, label, color, JSON.stringify(nodeIds), manualLabel ? 1 : 0, now, now);
        }
      })();

      // clusters_updated is enough — db watcher broadcasts refresh automatically
      broadcast({ type: "clusters_updated" });
    } catch {
      // recompute errors are non-fatal
    } finally {
      newMemoriesSinceLastCluster = 0;
      recomputeScheduled = false;
    }
  }).catch(() => { recomputeScheduled = false; });
}

function maybeScheduleRecompute(): void {
  newMemoriesSinceLastCluster++;
  if (newMemoriesSinceLastCluster >= 10) scheduledRecompute();
}

// Liveness: prefer Honker pub/sub push — the "ltm" channel drives broadcast()
// directly, with zero polling and zero debounce lag. Falls back to the fs.watch
// + 3s-debounce file-watcher when Honker is unavailable (listener inert).
const ltmListener = startLtmListener(event => broadcast(event));
if (ltmListener.running) {
  console.log("   Liveness: honker pub/sub (push)");
} else {
  // WAL writes go to ltm.db-wal, not ltm.db — watch the WAL file (or dir as
  // fallback). Debounce at 3s so that rapid hook writes (EvaluateSession,
  // PreCompact, etc.) coalesce into a single refresh instead of one per write.
  let watchDebounce: ReturnType<typeof setTimeout> | null = null;
  if (existsSync(DB_PATH)) {
    const watchTarget = existsSync(DB_PATH + "-wal") ? DB_PATH + "-wal" : dirname(DB_PATH);
    watch(watchTarget, { recursive: false }, () => {
      if (watchDebounce) clearTimeout(watchDebounce);
      watchDebounce = setTimeout(() => broadcast({ type: "refresh" }), 3000);
    });
  }
}

Bun.serve({
  port: PORT,

  websocket: {
    open(ws) { clients.add(ws); ws.send(JSON.stringify({ type: "connected" })); },
    close(ws) { clients.delete(ws); },
    message() {},
  },

  async fetch(req, server) {
    if (req.headers.get("upgrade") === "websocket") {
      const ok = server.upgrade(req);
      if (!ok) return new Response("WebSocket upgrade failed", { status: 400 });
      return undefined as unknown as Response;
    }

    const url = new URL(req.url);
    const p = url.pathname;

    if (p === "/")                     return new Response(null, { status: 302, headers: { Location: "http://localhost:7332" } });
    if (p === "/api/graph") {
      const includeHidden = url.searchParams.get("includeHidden") === "1";
      return Response.json(getGraphData(includeHidden));
    }
    if (p === "/api/stats")            return Response.json(getStats());
    if (p === "/api/tags")             return Response.json(getTags());
    if (p === "/api/search") {
      const q = url.searchParams.get("q") ?? "";
      return Response.json(q.length >= 2 ? searchMemories(q) : []);
    }
    if (p === "/api/reload" && req.method === "POST") {
      broadcast({ type: "refresh" });
      return Response.json({ ok: true });
    }

    // ── Layout routes (G7) ────────────────────────────────────────────────────
    if (p === "/api/layout" && req.method === "GET") {
      const view = url.searchParams.get("view") ?? "global";
      const rows = queryDb<{ memory_id: number; x: number; y: number; pinned: number }>(
        `SELECT memory_id, x, y, pinned FROM memory_layout WHERE view = ?`, [view]
      );
      return Response.json(rows);
    }
    if (p === "/api/layout" && req.method === "POST") {
      type LayoutEntry = { memory_id: number; view: string; x: number; y: number; pinned?: number };
      const body = await req.json() as { entries: LayoutEntry[] };
      if (!Array.isArray(body?.entries)) return new Response("Bad Request", { status: 400 });
      const stmt = db.prepare<void, [number, string, number, number, number]>(
        `INSERT INTO memory_layout (memory_id, view, x, y, pinned, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(memory_id, view) DO UPDATE SET x=excluded.x, y=excluded.y, pinned=excluded.pinned, updated_at=excluded.updated_at`
      );
      db.transaction(() => {
        for (const e of body.entries) {
          stmt.run(e.memory_id, e.view ?? "global", e.x, e.y, e.pinned ? 1 : 0);
        }
      })();
      return Response.json({ ok: true });
    }

    const ctxMatch = p.match(/^\/api\/context\/(.+)$/);
    if (ctxMatch?.[1]) return Response.json(getProjectContext(decodeURIComponent(ctxMatch[1])));

    // DELETE /api/context-item/:id — delete a single context item by id
    const ctxItemDelMatch = p.match(/^\/api\/context-item\/(\d+)$/);
    if (ctxItemDelMatch?.[1] && req.method === "DELETE") {
      const id = parseInt(ctxItemDelMatch[1], 10);
      const row = queryOne<{ id: number }>("SELECT id FROM context_items WHERE id=?", [id]);
      if (!row) return new Response("Not found", { status: 404 });
      db.run("DELETE FROM context_items WHERE id=?", [id]);
      broadcast({ type: "refresh" });
      return Response.json({ ok: true });
    }

    const memMatch = p.match(/^\/api\/memory\/(\d+)$/);
    if (memMatch?.[1]) {
      const m = getMemoryById(parseInt(memMatch[1], 10));
      return m ? Response.json(m) : new Response("Not found", { status: 404 });
    }

    const projMatch = p.match(/^\/api\/project\/(.+)$/);
    if (projMatch?.[1]) return Response.json(getProjectDetail(decodeURIComponent(projMatch[1])));

    // ============================================================
    // Phase 2: Settings routes
    // ============================================================

    if (p === "/api/settings" && req.method === "GET") {
      const stored = getAllSettings();
      // Merge with defaults so the UI always sees every key
      const merged: Record<string, string> = { ...SETTING_DEFAULTS, ...stored };
      return Response.json(merged);
    }

    if (p === "/api/settings" && req.method === "PUT") {
      try {
        const body = (await req.json()) as Record<string, string>;
        for (const [key, value] of Object.entries(body)) {
          if (typeof key === "string" && typeof value === "string") {
            await setSetting(key, value);
          }
        }
        broadcast({ type: "settings-updated" });
        return Response.json({ ok: true });
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 400 });
      }
    }

    if (p === "/api/settings/models" && req.method === "GET") {
      return Response.json({
        embeddingProviders: ["gemini", "openai", "cohere", "openrouter", "ollama"],
        llmProviders: ["gemini", "openai", "anthropic", "cohere", "openrouter", "ollama"],
        embedModels: {
          gemini: ["text-embedding-004", "text-embedding-005", "gemini-embedding-exp-03-07"],
          openai: ["text-embedding-3-small", "text-embedding-3-large", "text-embedding-ada-002"],
          cohere: ["embed-v4.0", "embed-multilingual-v3.0", "embed-english-v3.0"],
          openrouter: ["openai/text-embedding-3-small", "openai/text-embedding-3-large"],
          ollama: ["nomic-embed-text", "mxbai-embed-large", "all-minilm", "snowflake-arctic-embed"],
        },
        llmModels: {
          gemini: ["gemini-2.0-flash", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-1.5-flash"],
          openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini"],
          anthropic: ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-6"],
          cohere: ["command-r-plus", "command-r", "command-a-03-2025"],
          openrouter: ["google/gemini-2.0-flash-001", "openai/gpt-4o-mini", "meta-llama/llama-3.3-70b-instruct"],
          ollama: ["llama3.2", "llama3.1", "mistral", "phi4", "qwen2.5"],
        },
        defaults: SETTING_DEFAULTS,
      });
    }

    if (p === "/api/settings/verify" && req.method === "POST") {
      try {
        const body = await req.json().catch(() => ({})) as { provider?: string; key?: string };
        // If caller provides key + provider, persist it first (avoids client-side extra PUT round-trip)
        if (body.provider && body.key) {
          const keySettingMap: Record<string, string> = {
            gemini: SETTING_KEYS.GEMINI_API_KEY,
            openai: SETTING_KEYS.OPENAI_API_KEY,
            anthropic: SETTING_KEYS.ANTHROPIC_API_KEY,
            cohere: SETTING_KEYS.COHERE_API_KEY,
            openrouter: SETTING_KEYS.OPENROUTER_API_KEY,
          };
          const settingKey = keySettingMap[body.provider];
          if (settingKey) await setSetting(settingKey, body.key);
        }
        const provider = body.provider
          ? (PROVIDER_VERIFY_MAP[body.provider] ?? null)
          : getEmbeddingProvider();
        if (!provider) {
          return Response.json({ ok: false, error: `Unknown provider: ${body.provider}` });
        }
        const result = await provider.verify();
        if (result.ok && body.provider && body.key) {
          const models = await fetchProviderModels(body.provider, body.key);
          return Response.json({ ...result, ...models });
        }
        return Response.json(result);
      } catch (e) {
        return Response.json({ ok: false, error: String(e) });
      }
    }

    // ============================================================
    // Phase 2: Janitor routes
    // ============================================================

    if (p === "/api/janitor/status" && req.method === "GET") {
      return Response.json(getJanitorStatus());
    }

    if (p === "/api/janitor/run" && req.method === "POST") {
      const status = getJanitorStatus();
      if (status.running) {
        return Response.json({ ok: false, error: "Janitor already running" }, { status: 409 });
      }
      // Fire-and-forget — LLM dedup can take >10s, respond immediately
      runJanitor().then(result => {
        broadcast({ type: "janitor-complete", result });
      }).catch(() => {});
      return Response.json({ ok: true, started: true });
    }

    // ============================================================
    // Phase 2: Pending memories routes
    // ============================================================

    if (p === "/api/pending" && req.method === "GET") {
      return Response.json(getPendingMemories());
    }

    const approveMatch = p.match(/^\/api\/memory\/(\d+)\/approve$/);
    if (approveMatch?.[1] && req.method === "POST") {
      const id = parseInt(approveMatch[1], 10);
      const mem = queryOne<{ source: string | null }>(
        "SELECT source FROM memories WHERE id = ? AND status = 'pending'", [id]
      );
      if (!mem) {
        return Response.json({ ok: false, error: "Not a pending memory" }, { status: 400 });
      }
      const dedupPair = mem.source ? parseDedupSource(mem.source) : null;
      if (dedupPair) {
        mergeMemories(dedupPair.idA, dedupPair.idB);
        db.run("DELETE FROM memories WHERE id = ?", [id]);
        broadcast({ type: "refresh" });
        return Response.json({ ok: true, id, merged: true });
      }
      const ok = approveMemory(id);
      if (ok) {
        broadcast({ type: "refresh" });
        maybeScheduleRecompute();
        return Response.json({ ok: true, id });
      }
      return Response.json({ ok: false, error: "Not a pending memory" }, { status: 400 });
    }

    // DELETE /api/memory/:id — reject pending memory or delete any memory
    const deleteMemMatch = p.match(/^\/api\/memory\/(\d+)$/);
    if (deleteMemMatch?.[1] && req.method === "DELETE") {
      const id = parseInt(deleteMemMatch[1], 10);
      const mem = queryOne<{ status: string }>("SELECT status FROM memories WHERE id=?", [id]);
      if (!mem) return new Response("Not found", { status: 404 });

      if (mem.status === "pending") {
        rejectMemory(id);
      } else {
        db.run("DELETE FROM memories WHERE id=?", [id]);
      }
      broadcast({ type: "refresh" });
      return Response.json({ ok: true, id });
    }

    // PUT /api/memory/:id — edit content, tags, importance
    if (deleteMemMatch?.[1] && req.method === "PUT") {
      const id = Number(deleteMemMatch[1]);
      const body = await req.json() as { content?: string; tags?: string[]; importance?: number };
      if (body.content !== undefined && !body.content.trim())
        return Response.json({ error: "content cannot be empty" }, { status: 400 });
      if (body.importance !== undefined && (body.importance < 1 || body.importance > 5))
        return Response.json({ error: "importance must be 1-5" }, { status: 400 });
      if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.some(t => typeof t !== "string")))
        return Response.json({ error: "tags must be a string array" }, { status: 400 });
      if (body.content !== undefined) {
        db.run("UPDATE memories SET content=?, last_confirmed_at=? WHERE id=?",
          [body.content.trim(), new Date().toISOString(), id]);
      }
      if (body.importance !== undefined) {
        db.run("UPDATE memories SET importance=? WHERE id=?", [body.importance, id]);
      }
      if (body.tags !== undefined) {
        db.run("DELETE FROM memory_tags WHERE memory_id=?", [id]);
        for (const tag of body.tags) {
          let tagRow = db.query<{ id: number }, [string]>("SELECT id FROM tags WHERE name=?").get(tag);
          if (!tagRow) {
            db.run("INSERT OR IGNORE INTO tags(name) VALUES(?)", [tag]);
            tagRow = db.query<{ id: number }, [string]>("SELECT id FROM tags WHERE name=?").get(tag)!;
          }
          db.run("INSERT OR IGNORE INTO memory_tags(memory_id,tag_id) VALUES(?,?)", [id, tagRow.id]);
        }
      }
      broadcast({ type: "memory_updated", id });
      return Response.json({ ok: true });
    }

    // POST /api/memory/:id/supersedes/:targetId
    const supersedesMatch = p.match(/^\/api\/memory\/(\d+)\/supersedes\/(\d+)$/);
    if (supersedesMatch?.[1] && supersedesMatch?.[2] && req.method === "POST") {
      try {
        const newId = parseInt(supersedesMatch[1], 10);
        const oldId = parseInt(supersedesMatch[2], 10);
        supersede(newId, oldId);
        broadcast({ type: "refresh" });
        return Response.json({ ok: true, newId, oldId });
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 400 });
      }
    }

    // POST /api/memory/merge — merge two memories
    if (p === "/api/memory/merge" && req.method === "POST") {
      try {
        const body = (await req.json()) as { keepId: number; supersededId: number; mergedContent?: string };
        mergeMemories(body.keepId, body.supersededId, body.mergedContent);
        broadcast({ type: "refresh" });
        return Response.json({ ok: true });
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 400 });
      }
    }

    // ── Node UI-state route (G7/G13) ──────────────────────────────────────────
    // PUT /api/memory/:id/ui — update hidden, color, icon, user_note, title
    const uiMatch = p.match(/^\/api\/memory\/(\d+)\/ui$/);
    if (uiMatch?.[1] && req.method === "PUT") {
      const id = parseInt(uiMatch[1], 10);
      const body = await req.json() as Record<string, unknown>;
      const updates: string[] = [];
      const params: (string | number | null)[] = [];
      if ("hidden" in body)    { updates.push("hidden=?");    params.push(body.hidden ? 1 : 0); }
      if ("color" in body)     { updates.push("color=?");     params.push((body.color as string | null) ?? null); }
      if ("icon" in body)      { updates.push("icon=?");      params.push((body.icon as string | null) ?? null); }
      if ("user_note" in body) { updates.push("user_note=?"); params.push((body.user_note as string | null) ?? null); }
      if ("title" in body)     { updates.push("title=?");     params.push((body.title as string | null) ?? null); }
      if (updates.length === 0) return Response.json({ ok: false, error: "No fields to update" }, { status: 400 });
      params.push(id);
      db.run(`UPDATE memories SET ${updates.join(", ")} WHERE id=?`, params);
      broadcast({ type: "refresh" });
      return Response.json({ ok: true });
    }

    // PUT /api/memory/:id/pin — pin or unpin in a specific view
    const pinMatch = p.match(/^\/api\/memory\/(\d+)\/pin$/);
    if (pinMatch?.[1] && req.method === "PUT") {
      const id = parseInt(pinMatch[1], 10);
      const view = url.searchParams.get("view") ?? "global";
      const { pinned = true, x, y } = await req.json() as { pinned?: boolean; x?: number; y?: number };
      const layout = queryOne<{ x: number; y: number }>(
        `SELECT x, y FROM memory_layout WHERE memory_id=? AND view=?`, [id, view]
      );
      const nx = x ?? layout?.x ?? 0;
      const ny = y ?? layout?.y ?? 0;
      db.run(
        `INSERT INTO memory_layout (memory_id, view, x, y, pinned, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(memory_id, view) DO UPDATE SET pinned=excluded.pinned, x=excluded.x, y=excluded.y, updated_at=excluded.updated_at`,
        [id, view, nx, ny, pinned ? 1 : 0]
      );
      broadcast({ type: "refresh" });
      return Response.json({ ok: true });
    }

    // GET /api/search/all — full-text search over memories + context_items titles + content
    if (p === "/api/search/all" && req.method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      if (q.length < 2) return Response.json([]);
      const memResults = queryDb<{ id: number; content: string; title: string | null; category: string; importance: number; project_scope: string | null; type: string }>(
        `SELECT m.id, m.content, m.title, m.category, m.importance, m.project_scope, 'memory' as type
         FROM memories_fts f JOIN memories m ON m.id = f.rowid
         WHERE memories_fts MATCH ? AND m.status = 'active'
         ORDER BY rank LIMIT 20`,
        [q]
      );
      const ctxResults = queryDb<{ id: number; content: string; title: string | null; category: string; importance: number; project_scope: string | null; type: string }>(
        `SELECT c.id, c.content, c.title, c.type as category, 2 as importance, c.project_name as project_scope, 'context' as type
         FROM context_items_fts f JOIN context_items c ON c.id = f.rowid
         WHERE context_items_fts MATCH ?
         LIMIT 10`,
        [q]
      );
      return Response.json([...memResults, ...ctxResults]);
    }

    // ============================================================
    // Phase 3: Semantic search
    // ============================================================

    if (p === "/api/search/semantic" && req.method === "POST") {
      try {
        const { query, limit = 10, minSimilarity = 0.5 } = (await req.json()) as {
          query: string; limit?: number; minSimilarity?: number;
        };
        const results = await semanticSearch(query, limit, minSimilarity);
        return Response.json(results);
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 500 });
      }
    }

    // ============================================================
    // Phase 3: Dedup merge-all
    // ============================================================

    if (p === "/api/dedup/merge-all" && req.method === "POST") {
      const { minSimilarity = 0.95 } = await req.json().catch(() => ({})) as { minSimilarity?: number };
      const candidates = db.query<
        { id: number; content: string; category: string; source: string; confidence: number },
        []
      >("SELECT id, content, category, source, confidence FROM memories WHERE status = 'pending' AND source LIKE 'dedup:%'").all();

      let merged = 0;
      let skipped = 0;
      const errors: string[] = [];
      const sentinelIdsToDelete: number[] = [];

      // mergeMemories calls outside the transaction (they manage their own writes)
      for (const candidate of candidates) {
        try {
          const dedupPair = parseDedupSource(candidate.source);
          if (!dedupPair) { skipped++; continue; }
          // similarity is stored directly in the confidence column
          if (candidate.confidence < minSimilarity) { skipped++; continue; }
          mergeMemories(dedupPair.idA, dedupPair.idB);
          sentinelIdsToDelete.push(candidate.id);
          merged++;
        } catch (e) {
          errors.push(String(e));
          skipped++;
        }
      }

      // Batch-delete all processed sentinel rows in one transaction
      if (sentinelIdsToDelete.length > 0) {
        const placeholders = sentinelIdsToDelete.map(() => "?").join(",");
        db.run(`DELETE FROM memories WHERE id IN (${placeholders})`, sentinelIdsToDelete);
      }

      broadcast({ type: "refresh" });
      return Response.json({ merged, skipped, errors });
    }

    // ============================================================
    // Phase 3: Memory health dashboard
    // ============================================================

    if (p === "/api/health" && req.method === "GET") {
      const atRisk = db.query<
        { id: number; content: string; category: string; confidence: number; project_scope: string | null },
        []
      >("SELECT id, content, category, confidence, project_scope FROM memories WHERE status = 'active' AND confidence < 0.3 ORDER BY confidence ASC LIMIT 50").all();
      const distribution = db.query<{ bucket: number; count: number }, []>(
        "SELECT ROUND(confidence, 1) as bucket, COUNT(*) as count FROM memories WHERE status = 'active' GROUP BY bucket ORDER BY bucket"
      ).all();
      const stats = db.query<{ status: string; count: number }, []>(
        "SELECT status, COUNT(*) as count FROM memories GROUP BY status"
      ).all();
      const avgConf = db.query<{ avg: number }, []>(
        "SELECT AVG(confidence) as avg FROM memories WHERE status = 'active'"
      ).get() as { avg: number };
      return Response.json({ atRisk, distribution, stats, avgConf: avgConf?.avg ?? 0 });
    }

    // ============================================================
    // Phase 4: Project Health Score
    // ============================================================

    if (p === "/api/health/projects" && req.method === "GET") {
      type MetricRow = {
        project: string;
        memoryCount: number;
        staleCount: number;
        avgConfidence: number;
        lastActivityAt: string | null;
        recentCount: number;
      };
      type CtxRow = { project_name: string; contextItemCount: number };

      // 2 queries total regardless of project count (previously 1 + 2N)
      const metricsRows = db.query<MetricRow, []>(
        `SELECT
          project_scope as project,
          COUNT(*) as memoryCount,
          SUM(CASE WHEN last_used_at > '1970-01-02' AND last_used_at < datetime('now', '-30 days') THEN 1 ELSE 0 END) as staleCount,
          AVG(confidence) as avgConfidence,
          MAX(CASE WHEN last_used_at > '1970-01-02' THEN last_used_at ELSE NULL END) as lastActivityAt,
          SUM(CASE WHEN last_used_at > '1970-01-02' AND last_used_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) as recentCount
        FROM memories
        WHERE project_scope IS NOT NULL AND status = 'active'
        GROUP BY project_scope`
      ).all();

      const ctxRows = db.query<CtxRow, []>(
        "SELECT project_name, COUNT(DISTINCT type) as contextItemCount FROM context_items GROUP BY project_name"
      ).all();
      const ctxMap = new Map(ctxRows.map((r) => [r.project_name, r.contextItemCount]));

      const cutoff14d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

      const scores = metricsRows.map((metrics) => {
        const { project } = metrics;
        const memoryCount = metrics.memoryCount ?? 0;
        const staleCount = metrics.staleCount ?? 0;
        const recentCount = metrics.recentCount ?? 0;
        const contextItemCount = ctxMap.get(project) ?? 0;

        const memoryFreshness = memoryCount > 0 ? recentCount / memoryCount : 0;
        const avgConfidence = metrics.avgConfidence ?? 0;
        const contextCoverage = Math.min(1, contextItemCount / 4);
        const sessionActivity =
          metrics.lastActivityAt && new Date(metrics.lastActivityAt) >= cutoff14d ? 1 : 0;

        const score = Math.round(
          memoryFreshness * 35 +
          avgConfidence * 25 +
          contextCoverage * 20 +
          sessionActivity * 20
        );

        const status =
          score >= 70 ? "healthy" :
          score >= 40 ? "needs_attention" :
          "neglected";

        return {
          project,
          score,
          status,
          metrics: { memoryFreshness, avgConfidence, contextCoverage, sessionActivity },
          memoryCount,
          staleCount,
          contextItemCount,
          lastActivityAt: metrics.lastActivityAt ?? null,
        };
      });

      scores.sort((a, b) => b.score - a.score);
      return Response.json(scores);
    }

    // ============================================================
    // Phase 5: Superseded memories
    // ============================================================

    if (p === "/api/health/superseded" && req.method === "GET") {
      const rows = db.query<
        { id: number; content: string; category: string; project_scope: string | null; confidence: number; created_at: string },
        []
      >("SELECT id, content, category, project_scope, confidence, created_at FROM memories WHERE status = 'superseded' ORDER BY created_at DESC").all();
      return Response.json(rows);
    }

    // ============================================================
    // Claude config.json: GET /api/config, PUT /api/config
    // ============================================================

    if (p === "/api/config" && req.method === "GET") {
      return Response.json(readClaudeConfig());
    }

    if (p === "/api/config" && req.method === "PUT") {
      try {
        const patch = (await req.json()) as Record<string, unknown>;
        writeClaudeConfig(patch);
        return Response.json({ ok: true });
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 400 });
      }
    }

    // ============================================================
    // Graph Reasoning Search: GET /api/reasoning/search?q=<topic>&depth=2
    // ============================================================

    if (p === "/api/reasoning/search" && req.method === "GET") {
      const q = url.searchParams.get("q")?.trim();
      if (!q) return Response.json({ error: "q is required" }, { status: 400 });
      const depth = parseClampedInt(url.searchParams, "depth", 2, 1, 4);
      try {
        const queryVec = await embedText(q);
        if (!queryVec) return Response.json({ insights: null, reason: "no embedding provider configured" });
        const db = getDb();
        const similar = getSimilarMemories(db, queryVec, { limit: 1, minImportance: 1 });
        if (similar.length === 0) return Response.json({ insights: null, reason: "no relevant memories found" });
        const seedId = similar[0]!.id;
        const result = await traverseGraph(seedId, depth, false);
        const insights = buildReasoningContext(result);
        return Response.json({ seedId, insights: insights || null, chain: result.chain.length, conflicts: result.conflicts.length, reinforcements: result.reinforcements.length });
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 500 });
      }
    }

    // ============================================================
    // Graph Reasoning: GET /api/reasoning/:memoryId?depth=2
    // ============================================================

    const reasoningMatch = p.match(/^\/api\/reasoning\/(\d+)$/);
    if (reasoningMatch?.[1] && req.method === "GET") {
      const memId = parseInt(reasoningMatch[1], 10);
      const depth = parseClampedInt(url.searchParams, "depth", 2, 1, 4);
      const infer = url.searchParams.get("infer") === "true";
      try {
        const result = await traverseGraph(memId, depth, infer);
        return Response.json({
          chain: result.chain,
          conflicts: result.conflicts,
          reinforcements: result.reinforcements,
          clusters: result.clusters.map(c => c.map(n => n.id)),
          inferred: result.inferred,
        });
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 500 });
      }
    }

    const boostMatch = p.match(/^\/api\/memory\/(\d+)\/boost$/);
    if (boostMatch?.[1] && req.method === "POST") {
      const id = Number(boostMatch[1]);
      db.run("UPDATE memories SET confidence = 0.6, last_confirmed_at = datetime('now') WHERE id = ?", [id]);
      broadcast({ type: "refresh" });
      return Response.json({ ok: true });
    }

    // ============================================================
    // Cluster detection routes
    // ============================================================

    if (p === "/api/clusters" && req.method === "GET") {
      const rows = queryDb<{ id: string; label: string; color: string; node_ids: string; created_at: string; updated_at: string }>(
        "SELECT id, label, color, node_ids, created_at, updated_at FROM memory_clusters ORDER BY label"
      );
      const clusters: Cluster[] = rows.map(r => ({
        ...r,
        node_ids: JSON.parse(r.node_ids) as number[],
      }));
      return Response.json(clusters);
    }

    if (p === "/api/clusters/recompute" && req.method === "POST") {
      scheduledRecompute();
      return Response.json({ ok: true });
    }

    if (p === "/api/clusters/merge" && req.method === "POST") {
      try {
        const { sourceId, targetId } = (await req.json()) as { sourceId: string; targetId: string };
        const source = queryOne<{ node_ids: string }>("SELECT node_ids FROM memory_clusters WHERE id=?", [sourceId]);
        const target = queryOne<{ node_ids: string }>("SELECT node_ids FROM memory_clusters WHERE id=?", [targetId]);
        if (!source || !target) return Response.json({ ok: false, error: "Cluster not found" }, { status: 404 });
        const merged: number[] = [...(JSON.parse(source.node_ids) as number[]), ...(JSON.parse(target.node_ids) as number[])];
        const now = new Date().toISOString();
        db.run("UPDATE memory_clusters SET node_ids=?, updated_at=? WHERE id=?", [JSON.stringify(merged), now, targetId]);
        db.run("DELETE FROM memory_clusters WHERE id=?", [sourceId]);
        db.run("INSERT INTO cluster_overrides(cluster_id,action,payload,created_at) VALUES(?,?,?,?)", [targetId, "merge", JSON.stringify({ sourceId }), now]);
        broadcast({ type: "clusters_updated" });
        return Response.json({ ok: true });
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 400 });
      }
    }

    const clusterLabelMatch = p.match(/^\/api\/clusters\/([^/]+)\/label$/);
    if (clusterLabelMatch?.[1] && req.method === "PUT") {
      try {
        const id = decodeURIComponent(clusterLabelMatch[1]);
        const { label } = (await req.json()) as { label: string };
        const now = new Date().toISOString();
        db.run("UPDATE memory_clusters SET label=?, manual_label=1, updated_at=? WHERE id=?", [label, now, id]);
        db.run("INSERT INTO cluster_overrides(cluster_id,action,payload,created_at) VALUES(?,?,?,?)", [id, "rename", JSON.stringify({ label }), now]);
        broadcast({ type: "clusters_updated" });
        return Response.json({ ok: true });
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 400 });
      }
    }

    const clusterSplitMatch = p.match(/^\/api\/clusters\/([^/]+)\/split$/);
    if (clusterSplitMatch?.[1] && req.method === "POST") {
      try {
        const id = decodeURIComponent(clusterSplitMatch[1]);
        const { nodeIds1, nodeIds2 } = (await req.json()) as { nodeIds1: number[]; nodeIds2: number[] };
        const original = queryOne<{ label: string; color: string }>("SELECT label, color FROM memory_clusters WHERE id=?", [id]);
        if (!original) return Response.json({ ok: false, error: "Cluster not found" }, { status: 404 });
        const now = new Date().toISOString();
        const newId = `cluster-split-${Date.now()}`;
        const colors = assignClusterColors(2);
        db.run("UPDATE memory_clusters SET node_ids=?, color=?, updated_at=? WHERE id=?", [JSON.stringify(nodeIds1), colors[0] ?? original.color, now, id]);
        db.run("INSERT INTO memory_clusters(id,label,color,node_ids,manual_label,created_at,updated_at) VALUES(?,?,?,?,0,?,?)", [newId, `${original.label} (split)`, colors[1] ?? original.color, JSON.stringify(nodeIds2), now, now]);
        db.run("INSERT INTO cluster_overrides(cluster_id,action,payload,created_at) VALUES(?,?,?,?)", [id, "split", JSON.stringify({ newId, nodeIds1, nodeIds2 }), now]);
        broadcast({ type: "clusters_updated" });
        return Response.json({ ok: true });
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 400 });
      }
    }

    // ============================================================
    // Config Explorer
    // ============================================================

    if (p === "/api/config-explorer" && req.method === "GET") {
      return Response.json(getConfigExplorer());
    }

    return new Response("Not found", { status: 404 });
  },
});

// Long-lived embedding worker: drains the Honker durable queue (inert no-op
// when Honker is unavailable — short-lived hooks only enqueue, never run this).
const embeddingWorker = startEmbeddingWorker();
if (embeddingWorker.running) console.log("   Embedding worker: running (honker queue)");

// Janitor scheduling: prefer Honker's leader-elected cron (only one agent
// process fires it across the shared db); fall back to the local auto-run
// interval when Honker is unavailable.
const janitorScheduler = startJanitorScheduler();
if (janitorScheduler.running) {
  console.log("   Janitor: honker leader-elected cron");
} else {
  startAutoRun();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void embeddingWorker.stop();
    void janitorScheduler.stop();
    void ltmListener.stop();
  });
}

console.log(`🧠 LTM Graph running on http://localhost:${PORT}`);
console.log(`   PID: ${process.pid} — saved to ${PID_PATH}`);
