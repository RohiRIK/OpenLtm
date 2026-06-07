/** Configuration injected by the host adapter (Claude Code, OpenCode, Pi). */
export interface LtmCoreConfig {
  dbPath: string;
  schemaPath?: string;
  migrationsDir?: string;
  docsDir?: string;
  decayEnabled?: boolean;
  graphReasoning?: boolean;
  semanticFallback?: boolean;
  autoRelate?: boolean;
}

/** Session context passed from the host to openltm-core hooks. */
export interface LtmAdapterContext {
  cwd: string;
  project?: string;
}

/** Options provided to the adapter factory. */
export interface LtmAdapterOptions {
  config: LtmCoreConfig;
  pluginDataDir?: string;
}
