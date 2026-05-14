declare module "@earendil-works/pi-ai" {
  export interface PiToolParameter {
    type: string;
    description?: string;
    enum?: string[];
    minimum?: number;
    maximum?: number;
    default?: unknown;
  }

  export interface PiToolDefinition {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, PiToolParameter>;
      required?: string[];
    };
    handler(params: Record<string, unknown>): Promise<unknown>;
  }

  export interface SessionStartContext {
    cwd: string;
    sessionID: string;
    appendToSystemPrompt(block: string): void;
  }

  export interface CompactContext {
    cwd: string;
    sessionID: string;
    getSessionSummary(): string;
  }

  type EventMap = {
    "session:start": SessionStartContext;
    compact: CompactContext;
  };

  export interface PiExtensionAPI {
    on<E extends keyof EventMap>(event: E, handler: (ctx: EventMap[E]) => void | Promise<void>): void;
    registerTool(definition: PiToolDefinition): void;
  }
}
