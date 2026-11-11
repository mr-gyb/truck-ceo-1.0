/**
 * Capture-reader providers — the seam between the pipeline and any
 * actual model (2026-11-10).
 *
 * The pipeline (reader.ts) depends ONLY on the two interfaces here:
 *   CaptureImageReader — photo -> RawExtraction (untrusted; schemas.ts
 *                        validates before anything is stored)
 *   CaptureTranscriber — audio -> transcript + confidence
 *
 * Implementations:
 *   GeminiCaptureReader   — production. Gemini vision + audio via
 *     @google/genai, the same provider family the assistant backend
 *     already ships on (src/providers/gemini.ts). The API key is passed
 *     in by the wrapper (processCapture.ts reads GEMINI_API_KEY from the
 *     function environment — the secret the project already provisions
 *     for askAssistant). NOT the vault's OpenAI credential: that token
 *     is not a valid platform key and nothing here depends on it.
 *   ReferenceCaptureReader — local / dry-run. Returns pre-produced
 *     reference extractions keyed by capture id; used by the local
 *     verification harness (functions/test/run-capture-reader.ts) so the
 *     full pipeline runs end to end with no key and no network.
 *
 * Swapping in another vision/STT vendor later = one new class behind
 * these interfaces; the pipeline, schemas and EOD derivation do not
 * change.
 */

import { READER_FIELD_GUIDE, READER_VERSION } from './schemas';
import type { CaptureType, RawExtraction, ReaderInfo } from './types';

export interface CaptureMediaInput {
  mimeType: string;
  /** Base64 media bytes (the capture file from Storage). */
  dataBase64: string;
}

export interface ImageReadRequest {
  captureId: string;
  type: CaptureType;
  media: CaptureMediaInput;
  context: {
    date: string;
    storeName?: string | null;
    driverName?: string | null;
  };
}

export interface TranscribeRequest {
  captureId: string;
  media: CaptureMediaInput;
}

export interface TranscribeResult {
  transcript: string | null;
  /** 0..1 — provider-reported; see the Gemini note below. */
  confidence: number;
}

export interface CaptureImageReader {
  readonly info: ReaderInfo;
  readImage(req: ImageReadRequest): Promise<RawExtraction>;
}

export interface CaptureTranscriber {
  readonly info: ReaderInfo;
  transcribe(req: TranscribeRequest): Promise<TranscribeResult>;
}

// ─── Reference reader (local / dry-run) ─────────────────────────────────

export class ReferenceCaptureReader implements CaptureImageReader, CaptureTranscriber {
  readonly info: ReaderInfo = { name: 'reference', version: READER_VERSION };

  constructor(
    private readonly images: Record<string, RawExtraction>,
    private readonly transcripts: Record<string, TranscribeResult> = {},
  ) {}

  async readImage(req: ImageReadRequest): Promise<RawExtraction> {
    const hit = this.images[req.captureId];
    if (!hit) {
      throw new Error(`ReferenceCaptureReader: no reference extraction for capture ${req.captureId}`);
    }
    return hit;
  }

  async transcribe(req: TranscribeRequest): Promise<TranscribeResult> {
    const hit = this.transcripts[req.captureId];
    if (!hit) {
      throw new Error(`ReferenceCaptureReader: no reference transcript for capture ${req.captureId}`);
    }
    return hit;
  }
}

// ─── Gemini reader (production) ─────────────────────────────────────────

const DEFAULT_MODEL = process.env.CAPTURE_READER_MODEL || 'gemini-2.5-flash';

const SYSTEM_RULES = [
  'You read photos and paperwork for a bread-route delivery driver app.',
  'Read ONLY what is actually visible in the image. Never estimate, never',
  'fill in a plausible number, never use outside knowledge about a store.',
  'If a field is not readable, return it as null. If the whole image',
  'cannot be read (blur, glare, darkness, wrong document), return',
  '"legible": false and every field null.',
  'For every field return {"value": ..., "confidence": 0..1} where',
  'confidence is how sure you are of THAT read. Line items return one',
  'confidence per line: {"product": ..., "qty": ..., "confidence": ...}.',
  'Dates: return exactly as written (e.g. "11/10/2026"). Counts: integers.',
  'Respond with a single JSON object: {"legible": boolean, "note": string|null, "fields": {...}}.',
].join(' ');

/** Retry transient Gemini errors (429/503/500) — same pattern as src/providers/gemini.ts. */
async function generateWithRetry(ai: any, params: any, maxAttempts = 3): Promise<any> {
  let lastErr: any = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await ai.models.generateContent(params);
    } catch (e: any) {
      lastErr = e;
      const status = e?.status ?? e?.error?.code;
      const transient = status === 429 || status === 503 || status === 500;
      if (!transient || attempt === maxAttempts) throw e;
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 8000)));
    }
  }
  throw lastErr;
}

function parseJsonResponse(text: string): any {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleaned);
}

export class GeminiCaptureReader implements CaptureImageReader, CaptureTranscriber {
  readonly info: ReaderInfo = { name: 'gemini', version: READER_VERSION, model: DEFAULT_MODEL };

  constructor(private readonly apiKey: string, private readonly model: string = DEFAULT_MODEL) {
    this.info = { name: 'gemini', version: READER_VERSION, model: this.model };
  }

  private client(): any {
    // Lazy require: keeps this module importable in the local test
    // harness (which runs from /tmp with no node_modules) and keeps the
    // SDK out of the pipeline's module graph until a read is requested.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GoogleGenAI } = require('@google/genai');
    return new GoogleGenAI({ apiKey: this.apiKey });
  }

  async readImage(req: ImageReadRequest): Promise<RawExtraction> {
    const ai = this.client();
    const prompt = [
      SYSTEM_RULES,
      `This photo is a "${req.type}" capture from a driver's route day (${req.context.date}).`,
      `Read these fields: ${READER_FIELD_GUIDE[req.type]}`,
      req.context.storeName ? `The driver tagged it with store: ${req.context.storeName}.` : '',
    ].filter(Boolean).join('\n');
    const response = await generateWithRetry(ai, {
      model: this.model,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: req.media.mimeType, data: req.media.dataBase64 } },
            { text: prompt },
          ],
        },
      ],
      config: { responseMimeType: 'application/json' },
    });
    const parsed = parseJsonResponse(response.text ?? '');
    return {
      legible: parsed?.legible === true,
      fields: (parsed?.fields as Record<string, any>) ?? {},
      note: typeof parsed?.note === 'string' ? parsed.note : null,
    };
  }

  async transcribe(req: TranscribeRequest): Promise<TranscribeResult> {
    const ai = this.client();
    const response = await generateWithRetry(ai, {
      model: this.model,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: req.media.mimeType, data: req.media.dataBase64 } },
            {
              text:
                'Transcribe this driver voice note exactly, word for word. Respond with a single JSON object: ' +
                '{"transcript": string|null}. Return null when no speech can be made out.',
            },
          ],
        },
      ],
      config: { responseMimeType: 'application/json' },
    });
    const parsed = parseJsonResponse(response.text ?? '');
    const transcript =
      typeof parsed?.transcript === 'string' && parsed.transcript.trim()
        ? parsed.transcript.trim()
        : null;
    // Gemini reports no calibrated confidence for transcription; 0.75 is
    // a NOMINAL pass-through value (documented as unmeasured), used only
    // to clear the schema floor when a transcript exists. The whisper
    // local path reports a measured proxy instead.
    return { transcript, confidence: transcript ? 0.75 : 0 };
  }
}
