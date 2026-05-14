declare module "@opencode-ai/plugin" {
  export interface ProjectInfo {
    path: string;
    name?: string;
  }

  export interface PluginInput {
    project: ProjectInfo;
    sessionID: string;
  }

  export interface SystemTransformOutput {
    system: string[];
  }

  export interface CompactingOutput {
    context: string[];
  }

  export interface ToolParameter {
    type: string;
    description?: string;
    enum?: string[];
    minimum?: number;
    maximum?: number;
    items?: ToolParameter;
    properties?: Record<string, ToolParameter>;
    required?: string[];
    default?: unknown;
  }

  export interface ToolDefinition {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, ToolParameter>;
      required?: string[];
    };
    execute(params: Record<string, unknown>): Promise<unknown>;
  }

  export interface Hooks {
    tool?: ToolDefinition[];
    "experimental.chat.system.transform"?: (
      ctx: { sessionID: string; model: string },
      output: SystemTransformOutput,
    ) => Promise<void>;
    "experimental.session.compacting"?: (
      ctx: { sessionID: string },
      output: CompactingOutput,
    ) => Promise<void>;
  }

  export type Plugin = (input: PluginInput) => Promise<Hooks>;

  export interface PluginModule {
    server: Plugin;
  }
}
