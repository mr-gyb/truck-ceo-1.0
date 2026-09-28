/**
 * Shared OpenAI-compatible chat-completions transport.
 *
 * Used by the Meta Model API provider (baseURL https://api.meta.ai/v1) and
 * the OpenAI provider (default https://api.openai.com/v1). Both speak the
 * chat-completions + function-calling API, so one implementation serves both.
 */
import OpenAI from "openai";
import type {
  ChatProvider,
  NeutralTool,
  TurnOptions,
  ProviderTurnResult,
} from "./types";

export interface OpenAICompatibleConfig {
  keyEnvVar: string;
  defaultModel: string;
  /** Omit to use the OpenAI default (https://api.openai.com/v1). */
  baseURL?: string;
}

function toOpenAITools(tools: NeutralTool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: "object" as const,
        properties: Object.fromEntries(
          Object.entries(t.parameters.properties).map(([k, v]) => [
            k,
            { type: v.type, description: v.description },
          ])
        ),
        ...(t.parameters.required ? { required: t.parameters.required } : {}),
      },
    },
  }));
}

export function makeOpenAICompatibleProvider(
  cfg: OpenAICompatibleConfig
): ChatProvider {
  return {
    keyEnvVar: cfg.keyEnvVar,
    defaultModel: cfg.defaultModel,

    async runTurn(opts: TurnOptions): Promise<ProviderTurnResult> {
      const client = new OpenAI({
        apiKey: opts.apiKey,
        ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
      });

      const messages: any[] = [
        { role: "system", content: opts.systemInstruction },
        ...opts.history.map((h) => ({
          role: h.role === "model" ? "assistant" : "user",
          content: h.text,
        })),
        { role: "user", content: opts.message },
      ];

      const tools = toOpenAITools(opts.tools);
      const toolCalls: ProviderTurnResult["toolCalls"] = [];
      let finalText = "I wasn't able to answer that — please try again.";

      for (let round = 0; round < opts.maxRounds; round++) {
        const completion = await client.chat.completions.create({
          model: opts.model,
          messages,
          tools,
          tool_choice: "auto",
        });

        const msg = completion.choices[0]?.message;
        if (!msg) break;
        if (msg.content) finalText = msg.content;

        const calls = msg.tool_calls || [];
        messages.push(msg);
        if (calls.length === 0) break;

        for (const c of calls) {
          if (c.type !== "function") continue;
          let args: any = {};
          try {
            args = c.function.arguments ? JSON.parse(c.function.arguments) : {};
          } catch {
            args = {};
          }
          const result = await opts.executeTool(c.function.name, args);
          toolCalls.push({ name: c.function.name, args, ok: result.ok });
          messages.push({
            role: "tool",
            tool_call_id: c.id,
            content: JSON.stringify(
              result.ok ? result.data : { error: result.error }
            ),
          });
        }
      }

      return { text: finalText, toolCalls };
    },
  };
}
