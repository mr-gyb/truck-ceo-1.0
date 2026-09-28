/**
 * Provider registry for askAssistant.
 *
 * Selected at runtime via the MODEL_PROVIDER env var:
 *   "gemini" (default, day-1 ship target) | "meta" | "openai"
 */
import { geminiProvider } from "./gemini";
import { metaProvider } from "./meta";
import { openaiProvider } from "./openai";
import type { ChatProvider } from "./types";

const REGISTRY: Record<string, ChatProvider> = {
  gemini: geminiProvider,
  meta: metaProvider,
  openai: openaiProvider,
};

export const PROVIDER_MODELS: Record<string, string> = {
  gemini: geminiProvider.defaultModel,
  meta: metaProvider.defaultModel,
  openai: openaiProvider.defaultModel,
};

export function getProvider(name: string): ChatProvider {
  const p = REGISTRY[(name || "").toLowerCase()];
  if (!p) {
    throw new Error(
      `Unknown MODEL_PROVIDER "${name}". Use one of: ${Object.keys(REGISTRY).join(", ")}.`
    );
  }
  return p;
}

export type { ChatProvider, NeutralTool, TurnOptions, ProviderTurnResult } from "./types";
