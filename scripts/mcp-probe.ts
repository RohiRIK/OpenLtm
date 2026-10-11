#!/usr/bin/env bun
/**
 * mcp-probe.ts — start the plugin's MCP server the way Claude Code does and
 * say why it would not connect: which `bun` the host would run, which database
 * and config the server resolves (and its mcp.enabled), how long the MCP
 * handshake takes against Claude Code's 30s budget, the tool count, the
 * server's stderr, and the tail of Claude Code's own log for this server.
 *
 * It changes nothing itself; the server it starts opens (and, if needed,
 * migrates) its database exactly as it would in a session. No config values
 * other than mcp.enabled are printed — config files can hold API keys.
 *
 * Usage (from the project you open in Claude Code):
 *   bun <plugin root>/scripts/mcp-probe.ts [--plugin-data <dir>] [--timeout <seconds>]
 * --plugin-data defaults to the one dir under $CLAUDE_CONFIG_DIR/plugins/data
 * (default ~/.claude/plugins/data) that holds an openltm.db.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const configDir = process.env["CLAUDE_CONFIG_DIR"] || join(homedir(), ".claude");
const dataRoot = join(configDir, "plugins", "data");
const candidates = existsSync(dataRoot)
  ? readdirSync(dataRoot).map((d) => join(dataRoot, d)).filter((d) => existsSync(join(d, "openltm.db")))
  : [];
const pluginData = opt("plugin-data") ?? (candidates.length === 1 ? candidates[0] : undefined);
if (!pluginData) {
  console.log(`Pass --plugin-data <dir>. Dirs under ${dataRoot} with an openltm.db: ${candidates.join(", ") || "(none)"}`);
  process.exit(2);
}
const timeoutMs = Number(opt("timeout") ?? 30) * 1000;
const cwd = process.cwd();

type Manifest = { mcpServers: { memory: { command: string; args: string[]; env?: Record<string, string> } } };
const server = (JSON.parse(readFileSync(join(ROOT, ".claude-plugin", "plugin.json"), "utf-8")) as Manifest).mcpServers.memory;
const expand = (s: string) => s.replaceAll("${CLAUDE_PLUGIN_ROOT}", ROOT).replaceAll("${CLAUDE_PLUGIN_DATA}", pluginData);
const env: Record<string, string> = { ...(process.env as Record<string, string>), CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_PLUGIN_DATA: pluginData };
for (const [k, v] of Object.entries(server.env ?? {})) env[k] = expand(v);

let problems = 0;
const line = (ok: boolean | null, label: string, detail = "") => {
  if (ok === false) problems++;
  console.log(`${ok === null ? "INFO" : ok ? "OK  " : "FAIL"}  ${label}${detail ? `: ${detail}` : ""}`);
};

// 1. The command the host runs — `bun` from the PATH Claude Code was started with.
const bun = Bun.which(server.command, { PATH: env["PATH"] ?? "" });
const bunVersion = bun ? Bun.spawnSync([bun, "--version"]).stdout.toString().trim() : "";
line(!!bun, `\`${server.command}\` on PATH`, bun ? `${bun} (${bunVersion})` : "not found — Claude Code cannot start the server");
line(null, "plugin root", ROOT);
line(null, "CLAUDE_PLUGIN_DATA", pluginData);
for (const k of ["LTM_DB_PATH", "LTM_DATA_DIR", "LTM_CONFIG_PATH", "LTM_EMBED_PROVIDER"]) if (process.env[k]) line(null, `${k} (inherited)`, process.env[k]!);

// 2. What the server resolves, with the server's environment.
if (bun) {
  const r = Bun.spawnSync([bun, "-e", `
    const { normalizePluginEnv } = await import(${JSON.stringify(join(ROOT, "src", "pluginEnv.ts"))});
    normalizePluginEnv();
    const c = await import("@rohirik/openltm-core");
    const { readConfigSync } = await import(${JSON.stringify(join(ROOT, "src", "config.ts"))});
    const config = c.getConfigPath();
    console.log(JSON.stringify({ db: c.DB_PATH, config, configExists: (await import("fs")).existsSync(config), mcpEnabled: readConfigSync().mcp?.enabled ?? null }));
  `], { cwd: ROOT, env });
  try {
    const res = JSON.parse(r.stdout.toString().trim().split("\n").pop()!) as { db: string; config: string; configExists: boolean; mcpEnabled: boolean | null };
    line(null, "database", `${res.db}${existsSync(res.db) ? ` (${statSync(res.db).size} bytes)` : " (does not exist yet)"}`);
    line(null, "config", `${res.config}${res.configExists ? "" : " (none — defaults)"}`);
    line(res.mcpEnabled !== false, "mcp.enabled", res.mcpEnabled === false ? "false — the server exits at once and Claude Code shows it as failed" : String(res.mcpEnabled ?? "unset (enabled)"));
  } catch {
    line(false, "resolving database and config", (r.stderr.toString() || r.stdout.toString()).trim().slice(0, 800));
  }
}

// 3. Start it as the host does and complete the MCP handshake.
if (bun) {
  const transport = new StdioClientTransport({ command: bun, args: server.args.map(expand), cwd, env, stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
  const client = new Client({ name: "openltm-mcp-probe", version: "0" });
  const t0 = performance.now();
  try {
    await Promise.race([
      client.connect(transport),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`no handshake within ${timeoutMs / 1000}s`)), timeoutMs)),
    ]);
    const ms = Math.round(performance.now() - t0);
    line(ms < 30_000, "MCP handshake", `${ms}ms (Claude Code allows 30000ms)`);
    const { tools } = await client.listTools();
    line(tools.length === 12, "tools/list", `${tools.length} tools`);
  } catch (e) {
    line(false, "MCP handshake", e instanceof Error ? e.message : String(e));
  } finally {
    await client.close().catch(() => {});
  }
  line(null, "server stderr", stderr.trim() ? `\n${stderr.trim().split("\n").map((l) => `      ${l}`).join("\n")}` : "(empty)");
}

// 4. Claude Code's own log for this server, newest first.
const cacheRoot = join(homedir(), ".cache", "claude-cli-nodejs");
const logs = existsSync(cacheRoot)
  ? readdirSync(cacheRoot).flatMap((slug) => {
      const dir = join(cacheRoot, slug, "mcp-logs-plugin-openltm-memory");
      return existsSync(dir) ? readdirSync(dir).map((f) => join(dir, f)) : [];
    }).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  : [];
if (logs[0]) {
  const tail = readFileSync(logs[0], "utf-8").trim().split("\n").slice(-12);
  line(null, `Claude Code's latest log for this server (${logs[0]})`, `\n${tail.map((l) => `      ${l.slice(0, 400)}`).join("\n")}`);
} else {
  line(null, "Claude Code's log for this server", `none under ${cacheRoot}/*/mcp-logs-plugin-openltm-memory (macOS: ~/Library/Caches/claude-cli-nodejs)`);
}

console.log(problems === 0 ? "\nThe server starts and answers as Claude Code expects." : `\n${problems} problem(s) found — see FAIL lines.`);
process.exit(problems === 0 ? 0 : 1);
