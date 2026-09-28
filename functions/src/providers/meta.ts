/**
 * Meta Model API provider — VERIFIED BACKUP (config flip).
 *
 * Verified against official Meta docs (2026-09-28):
 * - Base URL: https://api.meta.ai/v1                      (dev.meta.ai/docs/models)
 * - Auth: API key (OpenAI-compatible SDK, api_key)          (ai.meta.com/blog/introducing-muse-spark-meta-model-api)
 * - Model: muse-spark-1.3 (also lists 1.2, 1.1)             (dev.meta.ai/docs/models)
 * - Tool/function calling: supported, incl. multi-step loops (dev.meta.ai/docs/models)
 * - Key signup: https://dev.meta.ai/ → Start building → payment method → create API key
 *   (dev.meta.ai/help/accounts-and-login/sign-up, dev.meta.ai/help/api-keys/create-api-key)
 * - Pricing (Standard): $1.25/M input, $4.25/M output, $0.15/M cached input
 *   (dev.meta.ai/docs/pricing-rate-limits). Standard tier does not train on prompts.
 * - Region: "supported countries or territories" per official docs; US-only
 *   availability NOT conclusively confirmed from retrieved official text.
 *
 * Reads its key from the META_MODEL_API_KEY secret.
 */
import { makeOpenAICompatibleProvider } from "./openaiCompatible";

export const metaProvider = makeOpenAICompatibleProvider({
  keyEnvVar: "META_MODEL_API_KEY",
  defaultModel: "muse-spark-1.3",
  baseURL: "https://api.meta.ai/v1",
});
