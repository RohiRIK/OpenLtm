#!/usr/bin/env bun
/**
 * SessionStart.ts — restore project context + LTM memories into a new context window.
 *
 * Source-aware (hook input `source`, matcher "" fires on all four):
 *   startup  fresh session: reset tool counter, auto-onboard once, new-project prompts
 *   clear    /clear: reset tool counter, new-project prompts, no onboarding
 *   resume   --resume/--continue: inject, but no onboarding or prompts
 *   compact  after compaction: lead with the PreCompact snapshot, no prompts
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import { resolveProject, registerPath, PROJECTS_DIR, CLAUDE_DIR, getDbPath } from "../lib/resolveProject.js";
import { readStdin, parseHookInput, safeRun } from "../lib/hookUtils.js";
import { logHook, logEvent } from "../lib/hookLogger.js";
import { EVENTS } from "../lib/eventNames.js";
import { trimSummary } from "../lib/summaryTrim.js";
import { recordInjectedIds } from "../lib/promptRecall.js";
import { getContextMerge, getSimilarMemories, getContextMergeWithGraph,
         embedText, getDb, listMemoryIdsMissingEmbedding, exportContextMarkdown,
         waitForInit, getRecentConflicts, emitEvent, listPendingProposals } from "@rohirik/openltm-core";
import { readConfigSync } from "../../src/config.js";
import type { Config } from "../../src/config.js";

type Source = "startup" | "resume" | "clear" | "compact";
type Cfg = Partial<Config>;

const TMP_DIR      = join(CLAUDE_DIR, "tmp");
const COUNTER_FILE = join(TMP_DIR, "session-tool-count.txt");
const DB_PATH      = getDbPath();
// hooks/src/SessionStart.ts → plugin root (dev clones have no CLAUDE_PLUGIN_ROOT)
const PLUGIN_ROOT  = process.env.CLAUDE_PLUGIN_ROOT ?? join(import.meta.dir, "..", "..");
const MAX_INJECT_LINES   = 60;
const MAX_CONFLICT_LINES = 5;
const MAX_GRAPH_LINES    = 10;
const GLOBALS_LIMIT      = 10;
const DEFAULT_SCOPED_LIMIT = 15;
const MAX_AGE_MS         = 30 * 24 * 60 * 60 * 1000;
const ONBOARD_TIMEOUT_MS = 10_000; // stays inside the 15s SessionStart hook timeout
const LTM_REMINDER     = "⚡ LTM MCP live — use mcp__plugin_openltm_memory__recall before tasks, mcp__plugin_openltm_memory__learn after discoveries.\n";
const LTM_DIRECTIVE    = "⚡ LTM Active — Before starting work: call `recall` with task keywords. Check `context` for project state. After decisions: call `learn` to store them.\n\n";

function parseSource(value: unknown): Source {
  // Older Claude Code builds omit `source`; treat that as a fresh startup.
  return value === "resume" || value === "clear" || value === "compact" ? value : "startup";
}

function defaultName(cwd: string): string {
  const last = cwd.replace(/\/$/, "").split("/").pop() ?? "";
  return last.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
}

function scopedLimit(cfg: Cfg): number {
  const n = cfg.ltm?.injectTopN;
  return typeof n === "number" && Number.isFinite(n) ? Math.max(1, Math.min(50, Math.floor(n))) : DEFAULT_SCOPED_LIMIT;
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, " ").trim();

async function buildLtmSection(project: string, cfg: Cfg, sessionContext?: string): Promise<{ text: string; ids: number[] }> {
  const none = { text: "", ids: [] };
  if (!existsSync(DB_PATH)) return none;
  try {
    const limit = scopedLimit(cfg);
    const queryVec = sessionContext ? await embedText(sessionContext) : null;
    const merged = cfg.ltm?.graphReasoning
      ? await getContextMergeWithGraph(project)
      : queryVec ? null : getContextMerge(project);

    let globals: Array<{ id: number; content: string }>;
    let scoped: Array<{ id: number; content: string }>;
    if (queryVec) {
      const db = getDb();
      globals = getSimilarMemories(db, queryVec, { minImportance: 4, limit: GLOBALS_LIMIT });
      scoped  = getSimilarMemories(db, queryVec, { projectScope: project, minImportance: 2, limit });
      process.stderr.write(`[SessionStart] Semantic LTM: ${globals.length} globals, ${scoped.length} scoped\n`);
    } else {
      globals = merged!.globals;
      scoped  = merged!.scoped;
    }
    // Capped separately so a large global set can never crowd out project memories.
    globals = globals.slice(0, GLOBALS_LIMIT);
    scoped  = scoped.slice(0, limit);
    const graphInsights = (merged as { graphInsights?: string } | null)?.graphInsights;

    if (globals.length === 0 && scoped.length === 0) return none;

    const lines: string[] = ["LTM:", ""];
    if (globals.length > 0) lines.push("globals:", ...globals.map(m => `- [${m.id}] ${oneLine(m.content)}`), "");
    if (scoped.length > 0)  lines.push("project:", ...scoped.map(m => `- [${m.id}] ${oneLine(m.content)}`), "");
    if (graphInsights) lines.push(...graphInsights.split("\n").slice(0, MAX_GRAPH_LINES), "");
    return { text: lines.join("\n"), ids: [...globals, ...scoped].map(m => m.id) };
  } catch (err) {
    process.stderr.write(`[SessionStart:buildLtmSection] ${err}\n`);
    return none;
  }
}

function buildConflictSection(project: string): string {
  if (!existsSync(DB_PATH)) return "";
  try {
    const conflicts = getRecentConflicts(getDb(), project, MAX_CONFLICT_LINES);
    if (conflicts.length === 0) return "";

    const lines: string[] = ["⚠️ Memory Conflicts Detected", ""];
    for (const c of conflicts) lines.push(`- [${c.olderId}] superseded by [${c.newerId}]`);
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

function buildBackfillHint(cfg: Cfg): string {
  if (!existsSync(DB_PATH)) return "";
  try {
    if (!cfg.embeddings || cfg.embeddings.provider === "disabled") return "";

    const today = new Date().toISOString().slice(0, 10);
    try {
      if (readFileSync(BACKFILL_HINT_FILE, "utf-8").trim() === today) return "";
    } catch { /* file absent — first run today */ }

    if (listMemoryIdsMissingEmbedding(getDb(), 1).length === 0) return "";

    writeFileSync(BACKFILL_HINT_FILE, today);
    return `\n💡 Embedding backfill: ${cfg.embeddings.provider} provider is configured but some memories lack embeddings. Run \`/openltm:admin backfill\` to enable semantic recall.\n`;
  } catch {
    return "";
  }
}

/** EvaluateSession queues proposals in ${CLAUDE_PLUGIN_DATA}/proposals; surface them so they get reviewed. */
function buildProposalsNotice(): string {
  try {
    const n = listPendingProposals().length;
    return n > 0 ? `💡 ${n} memory proposal(s) pending — review with /openltm:memory propose review\n` : "";
  } catch {
    return "";
  }
}

/**
 * First-ever startup: run onboard.ts non-interactively (fire-once via onboarded.flag).
 * Returns null when not applicable, else whether the flag now exists.
 */
function autoOnboard(cwd: string): "done" | "failed" | null {
  const pluginData = process.env.CLAUDE_PLUGIN_DATA;
  // onboard.ts treats a missing CLAUDE_PLUGIN_DATA as critical (not a plugin
  // install), so a spawn could only fail — and would retry every session.
  if (!pluginData) return null;
  const flag = join(pluginData, "onboarded.flag");
  if (existsSync(flag)) return null;
  const script = join(PLUGIN_ROOT, "src", "onboard.ts");
  if (existsSync(script)) {
    // process.execPath, not "bun": hooks run with a stripped PATH (see bin/run-hook.sh).
    spawnSync(process.execPath, ["run", script, "--non-interactive"],
      { cwd, stdio: "pipe", timeout: ONBOARD_TIMEOUT_MS });
  }
  return existsSync(flag) ? "done" : "failed";
}

async function main(): Promise<void> {
  const cfg: Cfg = readConfigSync();

  // Full init (schema.sql, then migrations) before anything reads the DB or
  // onboarding spawns. A bare runPendingMigrations() skips schema.sql and fails
  // on a brand-new DB, leaving later queries racing an unmigrated schema.
  try { await waitForInit(); }
  catch (e) { process.stderr.write(`[SessionStart] Migration warning: ${e}\n`); }

  const parsed = parseHookInput(await readStdin());
  const source = parseSource(parsed?.input.source);
  const sessionId = typeof parsed?.input.session_id === "string" ? parsed.input.session_id : undefined;
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
  // The tool counter spans one conversation: resume/compact continue it.
  if (source === "startup" || source === "clear") writeFileSync(COUNTER_FILE, "0");

  if (!parsed) {
    process.stderr.write("[SessionStart] No cwd in input, skipping context injection\n");
    process.stdout.write("**Context not restored:** registry_miss\n");
    return;
  }
  const { cwd } = parsed;
  const promptsAllowed = source === "startup" || source === "clear";

  const { isNew } = resolveProject(cwd);
  if (isNew) {
    const suggested = defaultName(cwd);
    registerPath(cwd, suggested);
    mkdirSync(join(PROJECTS_DIR, suggested), { recursive: true });
  }
  const onboard = source === "startup" ? autoOnboard(cwd) : null;
  // Resolve after registration/onboarding so every message shows the final name.
  const { name, projectDir, registeredPath } = resolveProject(cwd);

  let output = "";
  if (onboard === "done") output += `LTM: auto-onboarded "${name}" — run /openltm:onboard to customize\n`;
  if (onboard === "failed") output += `LTM: auto-onboarding did not complete — run /openltm:onboard to set up\n`;

  const summaryPath = join(projectDir, "context-summary.md");
  // On compact, PreCompact just wrote the snapshot — re-exporting from the DB would overwrite it.
  if (!isNew && existsSync(DB_PATH) && !(source === "compact" && existsSync(summaryPath))) {
    try { exportContextMarkdown(name); } catch { /* export failure doesn't block context injection */ }
  }

  let summaryText = "";
  let notRestored = "";
  if (isNew || !existsSync(summaryPath)) {
    notRestored = "fresh_project";
  } else if (Date.now() - statSync(summaryPath).mtimeMs > MAX_AGE_MS) {
    process.stderr.write(`[SessionStart] Context for "${name}" is older than 30 days — skipping\n`);
    notRestored = "stale_context";
  } else {
    summaryText = readFileSync(summaryPath, "utf-8");
  }

  const ltm = await buildLtmSection(name, cfg, summaryText.slice(0, 500).trim() || undefined);

  if (summaryText) {
    const injected = trimSummary(summaryText, MAX_INJECT_LINES);
    const ctxLines = injected.split("\n").filter(Boolean).length;
    const label = source === "compact" ? "compaction snapshot" : "restored";
    output += `## LTM Session: ${name.slice(0, 24)} | ${label}: ${ctxLines} ctx items, ${ltm.ids.length} top memories\n\n${injected}`;
  } else {
    output += `**Context not restored:** ${notRestored}\n`;
    if (promptsAllowed && isNew) {
      output += `\n# New Project Detected\n\nNo context files found for: \`${cwd}\`\n\n` +
        `I've registered this project as **"${name}"**.\nShould I create the 4 context files now? (yes/no)\n`;
    } else if (promptsAllowed && notRestored === "fresh_project") {
      const contextFiles = ["context-goals.md", "context-decisions.md", "context-progress.md", "context-gotchas.md"];
      if (!contextFiles.some(f => existsSync(join(projectDir, f)))) {
        output += `\n# Project Registered — No Context Files Yet\n\nProject **"${name}"** has no context files.\nShould I create them now? (yes/no)\n`;
      }
    }
  }

  const directive = cfg.ltm?.autoRecall !== false ? LTM_DIRECTIVE : "";
  if (ltm.text) {
    output += `\n\n${directive}${ltm.text}`;
    const conflictSection = buildConflictSection(name);
    if (conflictSection) output += `\n${conflictSection}`;
    output += `\n${LTM_REMINDER}`;
  } else {
    output += `\n${directive}${LTM_REMINDER}`;
  }
  output += buildProposalsNotice();
  output += buildBackfillHint(cfg);

  process.stdout.write(output);
  // Seed UserPromptSubmit's per-session dedupe; a new context window (anything
  // but resume) starts a fresh set so prompt recall may surface them again.
  recordInjectedIds(sessionId, ltm.ids, { reset: source !== "resume" });
  logHook("SessionStart", "info", `Injected context for "${name}" (${source}, ${registeredPath ? "registry" : "slug fallback"})`);
  logEvent("SessionStart", EVENTS.SESSION_START, { project: name, count: ltm.ids.length, detail: source });
  emitEvent({ hook: "SessionStart", event: EVENTS.SESSION_START, project: name, count: ltm.ids.length, ts: new Date().toISOString() });
}

safeRun("SessionStart", main).then(result => {
  if (!result.ok) {
    process.stdout.write("**Context not restored:** hook_error (check /openltm:health)\n");
  }
});
