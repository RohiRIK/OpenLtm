/**
 * onboard.ts — 5-step LTM setup wizard.
 *
 * Steps:
 *   1. Diagnose  — env + DB health checks (abort on CRITICAL)
 *   2. Register  — project name + registry.json entry
 *   3. Goal      — capture current project goal
 *   4. Tour      — show what was saved and key commands
 *   5. Done      — write onboarded.flag
 *
 * Flags:
 *   --non-interactive  skip all prompts (use derived defaults)
 *   --force            re-run even if onboarded.flag already exists
 */
import * as p from "@clack/prompts";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, basename, dirname } from "path";
import { homedir } from "os";
import { getDb } from "./shared-db.js";
import { upsertGoal } from "./dao/contextItems.js";
import { learn } from "./db.js";

const CLAUDE_DIR = join(homedir(), ".claude");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");
const REGISTRY_PATH = join(PROJECTS_DIR, "registry.json");

export interface OnboardOptions {
  nonInteractive?: boolean;
  force?: boolean;
  cwd?: string;
}

export interface DiagnosticResult {
  label: string;
  status: "ok" | "warn" | "critical";
  detail?: string;
}

export function runDiagnostics(): DiagnosticResult[] {
  const results: DiagnosticResult[] = [];

  // Check CLAUDE_PLUGIN_DATA
  if (!process.env.CLAUDE_PLUGIN_DATA) {
    results.push({ label: "CLAUDE_PLUGIN_DATA", status: "critical", detail: "env var not set — plugin may not be installed correctly" });
  } else {
    results.push({ label: "CLAUDE_PLUGIN_DATA", status: "ok", detail: process.env.CLAUDE_PLUGIN_DATA });
  }

  // Check DB accessible
  try {
    const db = getDb();
    db.query("SELECT 1").get();
    results.push({ label: "Database", status: "ok" });
  } catch (err) {
    results.push({ label: "Database", status: "critical", detail: String(err) });
  }

  // Check registry dir
  if (!existsSync(PROJECTS_DIR)) {
    results.push({ label: "Projects dir", status: "warn", detail: `${PROJECTS_DIR} not found — will create` });
  } else {
    results.push({ label: "Projects dir", status: "ok" });
  }

  // Check hooks wired
  const settingsPath = join(CLAUDE_DIR, "settings.json");
  if (!existsSync(settingsPath)) {
    results.push({ label: "Hook wiring", status: "warn", detail: "settings.json not found — hooks may not fire" });
  } else {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as { hooks?: Record<string, unknown> };
      const hasHooks = settings.hooks && Object.keys(settings.hooks).length > 0;
      results.push({ label: "Hook wiring", status: hasHooks ? "ok" : "warn", detail: hasHooks ? undefined : "No hooks registered in settings.json" });
    } catch {
      results.push({ label: "Hook wiring", status: "warn", detail: "settings.json unreadable" });
    }
  }

  return results;
}

export function getOnboardedFlagPath(pluginDataDir?: string): string {
  const base = pluginDataDir ?? process.env.CLAUDE_PLUGIN_DATA ?? join(CLAUDE_DIR, "plugins", "data", "ltm-ltm");
  return join(base, "onboarded.flag");
}

export function isAlreadyOnboarded(pluginDataDir?: string): boolean {
  return existsSync(getOnboardedFlagPath(pluginDataDir));
}

export function writeOnboardedFlag(pluginDataDir?: string): void {
  const flagPath = getOnboardedFlagPath(pluginDataDir);
  mkdirSync(dirname(flagPath), { recursive: true });
  writeFileSync(flagPath, new Date().toISOString(), "utf-8");
}

function deriveProjectName(cwd: string): string {
  return basename(cwd).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "my-project";
}

function loadRegistry(): Record<string, string> {
  if (!existsSync(REGISTRY_PATH)) return {};
  try { return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as Record<string, string>; }
  catch { return {}; }
}

function saveRegistry(registry: Record<string, string>): void {
  mkdirSync(PROJECTS_DIR, { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), "utf-8");
}

export async function runOnboard(opts: OnboardOptions = {}): Promise<{ success: boolean; projectName?: string }> {
  const { nonInteractive = false, force = false, cwd = process.cwd() } = opts;

  // Idempotency guard
  if (!force && isAlreadyOnboarded()) {
    if (!nonInteractive) {
      p.log.warn("LTM already onboarded. Use --force to re-run.");
    }
    return { success: true };
  }

  if (!nonInteractive) {
    p.intro("Claude LTM — Project Setup Wizard");
  }

  // ── Step 1: Diagnose ─────────────────────────────────────────────────────
  const diagnostics = runDiagnostics();
  const criticals = diagnostics.filter(d => d.status === "critical");
  const warns = diagnostics.filter(d => d.status === "warn");

  if (!nonInteractive) {
    p.log.step("Step 1/5 — Diagnosing environment");
    for (const d of diagnostics) {
      const icon = d.status === "ok" ? "✅" : d.status === "warn" ? "⚠️ " : "❌";
      p.log.info(`${icon} ${d.label}${d.detail ? ": " + d.detail : ""}`);
    }
  }

  if (criticals.length > 0) {
    const msg = `CRITICAL: ${criticals.map(c => c.label).join(", ")} — fix before continuing`;
    if (!nonInteractive) p.cancel(msg);
    return { success: false };
  }

  if (!nonInteractive && warns.length > 0) {
    const cont = await p.confirm({ message: `${warns.length} warning(s) found. Continue anyway?` });
    if (p.isCancel(cont) || !cont) { p.cancel("Setup cancelled"); return { success: false }; }
  }

  // ── Step 2: Register project ─────────────────────────────────────────────
  let projectName: string;

  if (nonInteractive) {
    projectName = deriveProjectName(cwd);
  } else {
    p.log.step("Step 2/5 — Register project");
    const registry = loadRegistry();
    const existing = registry[cwd];
    const defaultName = existing ?? deriveProjectName(cwd);

    const input = await p.text({
      message: "Project name (used as key for memories and context):",
      placeholder: defaultName,
      initialValue: defaultName,
      validate: (v) => (!v || v.trim().length === 0 ? "Project name required" : undefined),
    });
    if (p.isCancel(input)) { p.cancel("Setup cancelled"); return { success: false }; }
    projectName = (input as string).trim();
  }

  const registry = loadRegistry();
  registry[cwd] = projectName;
  saveRegistry(registry);
  mkdirSync(join(PROJECTS_DIR, projectName), { recursive: true });

  if (!nonInteractive) p.log.success(`Registered "${projectName}" → ${cwd}`);

  // ── Step 3: Goal capture ─────────────────────────────────────────────────
  let goal: string;

  if (nonInteractive) {
    goal = `${projectName} — initialized via LTM onboarding`;
  } else {
    p.log.step("Step 3/5 — Capture project goal");
    const input = await p.text({
      message: "Current goal for this project (1-2 sentences):",
      placeholder: "Build a REST API for user authentication",
    });
    if (p.isCancel(input)) { p.cancel("Setup cancelled"); return { success: false }; }
    goal = (input as string).trim();
  }

  if (goal.length > 0) {
    upsertGoal(projectName, goal);
    // Also store as a memory so it survives context expiry
    learn({ content: goal, category: "architecture", importance: 3, project_scope: projectName, skipExport: true });
  }

  if (!nonInteractive) p.log.success("Goal saved");

  // ── Step 4: Tour ─────────────────────────────────────────────────────────
  if (!nonInteractive) {
    p.log.step("Step 4/5 — Tour");
    p.log.info([
      "",
      "  Key commands:",
      "    /ltm:memory recall <query>     — surface past decisions",
      "    /ltm:memory learn <insight>    — store a new insight",
      "    /ltm:health                    — check memory health",
      "    /ltm:memory propose            — review pending proposals",
      "",
      "  Context is restored automatically at each session start.",
      "  Run /ltm:doctor if context isn't injected.",
      "",
    ].join("\n"));
  }

  // ── Step 5: Done ─────────────────────────────────────────────────────────
  writeOnboardedFlag();

  if (!nonInteractive) {
    p.outro(`Done! LTM is configured for "${projectName}". Context will be restored at next session start.`);
  }

  return { success: true, projectName };
}

// CLI entry point
if (import.meta.main) {
  const args = process.argv.slice(2);
  const nonInteractive = args.includes("--non-interactive");
  const force = args.includes("--force");
  runOnboard({ nonInteractive, force }).then(result => {
    if (!result.success) process.exit(1);
  }).catch(err => { console.error(err); process.exit(1); });
}
