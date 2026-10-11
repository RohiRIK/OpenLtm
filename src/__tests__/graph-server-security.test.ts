/**
 * Security policy for the graph server (src/serverGuard.ts + its wiring in
 * src/graph-server.ts). Pure-function tests — no server is started and nothing
 * under ~/.claude is touched (reveal tests use a temp dir).
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  SECRET_MASK,
  checkRequest,
  dropMaskedSecretsDeep,
  isLoopbackBindHost,
  isSecretKey,
  maskSecret,
  maskSecretsDeep,
  maskSettings,
  nonLoopbackWarning,
  resolveRevealTarget,
  resolveServerHost,
  sanitizeSettingsUpdate,
} from "../serverGuard.js";
import { SETTING_DEFAULTS, SETTING_KEYS } from "../../packages/openltm-core/src/janitor/providers/types.js";

const API = "http://localhost:7331";

function req(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Request {
  return new Request(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: { host: "localhost:7331", ...init.headers },
    body: init.body,
  });
}

function status(r: Request): number | null {
  return checkRequest(r)?.status ?? null;
}

// ── Bind host ─────────────────────────────────────────────────────────────────

describe("bind host", () => {
  it("defaults to 127.0.0.1", () => {
    expect(resolveServerHost({})).toEqual({ hostname: "127.0.0.1", loopback: true });
    expect(resolveServerHost({ LTM_SERVER_HOST: "  " })).toEqual({ hostname: "127.0.0.1", loopback: true });
  });

  it("honours LTM_SERVER_HOST and flags non-loopback values", () => {
    expect(resolveServerHost({ LTM_SERVER_HOST: "0.0.0.0" })).toEqual({ hostname: "0.0.0.0", loopback: false });
    expect(resolveServerHost({ LTM_SERVER_HOST: "[::1]" })).toEqual({ hostname: "::1", loopback: true });
  });

  it("classifies loopback bind addresses", () => {
    for (const h of ["127.0.0.1", "127.0.0.2", "localhost", "::1", "[::1]"]) expect(isLoopbackBindHost(h)).toBe(true);
    for (const h of ["0.0.0.0", "::", "192.168.1.5", "10.0.0.1", "example.com"]) expect(isLoopbackBindHost(h)).toBe(false);
  });

  it("warning names the host and the env var", () => {
    const msg = nonLoopbackWarning("0.0.0.0", 7331);
    expect(msg).toContain("0.0.0.0");
    expect(msg).toContain("LTM_SERVER_HOST");
    expect(msg).toContain("WARNING");
  });
});

// ── Host allowlist (DNS rebinding) ────────────────────────────────────────────

describe("checkRequest — Host allowlist", () => {
  it.each(["localhost:7331", "127.0.0.1:7331", "[::1]:7331", "localhost", "LOCALHOST:7331", "127.0.0.1"])(
    "allows Host %s",
    (host) => {
      expect(status(req("/api/stats", { headers: { host } }))).toBeNull();
    },
  );

  it.each([
    "evil.com",
    "evil.com:7331",
    "localhost.evil.com:7331",
    "127.0.0.1.nip.io:7331",
    "192.168.1.5:7331",
    "0.0.0.0:7331",
    "localhost:7331@evil.com",
    "",
  ])("rejects Host %p with 403", (host) => {
    expect(status(req("/api/stats", { headers: { host } }))).toBe(403);
  });

  it("rejects a request with no Host header", () => {
    const r = new Request(`${API}/api/stats`);
    expect(r.headers.get("host")).toBeNull();
    expect(status(r)).toBe(403);
  });

  it("applies to WebSocket upgrades", () => {
    const upgrade = { upgrade: "websocket", connection: "Upgrade" };
    expect(status(req("/", { headers: { ...upgrade, host: "evil.com:7331" } }))).toBe(403);
    expect(status(req("/", { headers: { ...upgrade, host: "localhost:7331", origin: "http://evil.com" } }))).toBe(403);
    expect(status(req("/", { headers: { ...upgrade, host: "localhost:7331", origin: "http://localhost:7332" } }))).toBeNull();
  });

  it("checks X-Forwarded-Host set by the Next.js /api proxy", () => {
    expect(status(req("/api/settings", { headers: { "x-forwarded-host": "localhost:7332" } }))).toBeNull();
    expect(status(req("/api/settings", { headers: { "x-forwarded-host": "evil.com:7332" } }))).toBe(403);
    expect(status(req("/api/settings", { headers: { "x-forwarded-host": "192.168.1.5:7332" } }))).toBe(403);
    expect(status(req("/api/settings", { headers: { "x-forwarded-host": "localhost:7332, evil.com" } }))).toBe(403);
  });
});

// ── Origin allowlist (CSRF) ───────────────────────────────────────────────────

describe("checkRequest — Origin allowlist", () => {
  it("allows requests without Origin (curl, server-side proxy)", () => {
    expect(status(req("/api/health/projects"))).toBeNull();
    expect(status(req("/api/janitor/run", { method: "POST" }))).toBeNull();
  });

  it.each(["http://localhost:7332", "http://127.0.0.1:7332", "http://[::1]:7332", "http://localhost", "https://localhost:7332"])(
    "allows loopback Origin %s",
    (origin) => {
      expect(status(req("/api/memory/merge", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: "{}",
      }))).toBeNull();
    },
  );

  it.each([
    "https://evil.com",
    "http://evil.com:7332",
    "http://localhost.evil.com:7332",
    "http://127.0.0.1.evil.com",
    "null",
    "file://",
    "http://localhost:7332/path",
  ])("rejects Origin %s with 403", (origin) => {
    expect(status(req("/api/stats", { headers: { origin } }))).toBe(403);
    expect(status(req("/api/janitor/run", { method: "POST", headers: { origin } }))).toBe(403);
  });

  it("blocks the classic cross-site text/plain POST (no preflight) before it reaches a route", () => {
    for (const path of ["/api/reveal", "/api/janitor/run", "/api/memory/1/approve", "/api/memory/merge", "/api/memory/2/supersedes/1"]) {
      const r = req(path, {
        method: "POST",
        headers: { origin: "https://evil.example", "content-type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({ keepId: 1, supersededId: 2, path: "/etc" }),
      });
      expect(status(r)).toBe(403);
    }
  });
});

// ── Content-Type on mutations ─────────────────────────────────────────────────

describe("checkRequest — Content-Type on mutating requests", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s with text/plain body → 415", (method) => {
    const r = req("/api/settings", { method, headers: { "content-type": "text/plain" }, body: "{\"a\":\"b\"}" });
    expect(status(r)).toBe(415);
  });

  it.each(["application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "text/plain;charset=UTF-8", "application/jsonx"])(
    "rejects Content-Type %s with 415",
    (ct) => {
      expect(status(req("/api/memory/merge", { method: "POST", headers: { "content-type": ct }, body: "x" }))).toBe(415);
    },
  );

  it("rejects a body with no Content-Type", () => {
    expect(status(req("/api/memory/merge", { method: "POST", body: "{}" }))).toBe(415);
    expect(status(req("/api/memory/merge", { method: "POST", headers: { "content-length": "2" } }))).toBe(415);
    expect(status(req("/api/memory/merge", { method: "POST", headers: { "transfer-encoding": "chunked" } }))).toBe(415);
  });

  it("rejects a non-JSON Content-Type even without a body", () => {
    expect(status(req("/api/janitor/run", { method: "POST", headers: { "content-type": "text/plain" } }))).toBe(415);
  });

  it("accepts application/json (with parameters, any case)", () => {
    for (const ct of ["application/json", "application/json; charset=utf-8", "Application/JSON"]) {
      expect(status(req("/api/settings", { method: "PUT", headers: { "content-type": ct }, body: "{}" }))).toBeNull();
    }
  });

  it("accepts bodiless mutations without Content-Type (curl -X POST, DELETE)", () => {
    expect(status(req("/api/janitor/run", { method: "POST" }))).toBeNull();
    expect(status(req("/api/janitor/run", { method: "POST", headers: { "content-length": "0" } }))).toBeNull();
    expect(status(req("/api/memory/5", { method: "DELETE" }))).toBeNull();
  });

  it("does not enforce Content-Type on GET/HEAD", () => {
    expect(status(req("/api/stats", { headers: { "content-type": "text/plain" } }))).toBeNull();
    expect(status(req("/api/stats", { method: "HEAD" }))).toBeNull();
  });
});

// ── Secret masking ────────────────────────────────────────────────────────────

describe("secret masking", () => {
  const REAL = {
    [SETTING_KEYS.GEMINI_API_KEY]: "AIzaSyD-real-gemini-key-000000001234",
    [SETTING_KEYS.OPENAI_API_KEY]: "sk-proj-real-openai-key-abcdefghij5678",
    [SETTING_KEYS.ANTHROPIC_API_KEY]: "sk-ant-api03-real-anthropic-key-zzzz9999",
    [SETTING_KEYS.OPENROUTER_API_KEY]: "sk-or-v1-real-openrouter-key-aaaa4321",
    [SETTING_KEYS.COHERE_API_KEY]: "short",
  };

  it("treats every provider apiKey setting as secret, and model/url settings as not", () => {
    const apiKeyNames = Object.values(SETTING_KEYS).filter((k) => k.endsWith(".apiKey"));
    expect(apiKeyNames.length).toBeGreaterThanOrEqual(5);
    for (const k of apiKeyNames) expect(isSecretKey(k)).toBe(true);
    for (const k of ["github_token", "clientSecret", "db.password", "api_key", "x-api-key"]) expect(isSecretKey(k)).toBe(true);
    for (const k of [SETTING_KEYS.GEMINI_EMBED_MODEL, SETTING_KEYS.OLLAMA_BASE_URL, SETTING_KEYS.EMBED_PROVIDER, SETTING_KEYS.DECAY_RATE]) {
      expect(isSecretKey(k)).toBe(false);
    }
  });

  it("masks to bullets + last 4, empty stays empty, short secrets get no suffix", () => {
    expect(maskSecret("")).toBe("");
    expect(maskSecret("sk-proj-real-openai-key-abcdefghij5678")).toBe(`${SECRET_MASK}5678`);
    expect(maskSecret("short")).toBe(SECRET_MASK);
    expect(maskSecret("123456789012345")).toBe(SECRET_MASK);
  });

  it("GET /api/settings payload never contains a full key", () => {
    const served = maskSettings({ ...SETTING_DEFAULTS, ...REAL });
    const json = JSON.stringify(served);
    for (const secret of Object.values(REAL)) expect(json).not.toContain(secret);
    expect(served[SETTING_KEYS.GEMINI_API_KEY]).toBe(`${SECRET_MASK}1234`);
    expect(served[SETTING_KEYS.COHERE_API_KEY]).toBe(SECRET_MASK);
    // Unset keys stay "" so the UI still knows they are unset.
    expect(maskSettings({ ...SETTING_DEFAULTS })[SETTING_KEYS.OPENAI_API_KEY]).toBe("");
    // Non-secret settings pass through untouched.
    expect(served[SETTING_KEYS.GEMINI_EMBED_MODEL]).toBe(SETTING_DEFAULTS[SETTING_KEYS.GEMINI_EMBED_MODEL]!);
    expect(served[SETTING_KEYS.OLLAMA_BASE_URL]).toBe(SETTING_DEFAULTS[SETTING_KEYS.OLLAMA_BASE_URL]!);
  });

  it("round-trip: saving the masked form unchanged does not overwrite stored keys", () => {
    const store: Record<string, string> = { ...SETTING_DEFAULTS, ...REAL };
    const served = maskSettings(store);
    // The UI PUTs its whole draft back, with one ordinary change.
    const draft = { ...served, [SETTING_KEYS.DECAY_RATE]: "0.05" };
    Object.assign(store, sanitizeSettingsUpdate(draft));
    for (const [k, v] of Object.entries(REAL)) expect(store[k]).toBe(v);
    expect(store[SETTING_KEYS.DECAY_RATE]).toBe("0.05");
  });

  it("round-trip: a newly typed key is saved, an edited mask is ignored, a cleared key is cleared", () => {
    const store: Record<string, string> = { ...SETTING_DEFAULTS, ...REAL };
    const served = maskSettings(store);
    Object.assign(store, sanitizeSettingsUpdate({
      ...served,
      [SETTING_KEYS.OPENAI_API_KEY]: "sk-new-openai-key-typed-by-user-0000",
      [SETTING_KEYS.GEMINI_API_KEY]: `${served[SETTING_KEYS.GEMINI_API_KEY]}X`,
      [SETTING_KEYS.ANTHROPIC_API_KEY]: "",
    }));
    expect(store[SETTING_KEYS.OPENAI_API_KEY]).toBe("sk-new-openai-key-typed-by-user-0000");
    expect(store[SETTING_KEYS.GEMINI_API_KEY]).toBe(REAL[SETTING_KEYS.GEMINI_API_KEY]!);
    expect(store[SETTING_KEYS.ANTHROPIC_API_KEY]).toBe("");
  });

  it("sanitizeSettingsUpdate drops non-string values and non-object bodies", () => {
    expect(sanitizeSettingsUpdate({ a: "1", b: 2, c: null, d: { x: 1 } })).toEqual({ a: "1" });
    expect(sanitizeSettingsUpdate(null)).toEqual({});
    expect(sanitizeSettingsUpdate(["x"])).toEqual({});
    expect(sanitizeSettingsUpdate("x")).toEqual({});
  });

  it("masks nested secrets in config.json and drops masked values from config patches", () => {
    const config = {
      ltm: { dbPath: "/tmp/x.db", autoRecall: true },
      embeddings: { provider: "openai", apiKey: "sk-config-embedding-key-11112222" },
      list: [{ token: "ghp_abcdefghijklmnopqrstuvwxyz" }],
    };
    const masked = maskSecretsDeep(config) as typeof config;
    expect(JSON.stringify(masked)).not.toContain("sk-config-embedding-key-11112222");
    expect(JSON.stringify(masked)).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
    expect(masked.embeddings.apiKey).toBe(`${SECRET_MASK}2222`);
    expect(masked.ltm).toEqual(config.ltm);

    const patch = dropMaskedSecretsDeep(masked as unknown as Record<string, unknown>) as Record<string, Record<string, unknown>>;
    expect(patch.embeddings).toEqual({ provider: "openai" });
    expect(patch.ltm).toEqual(config.ltm);
    expect(dropMaskedSecretsDeep({ embeddings: { apiKey: "sk-new" } })).toEqual({ embeddings: { apiKey: "sk-new" } });
  });
});

// ── /api/reveal path restriction ──────────────────────────────────────────────

describe("resolveRevealTarget", () => {
  let base: string;
  let dbDir: string;
  let dbPath: string;
  let outside: string;

  beforeAll(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "ltm-reveal-")));
    dbDir = join(base, "data");
    outside = join(base, "outside");
    mkdirSync(join(dbDir, "backups"), { recursive: true });
    mkdirSync(outside, { recursive: true });
    dbPath = join(dbDir, "openltm.db");
    writeFileSync(dbPath, "");
    writeFileSync(join(dbDir, "backups", "old.db"), "");
    writeFileSync(join(outside, "secret.txt"), "");
    symlinkSync(outside, join(dbDir, "escape"));
    symlinkSync(join(outside, "secret.txt"), join(dbDir, "escape-file"));
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("defaults to the database file", () => {
    expect(resolveRevealTarget(undefined, dbPath)).toEqual({ ok: true, path: dbPath });
    expect(resolveRevealTarget("", dbPath)).toEqual({ ok: true, path: dbPath });
    expect(resolveRevealTarget(42, dbPath)).toEqual({ ok: true, path: dbPath });
  });

  it("allows the database file, its directory, and files under it", () => {
    expect(resolveRevealTarget(dbPath, dbPath)).toEqual({ ok: true, path: dbPath });
    expect(resolveRevealTarget(dbDir, dbPath)).toEqual({ ok: true, path: dbDir });
    expect(resolveRevealTarget(join(dbDir, "backups", "old.db"), dbPath)).toEqual({ ok: true, path: join(dbDir, "backups", "old.db") });
    expect(resolveRevealTarget("backups/old.db", dbPath)).toEqual({ ok: true, path: join(dbDir, "backups", "old.db") });
  });

  it.each([
    ["an absolute path elsewhere", () => join(outside, "secret.txt")],
    ["the parent directory", () => base],
    ["a ../ escape", () => join(dbDir, "..", "outside", "secret.txt")],
    ["a relative ../ escape", () => "../outside/secret.txt"],
    ["a symlinked directory that points outside", () => join(dbDir, "escape", "secret.txt")],
    ["a symlinked file that points outside", () => join(dbDir, "escape-file")],
    ["a system path", () => "/etc/passwd"],
  ])("rejects %s with 403", (_label, path) => {
    const r = resolveRevealTarget(path(), dbPath);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it("does not reveal whether files outside the directory exist", () => {
    const r = resolveRevealTarget(join(outside, "does-not-exist"), dbPath);
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("returns 404 for a missing file inside the directory", () => {
    expect(resolveRevealTarget(join(dbDir, "missing.db"), dbPath)).toMatchObject({ ok: false, status: 404 });
  });

  it("follows a symlinked database directory", () => {
    const link = join(base, "data-link");
    symlinkSync(dbDir, link);
    expect(resolveRevealTarget(undefined, join(link, "openltm.db"))).toEqual({ ok: true, path: dbPath });
    expect(resolveRevealTarget(join(outside, "secret.txt"), join(link, "openltm.db"))).toMatchObject({ ok: false, status: 403 });
  });
});

// ── Wiring in graph-server.ts ─────────────────────────────────────────────────

describe("graph-server.ts wiring", () => {
  const src = readFileSync(join(import.meta.dir, "..", "graph-server.ts"), "utf-8");

  it("binds to the resolved (loopback-by-default) host", () => {
    expect(src).toContain("resolveServerHost()");
    expect(src).toMatch(/Bun\.serve\(\{\s*port: PORT,\s*hostname: HOST,/);
  });

  it("runs checkRequest before WebSocket upgrades and routing", () => {
    const guard = src.indexOf("checkRequest(req)");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(src.indexOf("server.upgrade(req)"));
    expect(guard).toBeLessThan(src.indexOf('p === "/api/reveal"'));
  });

  it("masks settings/config responses and restricts reveal", () => {
    expect(src).toContain("maskSettings(merged)");
    expect(src).toContain("sanitizeSettingsUpdate(await req.json())");
    expect(src).toContain("maskSecretsDeep(readClaudeConfig())");
    expect(src).toContain("resolveRevealTarget(body?.path, DB_PATH)");
  });
});
