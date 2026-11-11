/**
 * Capture-reader pipeline (2026-11-10) — PURE logic, no Firebase
 * imports, so the local harness can run the exact code the deployed
 * wrapper (processCapture.ts) runs.
 *
 * processCapture(capture, media, deps):
 *   pending capture + its file bytes -> ReaderWriteBack
 *     - 'extracted'       values read and validated (schemas.ts gate)
 *     - 'needs_attention' the source could not be read — extracted is
 *                         null and attentionNote tells the driver what
 *                         to do; NO value is ever guessed
 *     - 'error'           the reader itself failed (provider down, no
 *                         reference, ...) — nothing is written to the
 *                         value fields; the capture STAYS 'pending' so
 *                         the read can be retried
 *     - 'skipped'         the capture was not pending (already read or
 *                         driver-confirmed) — a confirmed read is never
 *                         overwritten
 *
 * Voice captures go to the transcriber; the transcript becomes the
 * 'transcript' field the EOD outlook derives from, and the reader also
 * flags whether the note reads as an outlook note (tomorrow / promos /
 * flags) via keyword evidence — a transcript with no such evidence is
 * still a valid transcript (isOutlookNote false), never blocked.
 */

import { buildExtraction } from './schemas';
import type { CaptureTranscriber, CaptureImageReader, CaptureMediaInput } from './providers';
import type { CaptureDoc, RawExtraction, ReaderWriteBack } from './types';

export interface ReaderDeps {
  imageReader: CaptureImageReader;
  transcriber: CaptureTranscriber;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

const OUTLOOK_HINTS = [
  'tomorrow', 'promo', 'promotion', 'sale', 'order', 'flag', 'watch',
  'heads up', 'next day', 'coming up', 'heads-up',
];

export async function processCapture(
  capture: CaptureDoc,
  media: CaptureMediaInput,
  deps: ReaderDeps,
): Promise<ReaderWriteBack> {
  if (capture.status !== 'pending') return { outcome: 'skipped' };
  const readAt = (deps.now ? deps.now() : new Date()).toISOString();
  try {
    let raw: RawExtraction;
    let readerInfo;
    if (capture.type === 'voice') {
      const t = await deps.transcriber.transcribe({ captureId: capture.id ?? '', media });
      readerInfo = deps.transcriber.info;
      const transcript = t.transcript?.trim() ? t.transcript.trim() : null;
      const lower = (transcript ?? '').toLowerCase();
      raw = {
        legible: transcript != null,
        fields: {
          transcript: transcript ? { value: transcript, confidence: t.confidence } : null,
          isOutlookNote: transcript
            ? {
                value: OUTLOOK_HINTS.some((h) => lower.includes(h)),
                confidence: t.confidence,
              }
            : null,
        },
        note: transcript ? null : 'No speech could be made out.',
      };
    } else {
      raw = await deps.imageReader.readImage({
        captureId: capture.id ?? '',
        type: capture.type,
        media,
        context: {
          date: capture.date,
          storeName: capture.storeName ?? null,
          driverName: capture.driverName ?? null,
        },
      });
      readerInfo = deps.imageReader.info;
    }
    const built = buildExtraction(capture.type, raw, readerInfo, readAt);
    if (!built.ok) {
      return {
        outcome: 'needs_attention',
        extracted: null,
        extraction: null,
        attentionNote: built.attentionNote,
      };
    }
    return {
      outcome: 'extracted',
      extracted: built.extracted,
      extraction: built.extraction,
      attentionNote: null,
    };
  } catch (e) {
    return {
      outcome: 'error',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * The Firestore field map for a finished read — the ONLY writer shape.
 * 'error' and 'skipped' map to null (the wrapper stamps attempts
 * separately and never touches value fields for them).
 */
export function toDocUpdate(
  wb: ReaderWriteBack,
): Record<string, unknown> | null {
  if (wb.outcome === 'extracted') {
    return {
      status: 'extracted',
      extracted: wb.extracted ?? null,
      extraction: wb.extraction ?? null,
      attentionNote: null,
      lastReaderError: null,
    };
  }
  if (wb.outcome === 'needs_attention') {
    return {
      status: 'needs_attention',
      extracted: null,
      extraction: null,
      attentionNote: wb.attentionNote ?? null,
      lastReaderError: null,
    };
  }
  return null;
}
