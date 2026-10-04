/**
 * serverGuard.ts — Security policy for the graph server (src/graph-server.ts).
 *
 * The graph server exposes every memory plus destructive routes (delete, merge,
 * settings, config, janitor). It is meant for the local user only, so:
 *   - it binds to loopback unless LTM_SERVER_HOST says otherwise;
 *   - Host / X-Forwarded-Host must be a loopback name (DNS-rebinding defense);
 *   - a browser Origin, when sent, must be a loopback origin (CSRF defense);
 *   - mutating requests with a body must be application/json, which a
 *     cross-site page cannot send without a CORS preflight we never approve;
 *   - provider API keys are masked in responses and the mask is never written back;
 *   - /api/reveal only opens paths inside the database directory.
 *
 * Kept free of server state so it can be unit-tested without starting Bun.serve.
 */
import { realpathSync } from "fs";
import { dirname, isAbsolute, relative, resolve, sep } from "path";

// ── Bind address ──────────────────────────────────────────────────────────────

export const DEFAULT_SERVER_HOST = "127.0.0.1";

/** True for bind addresses that only accept connections from this machine. */
export function isLoopbackBindHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return h === "localhost" || h === "::1" || /^127(?:\.\d{1,3}){3}$/.test(h);
}

/** Bind address from LTM_SERVER_HOST, defaulting to loopback. */
export function resolveServerHost(
  env: Record<string, string | undefined> = process.env,
): { hostname: string; loopback: boolean } {
  const raw = env.LTM_SERVER_HOST?.trim();
  const hostname = raw ? raw.replace(/^\[(.*)\]$/, "$1") : DEFAULT_SERVER_HOST;
  return { hostname, loopback: isLoopbackBindHost(hostname) };
}

export function nonLoopbackWarning(hostname: string, port: number): string {
  const bar = "!".repeat(78);
  return [
    bar,
    `WARNING: LTM graph server is binding to non-loopback host "${hostname}" (port ${port}).`,
    "Anyone who can reach this address can read every memory, delete or merge",
    "memories, run the janitor, and change settings. There is no authentication.",
    "Unset LTM_SERVER_HOST to bind to 127.0.0.1 (the default).",
    bar,
  ].join("\n");
}

// ── Request guard ─────────────────────────────────────────────────────────────

const LOOPBACK_HOST_RE = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;
const LOOPBACK_ORIGIN_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;
const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

/** Host header check: localhost, 127.0.0.1 or [::1], any port. */
export function isAllowedHost(host: string | null): boolean {
  return host !== null && LOOPBACK_HOST_RE.test(host.trim());
}

/** Origin header check: http(s)://localhost|127.0.0.1|[::1] with any port. `null` origins are rejected. */
export function isAllowedOrigin(origin: string): boolean {
  return LOOPBACK_ORIGIN_RE.test(origin.trim());
}

function isJsonContentType(contentType: string): boolean {
  return contentType.split(";")[0]!.trim().toLowerCase() === "application/json";
}

function hasBody(req: Request): boolean {
  if (req.body !== null) return true;
  if (req.headers.has("transfer-encoding")) return true;
  const len = req.headers.get("content-length");
  return len !== null && len.trim() !== "0";
}

function deny(status: 403 | 415, error: string): Response {
  return Response.json({ ok: false, error }, { status });
}

/**
 * Returns a 403/415 response when the request must be refused, or null to let it through.
 * Applied to every request, WebSocket upgrades included.
 *
 * Requests without an Origin header (curl, the Next.js server-side /api proxy) are allowed;
 * browsers always send Origin on cross-origin and non-GET requests.
 */
export function checkRequest(req: Request): Response | null {
  const headers = req.headers;

  if (!isAllowedHost(headers.get("host"))) {
    return deny(403, "Forbidden: Host must be localhost, 127.0.0.1 or [::1]");
  }

  // The Next.js /api rewrite sets X-Forwarded-Host to the browser-facing Host,
  // so a rebinding attack through the UI server is caught here too.
  const forwardedHost = headers.get("x-forwarded-host");
  if (forwardedHost !== null && !forwardedHost.split(",").every((h) => isAllowedHost(h))) {
    return deny(403, "Forbidden: X-Forwarded-Host must be localhost, 127.0.0.1 or [::1]");
  }

  const origin = headers.get("origin");
  if (origin !== null && !isAllowedOrigin(origin)) {
    return deny(403, "Forbidden: cross-origin request");
  }

  if (!BODYLESS_METHODS.has(req.method.toUpperCase())) {
    const contentType = headers.get("content-type");
    const ok = contentType !== null ? isJsonContentType(contentType) : !hasBody(req);
    if (!ok) return deny(415, "Unsupported Media Type: send Content-Type: application/json");
  }

  return null;
}

// ── Secret masking ────────────────────────────────────────────────────────────

const MASK_GLYPH = "•";
export const SECRET_MASK = MASK_GLYPH.repeat(4);
const SECRET_KEY_RE = /api[-_]?key|token|secret|password/i;
/** Shorter secrets get no visible suffix, so the mask never reveals a meaningful share of the value. */
const MIN_LEN_FOR_SUFFIX = 16;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key);
}

/** "" stays "" (unset); anything else becomes "••••" plus the last 4 chars of long values. */
export function maskSecret(value: string): string {
  if (!value) return "";
  return value.length >= MIN_LEN_FOR_SUFFIX ? SECRET_MASK + value.slice(-4) : SECRET_MASK;
}

/** True when a value is (or was edited from) a mask we handed out. */
export function isMaskedValue(value: string): boolean {
  return value.includes(MASK_GLYPH);
}

/** Masks every secret-named setting. Non-secret settings pass through unchanged. */
export function maskSettings(settings: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings)) {
    out[key] = isSecretKey(key) ? maskSecret(value) : value;
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Settings PUT body → entries safe to persist. Drops non-string values and any
 * secret whose value still carries the mask, so saving the form unchanged
 * never overwrites a stored API key with "••••abcd".
 */
export function sanitizeSettingsUpdate(body: unknown): Record<string, string> {
  if (!isPlainObject(body)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value !== "string") continue;
    if (isSecretKey(key) && isMaskedValue(value)) continue;
    out[key] = value;
  }
  return out;
}

/** Deep variant of maskSettings for nested JSON such as ~/.claude/config.json. */
export function maskSecretsDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSecretsDeep);
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = isSecretKey(key) && typeof v === "string" ? maskSecret(v) : maskSecretsDeep(v);
  }
  return out;
}

/** Deep variant of sanitizeSettingsUpdate's mask filter, for config.json patches. */
export function dropMaskedSecretsDeep(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (isSecretKey(key) && typeof v === "string" && isMaskedValue(v)) continue;
    out[key] = isPlainObject(v) ? dropMaskedSecretsDeep(v) : v;
  }
  return out;
}

// ── /api/reveal path restriction ──────────────────────────────────────────────

export type RevealTarget =
  | { ok: true; path: string }
  | { ok: false; status: 403 | 404; error: string };

function isInside(root: string, p: string): boolean {
  const rel = relative(root, p);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Resolves the path /api/reveal may open. Only the database file or something
 * inside its directory is allowed, checked after realpath so symlinks and `..`
 * cannot escape. Defaults to the database file when no path is requested.
 */
export function resolveRevealTarget(requested: unknown, dbPath: string): RevealTarget {
  const dbFile = resolve(dbPath);
  const root = dirname(dbFile);
  const target = typeof requested === "string" && requested.length > 0 ? resolve(root, requested) : dbFile;

  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return { ok: false, status: 404, error: "Database directory not found" };
  }

  let realTarget: string;
  try {
    realTarget = realpathSync(target);
  } catch {
    // Only report "not found" inside the allowed root — elsewhere we must not
    // act as a file-existence oracle.
    return isInside(root, target) || isInside(realRoot, target)
      ? { ok: false, status: 404, error: "Path not found" }
      : { ok: false, status: 403, error: "Forbidden: path is outside the database directory" };
  }

  if (!isInside(realRoot, realTarget)) {
    return { ok: false, status: 403, error: "Forbidden: path is outside the database directory" };
  }
  return { ok: true, path: realTarget };
}
