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
  LearnInput, LearnResult, RecallInput, DecayResult,
} from "./db.js";

// Context items
export { addItem, getItems, exportContextMarkdown, trimProgress, promote } from "./context.js";

// Migrations
export { runPendingMigrations, getMigrationStatus, getMigrationFiles } from "./migrations.js";

// DAO types
export type {
  ContextItemRow, ContextItemType, MemorySlim, AuditOp, ProvenanceRow, ConflictRow,
} from "./dao/types.js";
export { getRecentConflicts } from "./dao/conflicts.js";
export { insertProvenance, insertAudit, queryAudit, listProvenance, snapshotMemory, listProvenanceBatch } from "./dao/provenanceAudit.js";
export { setEmbedding, getEmbedding, deleteEmbedding, listMemoryIdsMissingEmbedding } from "./dao/embeddings.js";
export { listByProject, upsertGoal, appendProgress, addDecision, addGotcha } from "./dao/contextItems.js";

// Utilities
export { scrubSecrets } from "./secretsScrubber.js";
export { normalizeKey } from "./dedup.js";
export { embedText, getLlmConfig, callLlm } from "./embeddings.js";

// Recall utilities
export { categorise } from "./recall/categorise.js";
export { buildExplainer, computeTemperature } from "./recall/explainer.js";
export type { MemoryTemperature, RecallExplainer, ExplainerInput } from "./recall/explainer.js";

// Embedding providers
export * from "./providers/index.js";
export { WriteQueue, writeQueue } from "./lib/writeQueue.js";
export { emitEvent, readRecentEvents, getLogPath, _resetForTesting } from "./lib/jsonlLogger.js";
export type { LtmEvent } from "./lib/jsonlLogger.js";

// Proposals
export { listPendingProposals, acceptProposal, rejectProposal } from "./proposals.js";
export type { PendingProposal } from "./proposals.js";

// Janitor
export {
  runJanitor, getJanitorStatus, startAutoRun, stopAutoRun,
  runArchive, touchMemory,
  approveMemory, getPendingMemories, rejectMemory,
  mergeMemories, parseDedupSource,
  supersede,
  getEmbeddingProvider, semanticSearch,
} from "./janitor/index.js";
export { runDecay } from "./janitor/decay.js";

// Graph
export { traverseGraph, buildReasoningContext } from "./graph.js";
