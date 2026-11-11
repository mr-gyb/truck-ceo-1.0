/**
 * Capture-reader wrapper — the deployed surface (2026-11-10).
 *
 * processCapture (callable, EXPORTED from index.ts): the driver app
 * calls it right after createCapture uploads a capture (the client
 * pattern this codebase ships on — see SettlementUploader's callables;
 * gen2 Storage/Firestore triggers failed to deploy through the Actions
 * credential in runs 78-85, so callables are the proven path). Any
 * signed-in member of the capture's business may call it (the driver
 * who shot the photo, or the owner re-reading). It downloads the file
 * from Storage, runs the pure pipeline (./reader.ts) with the Gemini
 * reader, and writes back ONLY via toDocUpdate():
 *   extracted       -> status 'extracted', extracted + extraction set
 *   needs_attention -> status 'needs_attention', values null, note set
 *   error           -> NOTHING written to value fields; the attempt is
 *                      stamped (readerAttempts, lastReaderError) and the
 *                      capture stays 'pending' for a later retry
 * A 'confirmed' capture is never overwritten.
 *
 * onCaptureCreated (Firestore trigger) runs the same core for any
 * capture written without the client call — it is deliberately NOT
 * exported from index.ts yet, per the Plan B precedent in
 * settlements/ingest.ts: trigger deploys through the Actions credential
 * are unproven in this project. The callable covers production; add
 * onCaptureCreated to the index.ts export line to enable the trigger
 * once trigger deploys are verified.
 *
 * Key: GEMINI_API_KEY from the function environment (declared in the
 * callable's `secrets`, same secret askAssistant uses). No OpenAI key
 * is involved — the vault token is not a valid platform key.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { GeminiCaptureReader } from './providers';
import { processCapture as runReaderPipeline, toDocUpdate } from './reader';
import type { CaptureDoc } from './types';

const db = () => admin.firestore();

interface CaptureRef {
  businessId: string;
  routeId: string;
  captureId: string;
}

const capturePath = (r: CaptureRef) =>
  `businesses/${r.businessId}/routes/${r.routeId}/captures/${r.captureId}`;

async function runCaptureRead(
  ref: CaptureRef,
): Promise<{ outcome: string; status?: string }> {
  const docRef = db().doc(capturePath(ref));
  const snap = await docRef.get();
  if (!snap.exists) return { outcome: 'missing' };
  const capture = { id: snap.id, ...(snap.data() as Omit<CaptureDoc, 'id'>) };
  if (capture.status === 'confirmed') return { outcome: 'skipped', status: 'confirmed' };
  if (capture.status === 'extracted' || capture.status === 'needs_attention') {
    // A finished read is final unless the driver retakes (new capture).
    return { outcome: 'skipped', status: capture.status };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    await docRef.update({
      readerAttempts: admin.firestore.FieldValue.increment(1),
      lastReaderError: 'GEMINI_API_KEY is not configured on the function.',
    });
    return { outcome: 'error', status: capture.status };
  }

  const file = admin.storage().bucket().file(capture.storagePath);
  const [buffer] = await file.download();
  const [metadata] = await file.getMetadata().catch(() => [{} as any]);
  const mimeType =
    (metadata as any)?.contentType ||
    (capture.type === 'voice' ? 'audio/webm' : 'image/jpeg');

  const reader = new GeminiCaptureReader(apiKey);
  const wb = await runReaderPipeline(
    capture,
    { mimeType, dataBase64: buffer.toString('base64') },
    { imageReader: reader, transcriber: reader },
  );

  const update = toDocUpdate(wb);
  if (update) {
    await docRef.update(update);
    return { outcome: wb.outcome, status: update.status as string };
  }
  if (wb.outcome === 'error') {
    await docRef.update({
      readerAttempts: admin.firestore.FieldValue.increment(1),
      lastReaderError: wb.error ?? 'reader error',
    });
    logger.warn('processCapture: reader error', { ...ref, error: wb.error });
  }
  return { outcome: wb.outcome, status: capture.status };
}

export const processCapture = onCall(
  { memory: '1GiB', timeoutSeconds: 120, secrets: ['GEMINI_API_KEY'] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign-in required.');
    const { businessId, routeId, captureId } = (request.data ?? {}) as Partial<CaptureRef>;
    if (!businessId || !routeId || !captureId) {
      throw new HttpsError('invalid-argument', 'businessId, routeId and captureId are required.');
    }
    // Membership: the caller must belong to the capture's business (as
    // its primary business or via a driver membership), mirroring the
    // scoping the Firestore rules enforce for the doc itself.
    const userSnap = await db().collection('users').doc(request.auth.uid).get();
    const u = userSnap.exists
      ? (userSnap.data() as { businessId?: string; driverMemberships?: Array<{ businessId: string }> })
      : null;
    const isMember =
      !!u &&
      (u.businessId === businessId ||
        (u.driverMemberships ?? []).some((m) => m.businessId === businessId));
    if (!isMember) {
      throw new HttpsError('permission-denied', 'You are not a member of this business.');
    }
    const result = await runCaptureRead({ businessId, routeId, captureId });
    if (result.outcome === 'missing') throw new HttpsError('not-found', 'Capture not found.');
    if (result.outcome === 'error') {
      throw new HttpsError('internal', 'The reader could not process this capture yet. It stays pending — try again.');
    }
    return { ok: true, outcome: result.outcome, status: result.status ?? null };
  },
);

/**
 * Trigger twin of the callable — same core, fires on capture creation.
 * NOT exported from index.ts (see header): enable deliberately once
 * trigger deploys are proven for this project's credential.
 */
export const onCaptureCreated = onDocumentCreated(
  {
    document: 'businesses/{businessId}/routes/{routeId}/captures/{captureId}',
    memory: '1GiB',
    timeoutSeconds: 120,
    secrets: ['GEMINI_API_KEY'],
  },
  async (event) => {
    const { businessId, routeId, captureId } = event.params;
    const result = await runCaptureRead({ businessId, routeId, captureId });
    logger.info('onCaptureCreated: read finished', { businessId, routeId, captureId, ...result });
  },
);
