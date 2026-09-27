#!/usr/bin/env bun
/**
 * check-openclaw-manifest.ts — validate the OpenClaw plugin package locally.
 *
 * OpenClaw's manifest loader (`src/plugins/manifest.ts` in openclaw/openclaw)
 * rejects a manifest when `configSchema` is missing, when `categories` is not
 * 1–3 entries from the published taxonomy, or when a value has the wrong type.
 * This script encodes those same rules, plus the invariants specific to this
 * package (every contract tool is actually registered, peer/compat versions
 * agree), so a packaging mistake fails here instead of at `openclaw plugins
 * install`.
 *
 * Usage: bun run check:openclaw
 */
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");
const pkgDir = join(root, "packages", "adapter-openclaw");
const manifestPath = join(pkgDir, "openclaw.plugin.json");
const pkgPath = join(pkgDir, "package.json");
const entryPath = join(pkgDir, "src", "index.ts");

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

// Mirrors packages/plugin-package-contract/src/categories.ts at openclaw 2026.9.6.
const PLUGIN_CATEGORY_SLUGS = [
  "channels", "models", "agent-runtimes", "memory", "context", "voice", "web",
  "computer-use", "media", "security", "integrations", "developer-tools",
  "infrastructure", "documents-files", "inbox-collaboration", "productivity",
  "scheduling", "finance-payments", "sales-marketing", "data-analytics",
  "agent-orchestration", "research", "other",
] as const;

const LEGACY_CATEGORY_SLUGS = ["tools", "runtime", "gateway"] as const;
const ACCEPTED_CATEGORIES: readonly string[] = [...PLUGIN_CATEGORY_SLUGS, ...LEGACY_CATEGORY_SLUGS];

// Mirrors src/plugins/plugin-kind.types.ts.
const PLUGIN_KINDS = ["memory", "context-engine"] as const;

const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const entrySource = readFileSync(entryPath, "utf-8");

console.log("OpenClaw plugin package — adapter-openclaw\n");

// ── Identity ─────────────────────────────────────────────────────────────────

if (typeof manifest.id === "string" && /^[a-z0-9][a-z0-9-]*$/.test(manifest.id)) {
  ok("manifest id", manifest.id);
} else {
  fail("manifest id", `"${manifest.id}" is not a valid kebab-case id`);
}

// Every plugin registers into one global tool namespace, so the tool set must
// share a single consistent prefix. Checked below, alongside the contracts.

if (typeof manifest.name === "string" && manifest.name.trim()) ok("manifest name", manifest.name);
else fail("manifest name", "missing or empty");

if (typeof manifest.description === "string" && manifest.description.trim()) ok("manifest description");
else fail("manifest description", "missing or empty");

// ── categories ───────────────────────────────────────────────────────────────

const categories = manifest.categories;
if (!Array.isArray(categories)) {
  fail("categories", "must be an array");
} else if (categories.length < 1 || categories.length > 3) {
  fail("categories", `must contain between 1 and 3 entries, got ${categories.length}`);
} else if (new Set(categories).size !== categories.length) {
  fail("categories", "must not contain duplicates");
} else {
  const unknown = categories.filter((c: string) => !ACCEPTED_CATEGORIES.includes(c));
  if (unknown.length > 0) {
    fail("categories", `unknown slug(s): ${unknown.join(", ")} — see PLUGIN_CATEGORY_SLUGS`);
  } else {
    ok("categories", categories.join(", "));
  }
}

// ── kind ─────────────────────────────────────────────────────────────────────

if (manifest.kind === undefined) {
  ok("kind", "absent (tool plugin — does not claim the exclusive memory slot)");
} else if (PLUGIN_KINDS.includes(manifest.kind)) {
  ok("kind", manifest.kind);
} else {
  fail("kind", `must be one of ${PLUGIN_KINDS.join(", ")}`);
}

// ── configSchema (required by the loader) ────────────────────────────────────

const schema = manifest.configSchema;
if (!schema || typeof schema !== "object") {
  fail("configSchema", "required — the loader rejects a manifest without it");
} else if (schema.type !== "object") {
  fail("configSchema.type", `must be "object", got ${JSON.stringify(schema.type)}`);
} else {
  ok("configSchema", `object with ${Object.keys(schema.properties ?? {}).length} properties`);
  if (schema.additionalProperties !== false) {
    fail("configSchema.additionalProperties", "must be false so unknown keys are rejected");
  }
  // Every uiHint key must exist in the schema, and vice versa.
  const props = new Set(Object.keys(schema.properties ?? {}));
  const hints = Object.keys(manifest.uiHints ?? {});
  const orphanHints = hints.filter((h) => !props.has(h));
  if (orphanHints.length > 0) {
    fail("uiHints match configSchema", `uiHints reference undeclared keys: ${orphanHints.join(", ")}`);
  } else {
    ok("uiHints match configSchema", `${hints.length} hint(s)`);
  }
  for (const group of manifest.configGroups ?? []) {
    const missing = (group.properties ?? []).filter((p: string) => !props.has(p));
    if (missing.length > 0) {
      fail(`configGroup ${group.id}`, `references undeclared keys: ${missing.join(", ")}`);
    }
  }
  ok("configGroups", `${(manifest.configGroups ?? []).length} group(s)`);
}

// ── contracts vs the entry source ────────────────────────────────────────────

const contractTools: string[] = manifest.contracts?.tools ?? [];
if (contractTools.length === 0) {
  fail("contracts.tools", "must declare at least one tool");
} else if (new Set(contractTools).size !== contractTools.length) {
  fail("contracts.tools", "must not contain duplicates");
} else {
  // Every declared tool must be registered in index.ts under the same name.
  const unregistered = contractTools.filter((t) => !entrySource.includes(`"${t}"`));
  if (unregistered.length > 0) {
    fail("contracts.tools registered", `declared but never registered: ${unregistered.join(", ")}`);
  } else {
    ok("contracts.tools registered", `${contractTools.length} tool(s)`);
  }

  // And nothing may be registered without being declared (capability creep).
  const registered = [...entrySource.matchAll(/tool\(\s*\n?\s*"([a-z_]+)"/g)].map((m) => m[1]!);
  const undeclared = registered.filter((t) => !contractTools.includes(t));
  if (undeclared.length > 0) {
    fail("no undeclared tools", `index.ts registers ${undeclared.join(", ")} but contracts does not declare them`);
  } else if (registered.length > 0) {
    ok("no undeclared tools", `${registered.length} registered`);
  }

  // OpenClaw's own convention is a shared family prefix rather than the plugin
  // id (`memory-lancedb` registers `memory_recall`), so the id is deliberately
  // not required as the prefix — but the set must be internally consistent.
  const prefix = contractTools[0]!.split("_")[0]!;
  if (contractTools.every((t) => t.startsWith(`${prefix}_`))) {
    ok("tools share one namespace prefix", `${prefix}_* (${contractTools.length})`);
  } else {
    fail("tools share one namespace prefix", `inconsistent prefixes in ${contractTools.join(", ")}`);
  }
}

// side-effecting tools must be flagged, so the host can prompt correctly.
for (const name of contractTools) {
  if (/\b(forget|learn|relate|stale)\b/.test(name) && manifest.toolMetadata?.[name]?.sideEffecting !== true) {
    fail(`toolMetadata.${name}.sideEffecting`, "write tool is not marked sideEffecting");
  }
}
ok("side-effecting tools flagged", contractTools.filter((t) => manifest.toolMetadata?.[t]?.sideEffecting).join(", ") || "none");

// ── package.json ↔ manifest consistency ──────────────────────────────────────

const openclawBlock = pkg.openclaw;
if (!openclawBlock) {
  fail("package.json openclaw block", "required so OpenClaw can load the plugin");
} else {
  const extensions = openclawBlock.extensions ?? [];
  if (Array.isArray(extensions) && extensions.length === 1 && extensions[0].startsWith("./")) {
    ok("openclaw.extensions", extensions[0]);
  } else {
    fail("openclaw.extensions", `expected a single built entry, got ${JSON.stringify(extensions)}`);
  }

  const compat = openclawBlock.compat?.pluginApi;
  const minHost = openclawBlock.install?.minHostVersion;
  const peer = pkg.peerDependencies?.openclaw;
  if (typeof compat === "string" && compat.startsWith(">=")) ok("compat.pluginApi", compat);
  else fail("compat.pluginApi", "must be a >= range");

  if (typeof minHost === "string" && minHost.startsWith(">=")) ok("install.minHostVersion", minHost);
  else fail("install.minHostVersion", "must be a >= range");

  if (typeof peer === "string" && peer.startsWith(">=")) ok("peerDependencies.openclaw", peer);
  else fail("peerDependencies.openclaw", "must be a >= range so the host provides the SDK");

  if (pkg.peerDependenciesMeta?.openclaw?.optional === true) {
    ok("openclaw peer is optional", "not installed as a dependency");
  } else {
    fail("openclaw peer is optional", "must be marked optional — the host supplies it");
  }
}

// ── report ───────────────────────────────────────────────────────────────────

console.log();
if (failed > 0) {
  console.log(`${failed}/${checked} check(s) failed.`);
  process.exit(1);
}
console.log(`All ${checked} OpenClaw package checks passed.`);
