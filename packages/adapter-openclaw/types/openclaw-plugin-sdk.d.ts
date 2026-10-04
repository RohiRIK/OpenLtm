/**
 * openclaw.d.ts — minimal ambient types for the host-provided OpenClaw plugin SDK.
 *
 * `@openclaw/plugin-sdk` is a workspace package inside the OpenClaw repo and is
 * not published. External plugins import from the host's own `openclaw` package
 * instead (`openclaw/plugin-sdk/plugin-entry`), which is why `openclaw` is an
 * optional peer dependency and is never installed here.
 *
 * These declarations cover only the surface this plugin uses. They exist so
 * `bun run typecheck` works in CI; the real contracts come from the host.
 */
declare module "openclaw/plugin-sdk/plugin-entry" {
  /** Tool schema helper (structurally compatible with TypeBox). */
  export interface TypeBoxLike {
    readonly [key: string]: unknown;
  }

  export interface PluginToolDefinition {
    name: string;
    label?: string;
    description: string;
    parameters: unknown;
    execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
  }

  export interface PluginLogger {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
    debug?: (message: string) => void;
  }

  export interface MemoryPromptSectionParams {
    availableTools: Set<string>;
    citationsMode?: string;
    agentId?: string;
    agentSessionKey?: string;
    sandboxed?: boolean;
  }

  export interface OpenClawPluginApi {
    logger: PluginLogger;
    pluginConfig?: unknown;
    registerTool: (tool: unknown, opts?: unknown) => void;
    registerHook?: (events: string | string[], handler: unknown, opts?: unknown) => void;
    registerMemoryPromptSupplement?: (builder: (params: MemoryPromptSectionParams) => string[]) => void;
    /** Async, awaited by the host before the prompt is built (openclaw >= 2026.9.8). */
    registerMemoryPromptPreparation?: (
      prepare: (params: MemoryPromptSectionParams) => Promise<readonly string[]>,
    ) => void;
  }

  export interface OpenClawPluginConfigSchema {
    type: "object";
    additionalProperties?: boolean;
    properties?: Record<string, unknown>;
  }

  export interface DefinePluginEntryOptions {
    id: string;
    name: string;
    description: string;
    kind?: "memory" | "context-engine";
    configSchema?: OpenClawPluginConfigSchema | (() => OpenClawPluginConfigSchema);
    reload?: unknown;
    nodeHostCommands?: unknown;
    securityAuditCollectors?: unknown;
    register: (api: OpenClawPluginApi) => void;
  }

  export function definePluginEntry(options: DefinePluginEntryOptions): unknown;
}
