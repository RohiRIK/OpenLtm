#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { resolveProject, registerPath, PROJECTS_DIR, CLAUDE_DIR, getDbPath } from "../lib/resolveProject.js";
import { readStdin, parseHookInput, trimToLines, readFileSafe, safeRun } from "../lib/hookUtils.js";
import { logHook, logEvent } from "../lib/hookLogger.js";
import { EVENTS } from "../lib/eventNames.js";
import { spawnSync } from "child_process";
import { getContextMerge, getSimilarMemories, getContextMergeWithGraph, computeDecayScore,
         embedText, getDb, listMemoryIdsMissingEmbedding, exportContextMarkdown,
         runPendingMigrations, getRecentConflicts, emitEvent } from "@rohirik/ltm-core";
import { readConfigSync } from "../../src/config.js";

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
  } catch (err) {
    process.stderr.write(`[SessionStart:buildLtmSection] ${err}\n`);
    return "";
  }
}

function buildConflictSection(project: string): string {
  if (!existsSync(DB_PATH)) return "";
  try {
    const db = getDb();
    const conflicts = getRecentConflicts(db, project, MAX_CONFLICT_LINES);

    if (conflicts.length === 0) return "";

    const lines: string[] = ["⚠️ Memory Conflicts Detected", ""];
    for (const c of conflicts) {
      lines.push(`- [${c.olderId}] superseded by [${c.newerId}]`);
    }
    if (conflicts.length >= MAX_CONFLICT_LINES) {
      lines.push(`… and ${conflicts.length - MAX_CONFLICT_LINES + 1} more conflicts`);
    }
    return lines.join("\n");
  } catch (err) {
    process.stderr.write(`[SessionStart:buildConflictSection] ${err}\n`);
    return "";
  }
}

const BACKFILL_HINT_FILE = join(TMP_DIR, "ltm-backfill-hint.flag");

function buildBackfillHint(): string {
  if (!existsSync(DB_PATH)) return "";
  try {
    const cfg = readConfigSync();
    if (!cfg.embeddings || cfg.embeddings.provider === "disabled") return "";

    const today = new Date().toISOString().slice(0, 10);
    try {
      if (readFileSync(BACKFILL_HINT_FILE, "utf-8").trim() === today) return "";
    } catch { /* file absent — first run today */ }

    const db = getDb();
    const missing = listMemoryIdsMissingEmbedding(db, 1);
    if (missing.length === 0) return "";

    writeFileSync(BACKFILL_HINT_FILE, today);
    return `\n💡 Embedding backfill: ${cfg.embeddings.provider} provider is configured but some memories lack embeddings. Run \`/ltm:admin backfill\` to enable semantic recall.\n`;
  } catch {
    return "";
  }
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

  if (!parsed) {
    process.stderr.write("[SessionStart] No cwd in input, skipping context injection\n");
    process.stdout.write("**Context not restored:** registry_miss\n");
    return;
  }
  const { cwd } = parsed;
  const { name, projectDir, isNew, registeredPath } = resolveProject(cwd);

  // P5-0.5: auto-onboard on first SessionStart (global flag, fire-once)
  const pluginData = process.env.CLAUDE_PLUGIN_DATA ?? join(CLAUDE_DIR, "plugins", "data", "ltm-ltm");
  const onboardedFlagPath = join(pluginData, "onboarded.flag");
  if (!existsSync(onboardedFlagPath)) {
    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
    if (pluginRoot) {
      spawnSync("bun", ["run", join(pluginRoot, "src", "onboard.ts"), "--non-interactive"],
        { stdio: "pipe", timeout: 30_000 });
    }
    const displayName = isNew ? defaultName(cwd) : name;
    process.stdout.write(`LTM: auto-onboarded "${displayName}" — run /ltm:onboard to customize\n`);
  }

  if (isNew) {
    const suggested = defaultName(cwd);
    registerPath(cwd, suggested);
    mkdirSync(join(PROJECTS_DIR, suggested), { recursive: true });
    process.stdout.write(
      `**Context not restored:** fresh_project\n\n` +
      `# New Project Detected\n\nNo context files found for: \`${cwd}\`\n\n` +
      `I've registered this project as **"${suggested}"**.\n` +
      `Should I create the 4 context files now? (yes/no)\n`,
    );
    return;
  }

  if (existsSync(DB_PATH)) { try { exportContextMarkdown(name); } catch (_) {} } // silent: export failure doesn't block context injection

  const summaryPath = join(projectDir, "context-summary.md");
  if (!existsSync(summaryPath)) {
    const contextFiles = ["context-goals.md", "context-decisions.md", "context-progress.md", "context-gotchas.md"];
    if (!contextFiles.some(f => existsSync(join(projectDir, f)))) {
      process.stdout.write(
        `**Context not restored:** fresh_project\n\n` +
        `# Project Registered — No Context Files Yet\n\nProject **"${name}"** has no context files.\nShould I create them now? (yes/no)\n`,
      );
    } else {
      process.stdout.write(`**Context not restored:** fresh_project\n`);
    }
    return;
  }

  if (Date.now() - statSync(summaryPath).mtimeMs > MAX_AGE_MS) {
    process.stderr.write(`[SessionStart] Context for "${name}" is older than 30 days — skipping\n`);
    process.stdout.write(`**Context not restored:** stale_context\n`);
    return;
  }

  const summaryText = readFileSync(summaryPath, "utf-8");
  const injected = trimToLines(summaryText, MAX_INJECT_LINES);
  const sessionContext = summaryText.slice(0, 500).trim() || undefined;

  let useDirective = true;
  try { const cfg = readConfigSync(); useDirective = cfg?.ltm?.autoRecall !== false; } catch (_) {} // silent: missing/malformed config falls back to default (autoRecall=true)

  // Override injectTopN from project settings if set
  const injectTopN = readConfigSync().ltm?.injectTopN ?? 15;
  const ltmSection = await buildLtmSection(name, sessionContext);
  const directive = useDirective ? LTM_DIRECTIVE : "";
  const conflictSection = buildConflictSection(name);
  const backfillHint = buildBackfillHint();

  // Count memories for panel header
  const memoryCount = ltmSection
    ? ltmSection.split("\n").filter(l => l.startsWith("- [")).length
    : 0;
  const ctxLines = trimToLines(summaryText, MAX_INJECT_LINES).split("\n").filter(Boolean).length;
  const slug = name.slice(0, 24);
  const statusLine = `## LTM Session: ${slug} | restored: ${ctxLines} ctx items, ${memoryCount} top memories\n`;

  // Build output: status line + injected + directive + ltmSection + conflicts + reminder + backfill hint
  let output = statusLine + "\n" + injected;
  if (ltmSection) {
    output += `\n\n${directive}${ltmSection}`;
    if (conflictSection) output += `\n${conflictSection}`;
    output += `\n${LTM_REMINDER}`;
  } else {
    output += `\n${directive}${LTM_REMINDER}`;
  }
  if (backfillHint) output += backfillHint;

  process.stdout.write(output);
  logHook("SessionStart", "info", `Injected context for "${name}" (${registeredPath ? "registry" : "slug fallback"})`);
  logEvent("SessionStart", EVENTS.SESSION_START, { project: name });
  emitEvent({ hook: "SessionStart", event: EVENTS.SESSION_START, project: name, count: memoryCount, ts: new Date().toISOString() });
}

safeRun("SessionStart", main).then(result => {
  if (!result.ok) {
    process.stdout.write("**Context not restored:** hook_error (check /ltm:health)\n");
  }
});
