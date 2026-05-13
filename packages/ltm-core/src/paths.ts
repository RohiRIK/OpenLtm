/**
 * paths.ts (ltm-core) — Path resolution without any host-specific defaults.
 * Priority: LTM_DB_PATH env var > CLAUDE_PLUGIN_DATA env var > dev fallback.
 * The CLAUDE_DIR constant is intentionally absent — adapters inject paths via LtmCoreConfig.
 */
import { join } from "path";

export function getDbPath(): string {
  if (process.env["LTM_DB_PATH"]) return process.env["LTM_DB_PATH"];
  if (process.env["CLAUDE_PLUGIN_DATA"]) return join(process.env["CLAUDE_PLUGIN_DATA"], "ltm.db");
  return join(import.meta.dir, "..", "..", "..", "data", "ltm.db");
}

export function getSchemaPath(): string {
  return join(import.meta.dir, "schema.sql");
}

export function getMigrationsDir(): string {
  // Resolves to project-root migrations/ during development inside the monorepo.
  // Adapters should set LtmCoreConfig.migrationsDir when deploying standalone.
  return join(import.meta.dir, "..", "..", "..", "migrations");
}
