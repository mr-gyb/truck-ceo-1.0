/**
 * Flowers IDP ingest wrapper — the deploy-time half of the data-intake
 * pipeline (the parser in ./flowersIdp.ts + ./index.ts is pure).
 *
 * Flow (Plan C, 2026-11-07 — current): the DataHub SettlementUploader
 * sends each PDF's bytes directly to the owner-only `ingestSettlementPdf`
 * callable as base64. The function derives the business from the
 * caller's users/{uid} doc, persists the raw PDF to
 *   businesses/{businessId}/settlement-uploads/{fileName}
 * via the Admin SDK (server-side writes bypass the bucket's client
 * rules), then runs the shared bytes core below: extractPdfText
 * (./pdfText.ts) -> parseFlowersDocument -> structured record +
 * ingestion registry entry (Admin SDK). Plan C exists because the
 * bucket has no usable client Storage rules and the deploy credential
 * cannot publish rules (HTTP 403), so the Plan B client uploadBytes
 * step failed live with storage/unauthorized.
 *
 * Plan B paths retained: `reprocessSettlement({ storagePath })` still
 * reprocesses a file already in Storage through the same core, and the
 * onObjectFinalized trigger below (onSettlementUpload) is the hands-free
 * variant; it is retained but NOT exported from src/index.ts, so it is
 * not deployed — see the Plan B note at the trigger for why, and what
 * re-enabling it takes.
 *
 * Identity comes from the DOCUMENT, never the file name: the route is the
 * distributor/route number printed in the PDF, resolved to the business's
 * Firestore route doc by its routeNumber field (digits-normalized), with
 * the route number itself as the fallback doc id so master statements
 * (Master Route 13438, which has no route doc) still land at the exact
 * path the registry declares.
 *
 * Anything that does not validate cleanly — parse failure, reconcile
 * discrepancy, unresolvable route — is queued to the existing exception
 * pattern (businesses/{bid}/dataFeedRequests + top-level agentInbox, the
 * same pair request_data_feed_connection writes) and NEVER silently
 * dropped. Records that fail validation are still written (marked
 * needs_review) unless the route cannot be resolved at all.
 *
 * Idempotent: record doc ids (weekEnding) and registry ids are
 * deterministic, so re-uploads and trigger retries overwrite in place.
 */

import { onObjectFinalized, StorageEvent } from 'firebase-functions/v2/storage';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { extractPdfText } from './pdfText';
import { FlowersParseOutput, parseFlowersDocument } from './index';
import { IngestionRegistryEntry } from './types';

const UPLOAD_PREFIX = 'settlement-uploads';

/** The project's default storage bucket, named explicitly so the
 *  reprocess callable (and the dormant trigger below, if re-enabled)
 *  never depends on the Admin SDK's ambient bucket. NOTE: pinning the
 *  bucket here did NOT fix the deploy failure — firebase-tools still
 *  could not resolve the bucket region for the gen2 storage trigger
 *  ("Can't find the storage bucket region", Actions runs 78–85). That
 *  lookup is the trigger's deploy-time problem, not this constant's;
 *  Plan B removes the trigger from the deployed surface instead. */
const STORAGE_BUCKET = 'truck-ceo.firebasestorage.app';

const db = () => admin.firestore();

/** Firestore rejects undefined values; parsed records carry optional
 *  fields that may be undefined. JSON round-trip drops them safely
 *  (records are plain data — no Dates, no class instances). */
function clean<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export interface IngestResult {
  ok: boolean;
  docType?: string;
  routeNumber?: string;
  weekEnding?: string;
  status?: string;
  /** Total product charged (statements only — margin detail and shrink
   *  records carry no single charged total). */
  totalCharged?: number;
  recordPath?: string;
  registryId?: string;
  exception?: string;
  /** Plan C only: the Storage path the raw PDF was persisted to via the
   *  Admin SDK, when that best-effort write succeeded. Absent when the
   *  write failed (records are still written) or on the Storage paths. */
  storedPath?: string;
}

/** Plan C payload cap: max decoded PDF size accepted by
 *  ingestSettlementPdf. IDP statement PDFs run well under 1 MB; 7 MB
 *  leaves the base64-inflated callable request (~9.3 MB) under the
 *  platform's 10 MB callable payload limit. */
export const MAX_SETTLEMENT_PDF_BYTES = 7 * 1024 * 1024;

function parseUploadPath(objectName: string): { businessId: string; fileName: string } | null {
  const parts = objectName.split('/');
  if (parts.length < 4 || parts[0] !== 'businesses' || parts[2] !== UPLOAD_PREFIX) return null;
  return { businessId: parts[1], fileName: parts.slice(3).join('/') };
}

/** Resolve a printed route number to the business's route doc id. */
async function resolveRouteDocId(businessId: string, routeNumber: string): Promise<string | null> {
  const digits = routeNumber.replace(/\D/g, '');
  try {
    const snap = await db().collection(`businesses/${businessId}/routes`).get();
    for (const d of snap.docs) {
      const data = d.data() as { routeNumber?: unknown };
      const rn = data.routeNumber != null ? String(data.routeNumber) : '';
      if (rn !== '' && (rn === routeNumber || rn.replace(/\D/g, '') === digits)) return d.id;
      if (d.id === routeNumber) return d.id;
    }
  } catch (e) {
    logger.warn('ingest: route resolution read failed', { businessId, routeNumber, e });
  }
  return null;
}

/** Queue an ingest exception to the existing GYBs pickup surfaces. */
async function queueException(
  businessId: string,
  summary: string,
  context: Record<string, unknown>,
): Promise<void> {
  const now = admin.firestore.FieldValue.serverTimestamp();
  await db().collection(`businesses/${businessId}/dataFeedRequests`).add({
    platform: 'Flowers IDP settlement intake',
    kind: 'settlement_ingest_exception',
    status: 'requested',
    summary,
    ...context,
    createdAt: now,
    via: 'settlement-ingest',
  });
  await db().collection('agentInbox').add({
    type: 'settlement_ingest_exception',
    summary,
    businessId,
    ...context,
    status: 'open',
    createdAt: now,
  });
}

/**
 * Core ingest (inner), bytes form: extract, parse, write for one PDF
 * already in memory. This is THE processing core — the Storage-object
 * path (trigger + reprocessSettlement) downloads and delegates here,
 * and the Plan C callable (ingestSettlementPdf) calls it directly, so
 * every entry point produces identical records. The extract/parse stage
 * returns its failures as IngestResult; the post-parse stage (route
 * resolution read, batch write, margin merge, review queueing) can
 * still THROW — callers must go through a guarded wrapper
 * (ingestSettlementObject / ingestSettlementBytes), which converts
 * those throws into structured results.
 *
 * `storagePath` is the canonical businesses/{bid}/settlement-uploads/
 * {fileName} path recorded as provenance; on the Plan C path the raw
 * bytes are persisted there via the Admin SDK before this runs.
 */
async function ingestSettlementBytesInner(
  businessId: string,
  fileName: string,
  storagePath: string,
  pdfBytes: Uint8Array,
): Promise<IngestResult> {
  let output: FlowersParseOutput;
  try {
    const text = await extractPdfText(pdfBytes);
    output = parseFlowersDocument(text, {
      businessId,
      provenance: { kind: 'file', fileName, portal: 'flowers-idp-onbase', storagePath },
      storagePath,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('ingest: extract/parse failed', { objectName: storagePath, message });
    // Best effort only: if the queue write itself is what is broken in
    // the runtime, it must never mask the original parse error — the
    // returned exception is the caller's only reliable surface.
    try {
      await queueException(businessId, `Settlement ingest failed for ${fileName}: ${message}`, {
        storagePath,
        fileName,
        error: message,
      });
    } catch (qe) {
      logger.error('ingest: exception queue write failed (extract/parse path)', { objectName: storagePath, qe });
    }
    return { ok: false, exception: message };
  }

  const { record, registry } = output;
  const routeNumber = record.routeNumber;
  const weekEnding = record.weekEnding;
  const isMaster = output.docType === 'flowers_master_statement';
  const resolvedId = await resolveRouteDocId(businessId, routeNumber);
  // Masters have no route doc by design — their doc id IS the master
  // route number. Route records without a matching route doc are held:
  // registry + exception only, no orphan record under a phantom route.
  const routeDocId = resolvedId ?? (isMaster ? routeNumber : null);

  const problems: string[] = [];
  if (registry.discrepancy) problems.push(registry.discrepancy);
  if (!routeDocId) problems.push(`no route doc found for route number ${routeNumber}`);

  let recordPath: string | undefined;
  if (routeDocId) {
    if (output.docType === 'flowers_master_statement' || output.docType === 'flowers_distributor_statement') {
      recordPath = `businesses/${businessId}/routes/${routeDocId}/settlements/${weekEnding}`;
    } else if (output.docType === 'flowers_sbt_shrink') {
      recordPath = `businesses/${businessId}/routes/${routeDocId}/shrinkReports/${weekEnding}`;
    } else {
      recordPath = `businesses/${businessId}/routes/${routeDocId}/marginDetails/${weekEnding}`;
    }
  }

  const finalRegistry: IngestionRegistryEntry = clean({
    ...registry,
    routeId: routeDocId ?? undefined,
    recordPath,
    status: problems.length && registry.status === 'validated' ? 'needs_review' : registry.status,
    discrepancy: problems.join('; ') || undefined,
  });

  const batch = db().batch();
  if (recordPath) {
    batch.set(db().doc(recordPath), clean(record));
  }
  batch.set(db().collection(`businesses/${businessId}/ingestionRegistry`).doc(finalRegistry.id), finalRegistry);
  await batch.commit();

  // Margin Detail store rows also merge onto the settlement record for
  // the same route-week when it already exists (design: margin detail is
  // the settlement's store-row source). Standalone marginDetails record
  // above remains the provenance copy either way.
  if (output.docType === 'flowers_margin_detail' && routeDocId) {
    const settleRef = db().doc(`businesses/${businessId}/routes/${routeDocId}/settlements/${weekEnding}`);
    const settleSnap = await settleRef.get();
    if (settleSnap.exists) {
      await settleRef.set(
        {
          storeRows: clean(output.record.storeRows),
          itemRows: clean(output.record.itemRows),
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
    }
  }

  if (finalRegistry.status === 'needs_review') {
    await queueException(
      businessId,
      `Settlement ingest needs review: ${output.docType} route ${routeNumber} week ending ${weekEnding} — ${finalRegistry.discrepancy || 'validation discrepancy'}`,
      {
        storagePath,
        fileName,
        sourceType: output.docType,
        routeNumber,
        weekEnding,
        registryId: finalRegistry.id,
        discrepancy: finalRegistry.discrepancy || null,
      },
    );
  }

  // Statements carry the week's total product charged; margin detail and
  // shrink records have no single charged total, so it stays undefined.
  const totalCharged =
    output.docType === 'flowers_master_statement' ||
    output.docType === 'flowers_distributor_statement'
      ? output.record.computed.productCharged
      : undefined;

  logger.info('ingest: processed', {
    objectName: storagePath,
    docType: output.docType,
    routeNumber,
    weekEnding,
    status: finalRegistry.status,
    totalCharged: totalCharged ?? null,
    recordPath: recordPath || null,
  });
  return {
    ok: finalRegistry.status === 'validated',
    docType: output.docType,
    routeNumber,
    weekEnding,
    status: finalRegistry.status,
    totalCharged,
    recordPath,
    registryId: finalRegistry.id,
    // A non-validated result ALWAYS carries its reason: needs_review
    // carries the discrepancy; any other terminal status names itself,
    // so the uploader never has to render a bare "Processing failed."
    exception:
      finalRegistry.status === 'needs_review'
        ? finalRegistry.discrepancy || 'flagged for review (no discrepancy text recorded)'
        : finalRegistry.status === 'validated'
          ? undefined
          : `unexpected ingest status: ${finalRegistry.status}`,
  };
}

/**
 * Guarded ingest entry — the ONLY path callers use. Diagnosis
 * (2026-11-07): the live smoke test failed deterministically with zero
 * exception-queue entries, the signature of a throw in the post-parse
 * section (whose Firestore writes are also the queue's writes, so a
 * broken write layer leaves no trace anywhere the app can show). This
 * wrapper makes that class of failure VISIBLE: the error is queued on a
 * best-effort basis AND returned to the caller as the exception text,
 * instead of escaping as an opaque framework 'internal'.
 */
export async function ingestSettlementObject(
  bucket: string,
  objectName: string,
): Promise<IngestResult> {
  const parsed = parseUploadPath(objectName);
  if (!parsed) return { ok: false, exception: `not a settlement upload path: ${objectName}` };
  let buffer: Buffer;
  try {
    [buffer] = await admin.storage().bucket(bucket).file(objectName).download();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('ingest: storage download failed', { objectName, message });
    try {
      await queueException(
        parsed.businessId,
        `Settlement ingest failed for ${parsed.fileName}: ${message}`,
        { storagePath: objectName, fileName: parsed.fileName, error: message },
      );
    } catch (qe) {
      logger.error('ingest: exception queue write failed (download path)', { objectName, qe });
    }
    return { ok: false, exception: message };
  }
  return ingestSettlementBytes(parsed.businessId, parsed.fileName, objectName, new Uint8Array(buffer));
}

/**
 * Guarded bytes entry — the Plan C path. Same contract as
 * ingestSettlementObject: post-parse throws are queued best-effort AND
 * returned as structured results, never as opaque framework errors.
 */
export async function ingestSettlementBytes(
  businessId: string,
  fileName: string,
  storagePath: string,
  pdfBytes: Uint8Array,
): Promise<IngestResult> {
  try {
    return await ingestSettlementBytesInner(businessId, fileName, storagePath, pdfBytes);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('ingest: post-parse failure', { objectName: storagePath, message });
    try {
      await queueException(
        businessId,
        `Settlement ingest failed for ${fileName}: ${message}`,
        { storagePath, fileName, error: message },
      );
    } catch (qe) {
      logger.error('ingest: exception queue write failed (post-parse path)', { objectName: storagePath, qe });
    }
    return { ok: false, exception: `ingest failed after parse: ${message}` };
  }
}

/**
 * Storage trigger: fires on every finalized object in the default bucket;
 * only businesses/{bid}/settlement-uploads/*.pdf objects are processed.
 *
 * PLAN B (2026-11-07) — DEFINED BUT NOT DEPLOYED. `firebase deploy --only
 * functions` failed on this trigger in Actions runs 78–85 with "Can't
 * find the storage bucket region": deploying a gen2 storage trigger
 * makes firebase-tools resolve the bucket's region through the deploy
 * credential, and that lookup fails — pinning the bucket name above did
 * not change it, and the console/IAM route to investigate is closed by
 * the user's decision (no 2SV, no console). So src/index.ts deliberately
 * does NOT re-export this symbol, which keeps it out of the deployed
 * function surface; processing runs through the reprocessSettlement
 * callable instead (the SettlementUploader invokes it after each
 * upload). To re-enable the trigger later: (1) make the bucket-region
 * lookup succeed for the deploy credential (IAM/console work), (2) add
 * onSettlementUpload back to the export line in src/index.ts, (3)
 * redeploy and confirm the trigger is created.
 */
export const onSettlementUpload = onObjectFinalized({ bucket: STORAGE_BUCKET }, async (event: StorageEvent) => {
  const name = event.data.name || '';
  if (!parseUploadPath(name)) return;
  if (!/\.pdf$/i.test(name)) {
    logger.info('ingest: ignoring non-PDF settlement upload', { name });
    return;
  }
  try {
    await ingestSettlementObject(event.data.bucket, name);
  } catch (e) {
    // Never throw out of the trigger: a retry storm helps no one, and the
    // exception queue (written inside ingestSettlementObject for every
    // anticipated failure) is the surfacing mechanism.
    logger.error('ingest: unexpected failure', { name, e });
  }
});

/**
 * Owner-callable ingest entry point: reprocessSettlement({ storagePath })
 * -> IngestResult. Under Plan B this is THE processing path — the
 * SettlementUploader invokes it immediately after each PDF upload lands
 * in Storage — and it doubles as the manual reprocess for an
 * already-uploaded file (e.g. after a parser fix). Owner-only: the
 * caller's users/{uid} doc must carry role 'business_owner' and the
 * businessId embedded in the storage path.
 */
export const reprocessSettlement = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign-in required.');
  const storagePath = String(request.data?.storagePath || '');
  const parsed = parseUploadPath(storagePath);
  if (!parsed) throw new HttpsError('invalid-argument', 'storagePath must be a settlement upload path.');
  try {
    const userSnap = await db().collection('users').doc(request.auth.uid).get();
    const u = userSnap.exists ? (userSnap.data() as { role?: string; businessId?: string }) : null;
    if (!u || u.role !== 'business_owner' || u.businessId !== parsed.businessId) {
      throw new HttpsError('permission-denied', 'Only the business owner can reprocess settlement uploads.');
    }
    const bucket = admin.storage().bucket(STORAGE_BUCKET).name;
    return await ingestSettlementObject(bucket, storagePath);
  } catch (e) {
    // Deliberate HttpsErrors pass through with their message intact.
    // Anything else (e.g. the Firestore read above failing in the
    // function runtime) would otherwise reach the client as the bare
    // framework word 'internal' — rethrow WITH the real message so the
    // uploader can show what actually failed (diagnosis 2026-11-07).
    if (e instanceof HttpsError) throw e;
    const message = e instanceof Error ? e.message : String(e);
    logger.error('reprocessSettlement: unexpected failure', { storagePath, message });
    throw new HttpsError('internal', `Settlement processing failed: ${message}`);
  }
});

/**
 * Owner-callable direct ingest (Plan C, 2026-11-07):
 * ingestSettlementPdf({ filename, contentBase64 }) -> IngestResult.
 *
 * The SettlementUploader sends the PDF bytes in the request instead of
 * writing to Storage from the client — the bucket's client rules deny
 * that write (storage/unauthorized, verified live) and the deploy
 * credential cannot publish replacement rules (HTTP 403). The business
 * is derived from the caller's users/{uid} doc (same owner check as
 * reprocessSettlement); the client never names a business. The raw PDF
 * is persisted to the canonical settlement-uploads path via the Admin
 * SDK (best effort — server-side writes bypass client rules) so the
 * stored-file record and reprocessSettlement keep working; the
 * Firestore records written by the shared core are the deliverable and
 * do not depend on that write.
 */
export const ingestSettlementPdf = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign-in required.');
  const filename = String(request.data?.filename || '');
  const contentBase64 = String(request.data?.contentBase64 || '');
  try {
    const userSnap = await db().collection('users').doc(request.auth.uid).get();
    const u = userSnap.exists ? (userSnap.data() as { role?: string; businessId?: string }) : null;
    if (!u || u.role !== 'business_owner' || !u.businessId) {
      throw new HttpsError('permission-denied', 'Only the business owner can upload settlement PDFs.');
    }
    const businessId = u.businessId;

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!safeName || !/\.pdf$/i.test(safeName)) {
      throw new HttpsError('invalid-argument', 'filename must be a PDF file name.');
    }
    if (!contentBase64) {
      throw new HttpsError('invalid-argument', 'contentBase64 is required.');
    }
    // Reject on the encoded length before decoding: base64 inflates by
    // 4/3, so anything past this cannot decode under the cap.
    if (contentBase64.length > Math.ceil(MAX_SETTLEMENT_PDF_BYTES / 3) * 4 + 4) {
      throw new HttpsError(
        'invalid-argument',
        `PDF too large — the limit is ${Math.floor(MAX_SETTLEMENT_PDF_BYTES / (1024 * 1024))} MB.`,
      );
    }
    const buffer = Buffer.from(contentBase64.replace(/\s/g, ''), 'base64');
    if (buffer.length === 0 || buffer.length > MAX_SETTLEMENT_PDF_BYTES) {
      throw new HttpsError(
        'invalid-argument',
        `PDF too large — the limit is ${Math.floor(MAX_SETTLEMENT_PDF_BYTES / (1024 * 1024))} MB.`,
      );
    }
    if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new HttpsError('invalid-argument', 'That file is not a PDF.');
    }

    const storagePath = `businesses/${businessId}/${UPLOAD_PREFIX}/${safeName}`;

    // Best-effort raw-file persistence via the Admin SDK. A failure
    // here must not block the records — log it and continue.
    let storedPath: string | undefined;
    try {
      await admin.storage().bucket(STORAGE_BUCKET).file(storagePath).save(buffer, {
        contentType: 'application/pdf',
        resumable: false,
      });
      storedPath = storagePath;
    } catch (se) {
      logger.warn('ingestSettlementPdf: raw PDF persistence failed (continuing)', {
        storagePath,
        message: se instanceof Error ? se.message : String(se),
      });
    }

    const result = await ingestSettlementBytes(businessId, safeName, storagePath, new Uint8Array(buffer));
    return storedPath ? { ...result, storedPath } : result;
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    const message = e instanceof Error ? e.message : String(e);
    logger.error('ingestSettlementPdf: unexpected failure', { filename, message });
    throw new HttpsError('internal', `Settlement processing failed: ${message}`);
  }
});
