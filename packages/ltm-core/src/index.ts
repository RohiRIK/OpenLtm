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
  getEmbeddingProvider, semanticSearch, findSimilarMemories,
} from "./janitor/index.js";
export { runDecay } from "./janitor/decay.js";
export { SETTING_KEYS, SETTING_DEFAULTS } from "./janitor/providers/types.js";
export { anthropicLLM } from "./janitor/providers/anthropic.js";
export { cohereEmbedding } from "./janitor/providers/cohere.js";
export { geminiEmbedding, geminiLLM } from "./janitor/providers/gemini.js";
export { ollamaEmbedding } from "./janitor/providers/ollama.js";
export { openaiEmbedding } from "./janitor/providers/openai.js";
export { openrouterEmbedding } from "./janitor/providers/openrouter.js";

// Graph
export { traverseGraph, buildReasoningContext } from "./graph.js";

// Extension capability probe (custom SQLite / sqlite-vec / Honker)
export { getCapabilities, loadExtensions } from "./extensions.js";
export type { Capabilities } from "./extensions.js";

// Honker durable queue (embedding generation) — dormant without LTM_HONKER_EXT
export { getHonker, isHonkerAvailable } from "./lib/honker.js";
export { EMBED_QUEUE, getEmbeddingQueue, enqueueEmbedding, parseEmbeddingJob } from "./queue/index.js";
export type { EmbeddingJob } from "./queue/index.js";
export { startEmbeddingWorker } from "./queue/worker.js";
export type { EmbeddingWorkerHandle } from "./queue/worker.js";
export {
  registerJanitorSchedule, startJanitorScheduler,
  JANITOR_SCHEDULE_NAME, JANITOR_QUEUE, JANITOR_CHANNEL, DEFAULT_JANITOR_CRON,
} from "./scheduler/index.js";
export type { JanitorSchedulerHandle } from "./scheduler/index.js";
export {
  notifyLtm, startLtmListener, LTM_CHANNEL, MEMORY_ADDED,
  isCrossProcessSyncEnabled, notifyMemoryAdded, startCrossProcessSync,
} from "./events/index.js";
export type { LtmLiveEvent, LtmListenerHandle } from "./events/index.js";
