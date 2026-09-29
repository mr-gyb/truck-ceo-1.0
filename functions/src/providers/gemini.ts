/**
 * Gemini provider — the PRIMARY / day-1 ship target for askAssistant.
 *
 * Same logic the backend was built on: @google/genai generateContent with
 * functionDeclarations, multi-round tool loop, tool results fed back as
 * functionResponse parts. Reads its key from the GEMINI_API_KEY secret.
 */
import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import type {
  ChatProvider,
  NeutralTool,
  TurnOptions,
  ProviderTurnResult,
} from "./types";

function toGeminiType(t: string): any {
  if (t === "number") return Type.NUMBER;
  if (t === "boolean") return Type.BOOLEAN;
  return Type.STRING;
}

function toFunctionDeclarations(tools: NeutralTool[]): FunctionDeclaration[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: {
      type: Type.OBJECT,
      properties: Object.fromEntries(
        Object.entries(t.parameters.properties).map(([k, v]) => [
          k,
          { type: toGeminiType(v.type), description: v.description },
        ])
      ),
      ...(t.parameters.required ? { required: t.parameters.required } : {}),
    },
  }));
}

/**
 * Retry transient Gemini API errors (429 rate-limit, 503/500 overload) with
 * exponential backoff. Model-demand spikes are usually brief; without this a
 * single overloaded minute fails the whole chat turn.
 */
async function generateContentWithRetry(
  ai: GoogleGenAI,
  params: any,
  maxAttempts = 3
): Promise<any> {
  let lastErr: any = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await ai.models.generateContent(params);
    } catch (e: any) {
      lastErr = e;
      const status = e?.status ?? e?.error?.code;
      const transient = status === 429 || status === 503 || status === 500;
      if (!transient || attempt === maxAttempts) throw e;
      const delayMs = Math.min(1000 * 2 ** attempt, 8000);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

export const geminiProvider: ChatProvider = {
  keyEnvVar: "GEMINI_API_KEY",
  defaultModel: "gemini-3.8-flash",

  async runTurn(opts: TurnOptions): Promise<ProviderTurnResult> {
    const ai = new GoogleGenAI({ apiKey: opts.apiKey });

    const contents: any[] = [
      ...opts.history.map((h) => ({
        role: h.role,
        parts: [{ text: h.text }],
      })),
      { role: "user", parts: [{ text: opts.message }] },
    ];

    const toolCalls: ProviderTurnResult["toolCalls"] = [];
    let finalText = "I wasn't able to answer that — please try again.";

    for (let round = 0; round < opts.maxRounds; round++) {
      const response = await generateContentWithRetry(ai, {
        model: opts.model,
        contents,
        config: {
          systemInstruction: opts.systemInstruction,
          tools: [{ functionDeclarations: toFunctionDeclarations(opts.tools) }],
        },
      });

      const calls = response.functionCalls || [];
      if (response.text) finalText = response.text;
      if (calls.length === 0) break;

      const parts = response.candidates?.[0]?.content?.parts || [];
      contents.push({ role: "model", parts });

      for (const c of calls) {
        const args = (c.args as any) || {};
        const result = await opts.executeTool(c.name || "", args);
        toolCalls.push({ name: c.name || "", args, ok: result.ok });
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: c.name,
                response: {
                  result: result.ok ? result.data : { error: result.error },
                },
              },
            },
          ],
        });
      }
    }

    return { text: finalText, toolCalls };
  },
};
