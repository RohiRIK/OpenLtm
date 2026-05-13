// @rohirik/ltm-core — public API
export type { LtmCoreConfig, LtmAdapterContext, LtmAdapterOptions } from "./adapterTypes.js";

// DB singleton + configuration
export { getDb, initDb, configure, waitForInit, _setDbForTesting, withRetry, DB_PATH,
         getSetting, setSetting, getAllSettings } from "./shared-db.js";
export { configureCore, configureDocs } from "./db.js";

// Core memory operations
export {
  learn, recall, forget, relate, getSimilarMemories,
  getContextMerge, getContextMergeWithGraph, computeDecayScore,
  exportMarkdown, exportGraphJson,
} from "./db.js";
export type {
  Memory, MemoryWithRelations, MemoryCategory, RelationshipType, MemoryRelation,
} from "./db.js";

// Context items
export { exportContextMarkdown } from "./context.js";

// Migrations
export { runPendingMigrations, getMigrationStatus, getMigrationFiles } from "./migrations.js";

// DAO types
export type {
  ContextItemRow, ContextItemType, MemorySlim, AuditOp, ProvenanceRow, ConflictRow,
} from "./dao/types.js";
export { getRecentConflicts } from "./dao/conflicts.js";
export { insertProvenance, insertAudit } from "./dao/provenanceAudit.js";
export { setEmbedding, getEmbedding, listMemoryIdsMissingEmbedding } from "./dao/embeddings.js";

// Utilities
export { scrubSecrets } from "./secretsScrubber.js";
export { normalizeKey } from "./dedup.js";
export { embedText } from "./embeddings.js";

// Janitor
export { runJanitor } from "./janitor/index.js";

// Graph
export { traverseGraph, buildReasoningContext } from "./graph.js";
