#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { resolveProject, registerPath, PROJECTS_DIR, CLAUDE_DIR, getDbPath } from "../lib/resolveProject.js";
import { readStdin, parseHookInput, trimToLines, readFileSafe } from "../lib/hookUtils.js";
import { logHook } from "../lib/hookLogger.js";
import { spawnSync } from "child_process";
import { getContextMerge, getSimilarMemories, getContextMergeWithGraph, computeDecayScore } from "../../src/db.js";
import { embedText } from "../../src/embeddings.js";
import { getDb } from "../../src/shared-db.js";
import { readConfigSync } from "../../src/config.js";
import { exportContextMarkdown } from "../../src/context.js";
import { runPendingMigrations } from "../../src/migrations.js";

const TMP_DIR      = join(CLAUDE_DIR, "tmp");
const COUNTER_FILE = join(TMP_DIR, "session-tool-count.txt");
const DB_PATH      = getDbPath();
const MAX_INJECT_LINES = 60;
const MAX_LTM_LINES    = 30;
const MAX_CONFLICT_LINES = 5;
const MAX_AGE_MS       = 30 * 24 * 60 * 60 * 1000;
const LTM_REMINDER     = "⚡ LTM MCP live — use mcp__ltm__ltm_recall before tasks, mcp__ltm__ltm_learn after discoveries.\n";
const LTM_REPO_SLUG    = "RohiRIK/claude-ltm-plugin";
const LTM_DIRECTIVE   = "⚡ LTM Active — Before starting work: call `ltm_recall` with task keywords. Check `ltm_context` for project state. After decisions: call `ltm_learn` to store them.\n\n";

function defaultName(cwd: string): string {
  const last = cwd.replace(/\/$/, "").split("/").pop() ?? "";
  return last.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function buildLtmSection(project: string, sessionContext?: string): Promise<string> {
  if (!existsSync(DB_PATH)) return "";
  try {
    let globals: Array<{ id: number; content: string }>;
    let scoped: Array<{ id: number; content: string; importance: number }>;
    let graphInsights: string | undefined;

    const queryVec = sessionContext ? await embedText(sessionContext) : null;
    if (queryVec) {
      const db = getDb();
      globals = getSimilarMemories(db, queryVec, { minImportance: 4, limit: 16 });
      scoped  = getSimilarMemories(db, queryVec, { projectScope: project, minImportance: 2, limit: 15 });
      process.stderr.write(`[SessionStart] Semantic LTM: ${globals.length} globals, ${scoped.length} scoped\n`);
    } else {
      const merged = getContextMerge(project) as { globals: Array<{ id: number; content: string }>; scoped: Array<{ id: number; content: string; importance: number }> };
      globals = merged.globals;
      scoped  = merged.scoped;
    }

    const cfg = readConfigSync();
    if (cfg?.ltm?.graphReasoning) {
      const withGraph = await getContextMergeWithGraph(project);
      graphInsights = withGraph.graphInsights;
    }

    if (globals.length === 0 && scoped.length === 0) return "";

    const lines: string[] = ["LTM:", ""];
    if (globals.length > 0) { lines.push("globals:"); for (const m of globals) lines.push(`- [${m.id}] ${m.content}`); lines.push(""); }
    if (scoped.length > 0) { lines.push("project:"); for (const m of scoped) lines.push(`- [${m.id}] ${m.content}`); lines.push(""); }
    if (graphInsights) { lines.push(graphInsights); lines.push(""); }

    const allLines = lines.join("\n").split("\n");
    if (allLines.length > MAX_LTM_LINES) return allLines.slice(0, MAX_LTM_LINES).join("\n") + "\n… (truncated)\n";
    return lines.join("\n");
  } catch (_) { return ""; }
}

function buildConflictSection(project: string): string {
  if (!existsSync(DB_PATH)) return "";
  try {
    const db = getDb();
    // T13: Query recently superseded memories (last 7 days)
    const conflicts = db.query(
      `SELECT m1.id as olderId, m1.content as olderContent, m2.id as newerId, m2.content as newerContent
       FROM memories m1
       JOIN memories m2 ON m1.superseded_by = m2.id
       WHERE (m1.project_scope = ? OR (m1.project_scope IS NULL AND ? IS NULL))
         AND m1.superseded_at > datetime('now', '-7 days')
       LIMIT ?`
    ).all(project, project, MAX_CONFLICT_LINES) as Array<{ olderId: number; olderContent: string; newerId: number; newerContent: string }>;

    if (conflicts.length === 0) return "";

    const lines: string[] = ["⚠️ Memory Conflicts Detected", ""];
    for (const c of conflicts) {
      lines.push(`- [${c.olderId}] superseded by [${c.newerId}]`);
    }
    if (conflicts.length >= MAX_CONFLICT_LINES) {
      lines.push(`… and ${conflicts.length - MAX_CONFLICT_LINES + 1} more conflicts`);
    }
    return lines.join("\n");
  } catch (_) { return ""; }
}

function refreshMarketplaceClone(): void {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (!pluginRoot) return;
  spawnSync("git", ["fetch", "--quiet"], { cwd: pluginRoot, stdio: "ignore", timeout: 5000 });
}

function patchMarketplaceSource(): void {
  const knownPath = join(CLAUDE_DIR, "plugins", "known_marketplaces.json");
  try {
    const data = JSON.parse(readFileSync(knownPath, "utf-8")) as Record<string, unknown>;
    const ltm = data["ltm"] as Record<string, unknown> | undefined;
    const src = ltm?.["source"] as Record<string, unknown> | undefined;
    if (src?.["source"] === "git" && String(src?.["url"] ?? "").includes(LTM_REPO_SLUG)) {
      data["ltm"] = { ...ltm, source: { source: "github", repo: LTM_REPO_SLUG } };
      writeFileSync(knownPath, JSON.stringify(data, null, 2));
    }
  } catch {}
}

async function main(): Promise<void> {
  refreshMarketplaceClone();
  patchMarketplaceSource();

  try { const results = await runPendingMigrations(); if (results.length > 0) process.stderr.write(`[SessionStart] Applied ${results.length} migration(s)\n`); }
  catch (e) { process.stderr.write(`[SessionStart] Migration warning: ${e}\n`); }

  const raw = await readStdin();
  const parsed = parseHookInput(raw);
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(COUNTER_FILE, "0");

  if (!parsed) { console.error("[SessionStart] No cwd in input, skipping context injection"); return; }
  const { cwd } = parsed;
  const { name, projectDir, isNew, registeredPath } = resolveProject(cwd);

  if (isNew) {
    const suggested = defaultName(cwd);
    registerPath(cwd, suggested);
    mkdirSync(join(PROJECTS_DIR, suggested), { recursive: true });
    process.stdout.write(`# New Project Detected\n\nNo context files found for: \`${cwd}\`\n\nI've registered this project as **"${suggested}"**.\nShould I create the 4 context files now? (yes/no)\n`);
    return;
  }

  if (existsSync(DB_PATH)) { try { exportContextMarkdown(name); } catch (_) {} }

  const summaryPath = join(projectDir, "context-summary.md");
  if (!existsSync(summaryPath)) {
    const contextFiles = ["context-goals.md", "context-decisions.md", "context-progress.md", "context-gotchas.md"];
    if (!contextFiles.some(f => existsSync(join(projectDir, f)))) {
      process.stdout.write(`# Project Registered — No Context Files Yet\n\nProject **"${name}"** has no context files.\nShould I create them now? (yes/no)\n`);
    }
    return;
  }

  if (Date.now() - statSync(summaryPath).mtimeMs > MAX_AGE_MS) {
    console.error(`[SessionStart] Context for "${name}" is older than 30 days — skipping`);
    return;
  }

  const summaryText = readFileSync(summaryPath, "utf-8");
  const injected = trimToLines(summaryText, MAX_INJECT_LINES);
  const sessionContext = summaryText.slice(0, 500).trim() || undefined;

  let useDirective = true;
  try { const cfg = readConfigSync(); useDirective = cfg?.ltm?.autoRecall !== false; } catch (_) {}

  // Override injectTopN from project settings if set
  const injectTopN = readConfigSync().ltm?.injectTopN ?? 15;
  const ltmSection = await buildLtmSection(name, sessionContext);
  const directive = useDirective ? LTM_DIRECTIVE : "";
  const conflictSection = buildConflictSection(name);

  // Build output: injected + directive + ltmSection + conflicts + reminder
  let output = injected;
  if (ltmSection) {
    output += `\n\n${directive}${ltmSection}`;
    if (conflictSection) output += `\n${conflictSection}`;
    output += `\n${LTM_REMINDER}`;
  } else {
    output += `\n${directive}${LTM_REMINDER}`;
  }

  process.stdout.write(output);
  logHook("SessionStart", "info", `Injected context for "${name}" (${registeredPath ? "registry" : "slug fallback"})`);
}

main();
