#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { resolveProject, registerPath, PROJECTS_DIR, CLAUDE_DIR, getDbPath } from "../lib/resolveProject.js";
import { readStdin, parseHookInput, trimToLines } from "../lib/hookUtils.js";
import { logHook } from "../lib/hookLogger.js";
import { spawnSync } from "child_process";
import { getContextMerge, getSimilarMemories, getContextMergeWithGraph } from "../../src/db.js";
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
const MAX_AGE_MS       = 30 * 24 * 60 * 60 * 1000;
const LTM_REMINDER     = "⚡ LTM MCP live — use mcp__ltm__ltm_recall before tasks, mcp__ltm__ltm_learn after discoveries.\n";
const LTM_REPO_SLUG    = "RohiRIK/claude-ltm-plugin";
// T6: Imperative directive - injected before memories when autoRecall is not disabled
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

    // Attempt semantic retrieval if we have API key + session context
    const queryVec = sessionContext ? await embedText(sessionContext) : null;
    if (queryVec) {
      const db = getDb();
      globals = getSimilarMemories(db, queryVec, { minImportance: 4, limit: 16 });
      scoped  = getSimilarMemories(db, queryVec, { projectScope: project, minImportance: 2, limit: 15 });
      process.stderr.write(`[SessionStart] Semantic LTM: ${globals.length} globals, ${scoped.length} scoped\n`);
    } else {
      // Fallback: importance + decay ranking
      const merged = getContextMerge(project) as {
        globals: Array<{ id: number; content: string }>;
        scoped:  Array<{ id: number; content: string; importance: number }>;
      };
      globals = merged.globals;
      scoped  = merged.scoped;
    }

    // Graph reasoning: append insights if enabled
    try {
      const cfg = readConfigSync();
      if (cfg?.ltm?.graphReasoning) {
        const withGraph = await getContextMergeWithGraph(project);
        graphInsights = withGraph.graphInsights;
      }
    } catch (_) {}

    if (globals.length === 0 && scoped.length === 0) return "";

    const lines: string[] = ["LTM:", ""];

    if (globals.length > 0) {
      lines.push("globals:");
      for (const m of globals) lines.push(`- [${m.id}] ${m.content}`);
      lines.push("");
    }

    if (scoped.length > 0) {
      lines.push("project:");
      for (const m of scoped) lines.push(`- [${m.id}] ${m.content}`);
      lines.push("");
    }

    if (graphInsights) {
      lines.push(graphInsights);
      lines.push("");
    }

    const allLines = lines.join("\n").split("\n");
    if (allLines.length > MAX_LTM_LINES) {
      return allLines.slice(0, MAX_LTM_LINES).join("\n") + "\n… (truncated)\n";
    }
    return lines.join("\n");
  } catch (_) {
    return "";
  }
}

function refreshMarketplaceClone(): void {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (!pluginRoot) return;
  // Fire-and-forget git fetch so `claude plugin update` sees the latest version
  spawnSync("git", ["fetch", "--quiet"], {
    cwd: pluginRoot,
    stdio: "ignore",
    timeout: 5000,
  });
}

// The plugin system reverts known_marketplaces.json to source:"git" after each update.
// "git" requires a local git fetch to detect new versions; "github" uses the API instantly.
// Re-patching every session ensures update checks always use the faster GitHub API path.
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
  } catch { /* file missing or malformed — non-fatal, session start must not be blocked */ }
}

async function main(): Promise<void> {
  refreshMarketplaceClone();
  patchMarketplaceSource();

  // Run pending LTM schema migrations before anything else
  try {
    const results = await runPendingMigrations();
    if (results.length > 0) {
      process.stderr.write(`[SessionStart] Applied ${results.length} migration(s)\n`);
    }
  } catch (e) {
    process.stderr.write(`[SessionStart] Migration warning: ${e}\n`);
  }

  const raw = await readStdin();
  const parsed = parseHookInput(raw);

  // Reset tool counter
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(COUNTER_FILE, "0");

  if (!parsed) {
    logHook("SessionStart", "warn", "No cwd in input, skipping context injection");
    console.error("[SessionStart] No cwd in input, skipping context injection");
    return;
  }

  const { cwd } = parsed;
  const { name, projectDir, isNew, registeredPath } = resolveProject(cwd);

  if (isNew) {
    const suggested = defaultName(cwd);
    registerPath(cwd, suggested);
    mkdirSync(join(PROJECTS_DIR, suggested), { recursive: true });

    process.stdout.write(
      `# New Project Detected\n\n` +
      `No context files found for: \`${cwd}\`\n\n` +
      `I've registered this project as **"${suggested}"** in the context registry.\n` +
      `Context will be saved to \`~/.claude/projects/${suggested}/\`\n\n` +
      `If you'd like a different name, run: \`/register-project\`\n\n` +
      `Should I create the 4 context files now so your work is saved across sessions? (yes/no)\n`
    );
    return;
  }

  // Regenerate context-summary.md from DB before reading it
  if (existsSync(DB_PATH)) {
    try {
      exportContextMarkdown(name);
    } catch (_) {}
  }

  const summaryPath = join(projectDir, "context-summary.md");

  if (!existsSync(summaryPath)) {
    const contextFiles = ["context-goals.md", "context-decisions.md", "context-progress.md", "context-gotchas.md"];
    if (!contextFiles.some(f => existsSync(join(projectDir, f)))) {
      process.stdout.write(
        `# Project Registered — No Context Files Yet\n\n` +
        `Project **"${name}"** is registered but has no context files.\n` +
        `Should I create them now? (yes/no)\n`
      );
    }
    return;
  }

  if (Date.now() - statSync(summaryPath).mtimeMs > MAX_AGE_MS) {
    logHook("SessionStart", "warn", `Context for "${name}" is older than 30 days — skipping`);
    console.error(`[SessionStart] Context for "${name}" is older than 30 days — skipping`);
    return;
  }

  const summaryText = readFileSync(summaryPath, "utf-8");
  const injected = trimToLines(summaryText, MAX_INJECT_LINES);
  // Use first ~500 chars of summary as semantic query context
  const sessionContext = summaryText.slice(0, 500).trim() || undefined;
  
  // T6: Check autoRecall config - inject directive unless explicitly disabled
  let useDirective = true;
  try {
    const cfg = readConfigSync();
    useDirective = cfg?.ltm?.autoRecall !== false;
  } catch (_) {}
  
  const ltmSection = await buildLtmSection(name, sessionContext);
  const directive = useDirective ? LTM_DIRECTIVE : "";

  const output = ltmSection
    ? `${injected}\n\n${directive}${ltmSection}\n${LTM_REMINDER}`
    : `${injected}\n${directive}${LTM_REMINDER}`;

  process.stdout.write(output);
  logHook("SessionStart", "info", `Injected context for "${name}" (${registeredPath ? "registry" : "slug fallback"})`);
}

main();
