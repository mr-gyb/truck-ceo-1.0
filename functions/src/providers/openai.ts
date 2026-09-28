/**
 * OpenAI provider — VERIFIED BACKUP (config flip).
 *
 * Standard Chat Completions API + function calling (well-established).
 * Default model: gpt-5-mini (established mini-tier, function calling
 * supported; ~$0.25/M input, ~$2.00/M output per recent pricing tables).
 * Newer cost-sensitive alternative: gpt-6-luna (~$0.10/M in, ~$0.50/M out).
 * Key signup: https://platform.openai.com/ → API keys.
 *
 * Reads its key from the OPENAI_API_KEY secret.
 */
import { makeOpenAICompatibleProvider } from "./openaiCompatible";

export const openaiProvider = makeOpenAICompatibleProvider({
  keyEnvVar: "OPENAI_API_KEY",
  defaultModel: "gpt-5-mini",
});
