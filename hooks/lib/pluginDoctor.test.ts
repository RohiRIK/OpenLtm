import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Each subprocess sees a unique fake installation and HOME; no live DB/hooks.
// The scratch owner handles retention, so these tests never recursively clean up.
const script = fileURLToPath(new URL("./pluginDoctor.ts", import.meta.url));
function diagnose(agents: unknown, files: string[] = [], omitAgents = false) {
  const root = mkdtempSync(join(tmpdir(), "openltm-doctor-regression-"));
  const home = join(root, "home");
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: "1.0.0" }));
  writeFileSync(join(root, ".claude-plugin/plugin.json"), JSON.stringify({
    version: "1.0.0", ...(omitAgents ? {} : { agents }),
  }));
  for (const file of files) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "# Fixture agent\n");
  }
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, HOME: home, CLAUDE_PLUGIN_ROOT: root,
      CLAUDE_PLUGIN_DATA: join(root, "data"), LTM_DB_PATH: join(root, "missing.db") },
    encoding: "utf8", timeout: 15000,
  });
  expect(result.error).toBeUndefined();
  // Doctor is advisory (exit 0 even for reported failures). Assert completion
  // and the manifest diagnostic itself, not a newly invented exit contract.
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("## Database");
  expect(result.stdout).toContain("passed");
  expect(result.stderr).not.toContain("TypeError");
  return result.stdout.split("## Bun Runtime")[0];
}

describe("Doctor agents manifest handling", () => {
  test("valid relative array preserves supported manifests", () => {
    expect(diagnose(["./agents/a.md", "./agents/b.md"], ["agents/a.md", "agents/b.md"]))
      .toContain('plugin.json "agents" entries all exist');
  });
  test("legacy directory string is supported", () => {
    expect(diagnose("./agents", ["agents/a.md"]))
      .toContain('plugin.json "agents" entries all exist');
  });
  test("missing path is a diagnostic failure, not a crash", () => {
    expect(diagnose(["./agents/missing.md"]))
      .toContain('plugin.json "agents" points to missing paths: ./agents/missing.md');
  });
  test("absolute paths stay supported", () => {
    expect(diagnose([script])).toContain('plugin.json "agents" entries all exist');
  });
  test("omitted optional agents is allowed", () => {
    expect(diagnose(undefined, [], true)).not.toContain('plugin.json "agents"');
  });
  test("empty array is allowed", () => {
    expect(diagnose([])).toContain('plugin.json "agents" entries all exist');
  });
  for (const [label, value, files] of [
    ["null", null, ["null"]],
    ["number", 123, ["123"]],
    ["boolean", true, ["true"]],
    ["object", {}, ["[object Object]"]],
    ["empty string", "", []],
    ["blank string", "  ", ["  "]],
    ["mixed array", ["./agents/a.md", 123], ["agents/a.md", "123"]],
    ["nested array", [["./agents/a.md"]], ["agents/a.md"]],
  ] as Array<[string, unknown, string[]]>) {
    test(`malformed ${label} is rejected even when its coerced path exists`, () => {
      const out = diagnose(value, files);
      expect(out).toContain('plugin.json "agents" must be a non-empty path string or an array of non-empty path strings');
      expect(out).not.toContain('plugin.json "agents" entries all exist');
    });
  }
});

describe("Doctor embeddings check", () => {
  async function doctorWith(env: Record<string, string>): Promise<string> {
    const root = mkdtempSync(join(tmpdir(), "openltm-doctor-embed-"));
    const home = join(root, "home");
    mkdirSync(join(root, ".claude-plugin"), { recursive: true });
    mkdirSync(home, { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "1.0.0" }));
    writeFileSync(join(root, ".claude-plugin/plugin.json"), JSON.stringify({ version: "1.0.0" }));
    // Async spawn: a fake server in this process must keep answering while the doctor runs.
    const proc = Bun.spawn([process.execPath, script], {
      cwd: root,
      env: { ...process.env, HOME: home, CLAUDE_PLUGIN_ROOT: root, CLAUDE_PLUGIN_DATA: join(root, "data"),
        LTM_DB_PATH: join(root, "missing.db"), LTM_EMBED_PROVIDER: "", ...env },
      stdout: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    return out.split("## Embeddings (semantic recall)")[1]!.split("\n## ")[0]!;
  }

  test("an unreachable llama.cpp server is a warning with the command to start one", async () => {
    const out = await doctorWith({ LTM_LLAMA_CPP_URL: "http://127.0.0.1:9" });
    expect(out).toContain("llamacpp embedding server not reachable at http://127.0.0.1:9: recall uses full-text search only");
    expect(out).toContain("llama-server -m bge-m3.gguf --embeddings");
  });

  test("disabled embeddings are a warning, not a failure", async () => {
    const out = await doctorWith({ LTM_EMBED_PROVIDER: "disabled" });
    expect(out).toContain("Embeddings are disabled");
    expect(out).not.toContain("❌");
  });

  test("a working server reports the vector size", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/health") return Response.json({ status: "ok" });
        if (path === "/v1/embeddings") return Response.json({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
        return new Response("not found", { status: 404 });
      },
    });
    try {
      const out = await doctorWith({ LTM_LLAMA_CPP_URL: `http://127.0.0.1:${server.port}` });
      expect(out).toContain(`llamacpp at http://127.0.0.1:${server.port} returns 3-d vectors (model bge-m3)`);
    } finally {
      server.stop(true);
    }
  });

  test("a server without an embedding model fails with the fix", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        return new URL(req.url).pathname === "/health" ? Response.json({ status: "ok" }) : new Response("no embeddings", { status: 501 });
      },
    });
    try {
      const out = await doctorWith({ LTM_LLAMA_CPP_URL: `http://127.0.0.1:${server.port}` });
      expect(out).toContain('is up but returned no embedding for model "bge-m3"');
      expect(out).toContain("--embeddings");
    } finally {
      server.stop(true);
    }
  });
});
