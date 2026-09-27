#!/usr/bin/env bun
/**
 * catalog-check.ts — validate the Hermes catalog entry before submitting it.
 *
 * The catalog is admitted by a reviewed PR whose CI checks schema, SHA format,
 * and reachability. This script checks the same things locally *and* goes one
 * step further: it cross-checks every declared tool and hook against the actual
 * plugin source, so a renamed tool fails here instead of in someone else's
 * review queue.
 *
 * Usage: bun run catalog:check
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const root = join(import.meta.dir, "..");
const entryPath = join(root, "hermes", "plugin-catalog", "openltm.yaml");
const pluginPath = join(root, "hermes", "openltm_hermes", "__init__.py");

let failed = 0;
let checked = 0;

function ok(label: string, detail = ""): void {
  checked++;
  console.log(`  OK  ${label}${detail ? ` → ${detail}` : ""}`);
}

function fail(label: string, detail: string): void {
  checked++;
  failed++;
  console.log(`FAIL  ${label} — ${detail}`);
}

// ── Minimal YAML reader for the flat/one-level-list subset the schema uses ──

function parseEntry(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentList: string[] | null = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line || line.trimStart().startsWith("#")) continue;

    // "- item" inside a list
    const item = /^\s+-\s+(.+)$/.exec(line);
    if (item && currentList) {
      currentList.push(unquote(item[1]!));
      continue;
    }

    // "key:" or "key: value"
    const pair = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (pair) {
      const key = pair[1]!;
      const value = pair[2]!;
      if (value === "") {
        currentKey = key;
        currentList = [];
        root[key] = currentList;
      } else {
        currentKey = null;
        currentList = null;
        root[key] = unquote(value);
      }
      continue;
    }

    // Indented "key: value" under a list-holding key (e.g. capabilities:)
    const nested = /^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.+)$/.exec(line);
    if (nested && currentKey) {
      const container = root[currentKey];
      if (Array.isArray(container)) {
        // Represent the nested map as a sibling list so it can be inspected.
        (root as Record<string, unknown>)[`${currentKey}.${nested[1]}`] = unquote(nested[2]!);
      }
    }
  }
  return root;
}

function unquote(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/** Read a list under `capabilities.<name>`. */
function capabilityList(entry: Record<string, unknown>, name: string): string[] {
  const direct = entry[`capabilities.${name}`];
  if (Array.isArray(direct)) return direct as string[];

  // Fall back to a line-based scan for the list form.
  const lines = readFileSync(entryPath, "utf-8").split("\n");
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (new RegExp(`^\\s*${name}:`).test(line)) {
      inside = true;
      continue;
    }
    if (inside) {
      const item = /^\s+-\s+(.+)$/.exec(line);
      if (item) {
        out.push(unquote(item[1]!));
        continue;
      }
      if (line.trim() && !line.trimStart().startsWith("-")) break;
    }
  }
  return out;
}

// ── Checks ───────────────────────────────────────────────────────────────────

console.log("Hermes catalog entry — openltm.yaml\n");

if (!existsSync(entryPath)) {
  console.log(`FAIL  entry file missing at ${entryPath}`);
  process.exit(1);
}

const entry = parseEntry(readFileSync(entryPath, "utf-8"));

// Required fields per the catalog docs.
for (const field of ["name", "repo", "sha", "maintainer", "tier", "category", "description"]) {
  const value = entry[field];
  if (typeof value === "string" && value.trim()) ok(`field ${field}`, String(value).slice(0, 60));
  else fail(`field ${field}`, "missing or empty");
}

if (entry["tier"] === "community") ok("tier", "community (maintainer-submitted)");
else fail("tier", `expected "community" for a third-party plugin, got "${entry["tier"]}"`);

if (entry["category"] === "memory") ok("category", "memory");
else fail("category", `expected "memory", got "${entry["category"]}"`);

// SHA format.
const sha = String(entry["sha"] ?? "");
if (/^[0-9a-f]{40}$/.test(sha)) ok("sha format", "40-hex");
else fail("sha format", `"${sha}" is not a 40-character lowercase hex commit`);

// SHA reachability + agreement with the local repo.
try {
  const subject = execSync(`git cat-file -t ${sha}`, { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
  if (subject === "commit") ok("sha reachable", sha.slice(0, 7));
  else fail("sha reachable", `object is a ${subject}, expected a commit`);
} catch {
  fail("sha reachable", "commit not found in this repository");
}

// Note: execSync returns null when stdio is "ignore", so "did not throw" is the
// signal for exit 0 here, not the return value.
try {
  execSync(`git merge-base --is-ancestor ${sha} HEAD`, { cwd: root, stdio: "ignore" });
  ok("sha is an ancestor of HEAD", sha.slice(0, 7));
} catch {
  fail("sha is an ancestor of HEAD", "pinned commit is not in this branch's history");
}

// subdir must exist and hold the plugin manifest.
const subdir = String(entry["subdir"] ?? "");
const subdirPath = join(root, subdir);
if (subdir && existsSync(subdirPath)) {
  ok("subdir exists", subdir);
  if (existsSync(join(subdirPath, "plugin.yaml"))) ok("plugin manifest present", "plugin.yaml");
  else fail("plugin manifest present", `${subdir}/plugin.yaml is missing`);
} else {
  fail("subdir exists", subdir ? `"${subdir}" not found` : "no subdir declared");
}

// version must match the repo version.
const repoVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")).version as string;
if (entry["version"] === repoVersion) ok("version matches package.json", repoVersion);
else fail("version matches package.json", `entry "${entry["version"]}" vs package.json "${repoVersion}"`);

// Cross-check declared capabilities against the real plugin source.
if (existsSync(pluginPath)) {
  const source = readFileSync(pluginPath, "utf-8");
  const sourceTools = new Set(Array.from(source.matchAll(/"name":\s*"(openltm_[a-z_]+)"/g), (m) => m[1]!));
  const sourceHooks = new Set(
    Array.from(source.matchAll(/^\s+def\s+([a-z_]+)\s*\(/gm), (m) => m[1]!),
  );

  const declaredTools = capabilityList(entry, "provides_tools");
  if (declaredTools.length === 0) fail("provides_tools", "no tools declared");
  for (const tool of declaredTools) {
    if (sourceTools.has(tool)) ok(`tool ${tool}`);
    else fail(`tool ${tool}`, "not found in the plugin source");
  }
  const undeclared = [...sourceTools].filter((t) => !declaredTools.includes(t));
  if (undeclared.length === 0) ok("no undeclared tools", `${declaredTools.length} declared`);
  else fail("no undeclared tools", `source defines ${undeclared.join(", ")} but the entry omits them`);

  const declaredHooks = capabilityList(entry, "provides_hooks");
  if (declaredHooks.length === 0) fail("provides_hooks", "no hooks declared");
  for (const hook of declaredHooks) {
    if (sourceHooks.has(hook)) ok(`hook ${hook}`);
    else fail(`hook ${hook}`, "not found in the plugin source");
  }

  const requiresEnv = capabilityList(entry, "requires_env");
  if (requiresEnv.length === 0) ok("requires_env", "none (runs with zero configuration)");
  else console.log(`  ..  requires_env declares ${requiresEnv.join(", ")} — confirm each is optional`);
} else {
  fail("plugin source", `cannot read ${pluginPath} to cross-check capabilities`);
}

console.log();
if (failed > 0) {
  console.log(`${failed}/${checked} check(s) failed. Fix before opening the catalog PR.`);
  process.exit(1);
}
console.log(`All ${checked} catalog checks passed — ready to submit.`);
