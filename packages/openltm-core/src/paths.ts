/**
 * paths.ts (openltm-core) — Path resolution without any host-specific defaults.
 * Priority: LTM_DB_PATH env var > CLAUDE_PLUGIN_DATA env var > dev fallback.
 * The CLAUDE_DIR constant is intentionally absent — adapters inject paths via LtmCoreConfig.
 */
import { join } from "path";
import { existsSync } from "fs";

export function getDbPath(): string {
  if (process.env["LTM_DB_PATH"]) return process.env["LTM_DB_PATH"];
  if (process.env["CLAUDE_PLUGIN_DATA"]) return join(process.env["CLAUDE_PLUGIN_DATA"], "openltm.db");
  return join(import.meta.dir, "..", "..", "..", "data", "openltm.db");
}

export function getSchemaPath(): string {
  return join(import.meta.dir, "schema.sql");
}

/**
 * Locate the versioned SQL migrations.
 *
 * Order matters: the package-local `migrations/` copy is checked FIRST because
 * it is the one that ships inside the published npm tarball. The monorepo-root
 * path is only the development fallback. A published install that resolved to
 * the root path would silently find zero migrations and hand back a
 * column-incomplete database (missing `decay_score`, `workspace_id`, …).
 */
export function getMigrationsDir(): string {
  const packaged = join(import.meta.dir, "..", "migrations");
  if (existsSync(packaged)) return packaged;

  // Development inside the monorepo.
  return join(import.meta.dir, "..", "..", "..", "migrations");
}
