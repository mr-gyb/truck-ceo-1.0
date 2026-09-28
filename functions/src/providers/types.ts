/**
 * Shared types for the askAssistant model-provider abstraction.
 *
 * The provider layer swaps ONLY the chat-completions + tool-call transport.
 * All 9 business tools, auth, role/route scoping, thread logging, escalation,
 * and rate limits live in ../index.ts and are provider-independent.
 */

export interface NeutralToolParam {
  type: "string" | "number" | "boolean";
  description?: string;
}

/**
 * Provider-neutral tool definition. Each provider translates this into its
 * own wire format (Gemini FunctionDeclarations, OpenAI function tools).
 */
export interface NeutralTool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, NeutralToolParam>;
    required?: string[];
  };
}

export interface ToolExecutorResult {
  ok: boolean;
  data?: any;
  error?: string;
}

export interface TurnOptions {
  apiKey: string;
  model: string;
  systemInstruction: string;
  history: Array<{ role: "user" | "model"; text: string }>;
  message: string;
  tools: NeutralTool[];
  maxRounds: number;
  /** Executes one business tool server-side (implemented in index.ts). */
  executeTool: (name: string, args: any) => Promise<ToolExecutorResult>;
}

export interface ProviderToolCall {
  name: string;
  args: any;
  ok: boolean;
}

export interface ProviderTurnResult {
  text: string;
  toolCalls: ProviderToolCall[];
}

export interface ChatProvider {
  /** Secret Manager env var holding this provider's API key. */
  keyEnvVar: string;
  /** Default model id for this provider. */
  defaultModel: string;
  /** Runs one assistant turn (multi-round tool loop). */
  runTurn(opts: TurnOptions): Promise<ProviderTurnResult>;
}
