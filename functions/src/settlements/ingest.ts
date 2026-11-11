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
import type { FlowersParseOutput } from './index';
import type { IngestionRegistryEntry, SettlementRecord } from './types';
import { buildRouteGuide, type RouteRegistryForGuide } from './guide';

/**
 * Lazy parser stack (bisect build, 2026-11-07): the deployed
 * ingestSettlementPdf failed the live smoke test with a BARE
 * functions/internal — no stage name — even though every handler path
 * converts throws into stage-named HttpsErrors. That signature means
 * the failure happens BEFORE the handler runs: module load or
 * instance startup. The heavy end of this module's import graph is
 * the parser stack (./pdfText pulls pdfjs-dist; ./index pulls
 * ./flowersIdp), so those imports are no longer static: they load via
 * dynamic import() inside the ingest path as their own stage
 * ('load'), and a load failure surfaces as HttpsError('internal',
 * 'ingest stage load: <real message>') from the callables instead of
 * a dead instance. firebase-functions + firebase-admin stay static —
 * the other live functions prove those load.
 *
 * Module-scope audit at the same time: types.ts / settlements
 * index.ts carry declarations only; flowersIdp.ts adds only literal
 * constants (a regex and two label arrays); pdfText.ts adds only
 * numeric constants — the pdfjs import itself was the only executable
 * load-time risk there. This module's own scope is literal constants,
 * the db() arrow, and the firebase-functions builder definitions
 * (onCall / onObjectFinalized), which are declaration-class.
 */
interface ParserStack {
  pdfText: typeof import('./pdfText');
  index: typeof import('./index');
}

let parserStackPromise: Promise<ParserStack> | null = null;

function loadParserStack(): Promise<ParserStack> {
  if (!parserStackPromise) {
    parserStackPromise = (async () => {
      const [pdfText, index] = await Promise.all([import('./pdfText'), import('./index')]);
      return { pdfText, index };
    })();
    // A rejected load must not poison the instance for its lifetime:
    // clear the cache so a later call retries the import.
    parserStackPromise.catch(() => {
      parserStackPromise = null;
    });
  }
  return parserStackPromise;
}

/** Marker prefix for load-stage failures. The guarded bytes wrapper
 *  passes these through verbatim, and the callables convert a result
 *  carrying one into a thrown HttpsError with the same message. */
const LOAD_STAGE_PREFIX = 'ingest stage load:';

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

/**
 * Deep-sanitize a value for Firestore: the Admin SDK REJECTS any
 * document containing `undefined` ("Cannot use 'undefined' as a
 * Firestore value") and throws at set()/add()/commit() time. Parser
 * output is riddled with explicit undefineds — measured 2026-11-07:
 * 115 undefined paths across the 33 IDP fixtures (Master W43 alone:
 * record.routeLabelPrinted, registry.routeNumber, registry.discrepancy;
 * margin-detail item rows carry undefined quantity/amount per row).
 * Every Firestore write in this module goes through here first.
 *
 * Rules: undefined -> null, recursively, including inside arrays and
 * nested maps (an undefined array element becomes a null element —
 * Firestore has no "hole" concept). Everything else passes through
 * unchanged: strings/numbers/booleans/null as-is (NaN and Infinity are
 * valid Firestore doubles), and class instances (FieldValue sentinels,
 * Timestamps, Dates) are returned untouched — only PLAIN objects and
 * arrays are rebuilt. This replaces the old JSON round-trip `clean()`,
 * which dropped undefined keys silently, would have thrown on BigInt /
 * circular input, and was only applied to SOME writes.
 */
export function sanitizeForFirestore<T>(value: T): T {
  if (value === undefined) return null as unknown as T;
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeForFirestore(v)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    if (value instanceof Date) return value;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value; // sentinel/class instance
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeForFirestore(v);
    }
    return out as unknown as T;
  }
  return value;
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

/**
 * (Re)generate routes/{rid}/guides/{weekEnding} from the route's
 * settlement record for that week + the route doc's store registry.
 * No settlement record yet (e.g. margin detail arrived first) = no
 * guide yet: the guide is generated FROM the settlement, and the
 * statement's own ingest — or its margin merge — will call this again.
 */
async function regenerateRouteGuide(
  businessId: string,
  routeDocId: string,
  weekEnding: string,
): Promise<void> {
  const routeRef = db().doc(`businesses/${businessId}/routes/${routeDocId}`);
  const settleRef = routeRef.collection('settlements').doc(weekEnding);
  const [routeSnap, settleSnap] = await Promise.all([routeRef.get(), settleRef.get()]);
  if (!settleSnap.exists) return;
  const settlement = settleSnap.data() as SettlementRecord;
  const route = (routeSnap.exists ? routeSnap.data() : {}) as RouteRegistryForGuide;
  const guide = buildRouteGuide({
    route,
    settlement,
    sourceSettlementPath: settleRef.path,
    generatedAt: new Date().toISOString(),
  });
  await routeRef
    .collection('guides')
    .doc(weekEnding)
    .set(sanitizeForFirestore(guide), { merge: true });
}

/** Queue an ingest exception to the existing GYBs pickup surfaces. */
async function queueException(
  businessId: string,
  summary: string,
  context: Record<string, unknown>,
): Promise<void> {
  const now = admin.firestore.FieldValue.serverTimestamp();
  // Sanitized like every other write in this module: a caller-supplied
  // context value that happens to be undefined must not make the
  // exception queue itself the thing that throws. The serverTimestamp
  // sentinel is a class instance and passes the sanitizer untouched.
  await db().collection(`businesses/${businessId}/dataFeedRequests`).add(
    sanitizeForFirestore({
      platform: 'Flowers IDP settlement intake',
      kind: 'settlement_ingest_exception',
      status: 'requested',
      summary,
      ...context,
      createdAt: now,
      via: 'settlement-ingest',
    }),
  );
  await db().collection('agentInbox').add(
    sanitizeForFirestore({
      type: 'settlement_ingest_exception',
      summary,
      businessId,
      ...context,
      status: 'open',
      createdAt: now,
    }),
  );
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
  let stage = 'load';
  try {
    const stack = await loadParserStack();
    stage = 'extract';
    const text = await stack.pdfText.extractPdfText(pdfBytes);
    stage = 'parse';
    output = stack.index.parseFlowersDocument(text, {
      businessId,
      provenance: { kind: 'file', fileName, portal: 'flowers-idp-onbase', storagePath },
      storagePath,
    });
  } catch (e) {
    if (stage === 'load') {
      // Module-load failures are a distinct failure class (the bisect
      // target): rethrow with the stage marker instead of returning a
      // result, so the callables convert them to a thrown
      // HttpsError('internal', 'ingest stage load: ...'). The guarded
      // wrappers pass the marked message through verbatim.
      throw new Error(`${LOAD_STAGE_PREFIX} ${e instanceof Error ? e.message : String(e)}`);
    }
    const message = `ingest stage ${stage}: ${e instanceof Error ? e.message : String(e)}`;
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

  // Post-parse stage: every throw from here out is rethrown with its
  // stage name attached, so the guarded wrapper (and ultimately the
  // uploader) reports WHERE the ingest died, not just that it died.
  stage = 'resolve';
  try {
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

  const finalRegistry: IngestionRegistryEntry = sanitizeForFirestore({
    ...registry,
    routeId: routeDocId ?? undefined,
    recordPath,
    status: problems.length && registry.status === 'validated' ? 'needs_review' : registry.status,
    discrepancy: problems.join('; ') || undefined,
  });

  stage = 'write';
  const batch = db().batch();
  if (recordPath) {
    batch.set(db().doc(recordPath), sanitizeForFirestore(record));
  }
  batch.set(db().collection(`businesses/${businessId}/ingestionRegistry`).doc(finalRegistry.id), finalRegistry);
  await batch.commit();

  // Margin Detail store rows also merge onto the settlement record for
  // the same route-week when it already exists (design: margin detail is
  // the settlement's store-row source). Standalone marginDetails record
  // above remains the provenance copy either way.
  if (output.docType === 'flowers_margin_detail' && routeDocId) {
    stage = 'margin-merge';
    const settleRef = db().doc(`businesses/${businessId}/routes/${routeDocId}/settlements/${weekEnding}`);
    const settleSnap = await settleRef.get();
    if (settleSnap.exists) {
      await settleRef.set(
        sanitizeForFirestore({
          storeRows: output.record.storeRows,
          itemRows: output.record.itemRows,
          updatedAt: new Date().toISOString(),
        }),
        { merge: true },
      );
    }
  }

  // Guide generation (Chris's directive, 2026-11-10): a landed
  // settlement (re)generates the route's driver guide book + route card
  // at routes/{rid}/guides/{weekEnding}, from the settlement's store
  // rows + the route's store registry. Runs AFTER the margin merge so
  // the guide sees the merged store rows. Best-effort by design: a
  // guide failure is logged and never fails the ingest itself — the
  // settlement record is the deliverable; the guide regenerates on the
  // next ingest for that route-week.
  if (
    routeDocId &&
    (output.docType === 'flowers_master_statement' ||
      output.docType === 'flowers_distributor_statement' ||
      output.docType === 'flowers_margin_detail')
  ) {
    stage = 'guide';
    try {
      await regenerateRouteGuide(businessId, routeDocId, weekEnding);
    } catch (e) {
      logger.warn('ingest: guide generation failed (settlement still landed)', {
        businessId,
        routeDocId,
        weekEnding,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (finalRegistry.status === 'needs_review') {
    stage = 'review-queue';
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
  } catch (e) {
    // Attach the stage and let the guarded wrapper convert it to a
    // structured result — the message the uploader prints now names
    // the stage ('resolve' | 'write' | 'margin-merge' | 'review-queue')
    // instead of collapsing to a bare framework 'internal'.
    throw new Error(`ingest stage ${stage}: ${e instanceof Error ? e.message : String(e)}`);
  }
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
    return {
      ok: false,
      // Load-stage failures keep their exact marker text (the
      // callables key on it); everything else keeps the wrapper's
      // post-parse framing.
      exception: message.startsWith(LOAD_STAGE_PREFIX)
        ? message
        : `ingest failed after parse: ${message}`,
    };
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
export const reprocessSettlement = onCall(
  // Explicit resources: the gen2 default (256MiB, 60s) starves pdfjs —
  // a CPU/memory-killed instance surfaces to the client as a bare
  // functions/internal with no message and no catch block ever running.
  // Raised to 2GiB in the bisect build (2026-11-07).
  { memory: '2GiB', timeoutSeconds: 300 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign-in required.');
    const storagePath = String(request.data?.storagePath || '');
    const parsed = parseUploadPath(storagePath);
    if (!parsed) throw new HttpsError('invalid-argument', 'storagePath must be a settlement upload path.');
    let stage = 'owner-check';
    try {
      // Owner check isolated: a failure of the users-doc read (or junk
      // in its fields) becomes a clean, stage-named HttpsError here,
      // never an opaque framework error.
      let u: { role?: string; businessId?: string } | null = null;
      try {
        const userSnap = await db().collection('users').doc(request.auth.uid).get();
        u = userSnap.exists ? (userSnap.data() as { role?: string; businessId?: string }) : null;
      } catch (e) {
        throw new HttpsError(
          'internal',
          `ingest stage owner-check: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      if (!u || u.role !== 'business_owner' || u.businessId !== parsed.businessId) {
        throw new HttpsError('permission-denied', 'Only the business owner can reprocess settlement uploads.');
      }
      stage = 'ingest';
      const bucket = admin.storage().bucket(STORAGE_BUCKET).name;
      const result = await ingestSettlementObject(bucket, storagePath);
      // Load-stage failures become a THROWN HttpsError carrying the
      // real load error, per the bisect design — not a returned
      // result the client renders as a processing failure.
      if (!result.ok && result.exception?.startsWith(LOAD_STAGE_PREFIX)) {
        throw new HttpsError('internal', result.exception);
      }
      return result;
    } catch (e) {
      // Deliberate HttpsErrors pass through with their message intact.
      // Anything else would otherwise reach the client as the bare
      // framework word 'internal' — rethrow WITH the stage and the real
      // message so the uploader can show what actually failed.
      if (e instanceof HttpsError) throw e;
      const message = e instanceof Error ? e.message : String(e);
      logger.error('reprocessSettlement: unexpected failure', { storagePath, stage, message });
      throw new HttpsError('internal', `ingest stage ${stage}: ${message}`);
    }
  },
);

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
export const ingestSettlementPdf = onCall(
  // Explicit resources: the gen2 default (256MiB, 60s) starves pdfjs —
  // a CPU/memory-killed instance surfaces to the client as a bare
  // functions/internal with no message and no catch block ever running
  // (the live smoke-test signature: generic internal, zero queue rows).
  // Raised to 2GiB in the bisect build (2026-11-07).
  { memory: '2GiB', timeoutSeconds: 300 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign-in required.');
    const filename = String(request.data?.filename || '');
    const contentBase64 = String(request.data?.contentBase64 || '');
    // Stage breadcrumbs: any unexpected throw leaves as
    // HttpsError('internal', 'ingest stage <name>: <real message>') so
    // the uploader prints the actual cause instead of bare 'internal'.
    let stage = 'owner-check';
    try {
      // Owner check isolated: a failure of the users-doc read (or junk
      // in its fields) becomes a clean, stage-named HttpsError here,
      // never an opaque framework error.
      let u: { role?: string; businessId?: string } | null = null;
      try {
        const userSnap = await db().collection('users').doc(request.auth.uid).get();
        u = userSnap.exists ? (userSnap.data() as { role?: string; businessId?: string }) : null;
      } catch (e) {
        throw new HttpsError(
          'internal',
          `ingest stage owner-check: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      if (!u || u.role !== 'business_owner' || !u.businessId) {
        throw new HttpsError('permission-denied', 'Only the business owner can upload settlement PDFs.');
      }
      const businessId = u.businessId;

      stage = 'decode';
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

      // Best-effort raw-file persistence via the Admin SDK. EVERY step
      // — SDK handle, bucket resolution, file ref, save — sits inside
      // this try, and a failure here must NEVER block or fail the
      // records: log it and continue to processing regardless.
      stage = 'store';
      let storedPath: string | undefined;
      try {
        const bucket = admin.storage().bucket(STORAGE_BUCKET);
        const fileRef = bucket.file(storagePath);
        await fileRef.save(buffer, {
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

      stage = 'ingest';
      const result = await ingestSettlementBytes(businessId, safeName, storagePath, new Uint8Array(buffer));
      // Load-stage failures become a THROWN HttpsError carrying the
      // real load error, per the bisect design — not a returned
      // result the client renders as a processing failure.
      if (!result.ok && result.exception?.startsWith(LOAD_STAGE_PREFIX)) {
        throw new HttpsError('internal', result.exception);
      }
      return storedPath ? { ...result, storedPath } : result;
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      const message = e instanceof Error ? e.message : String(e);
      logger.error('ingestSettlementPdf: unexpected failure', { filename, stage, message });
      throw new HttpsError('internal', `ingest stage ${stage}: ${message}`);
    }
  },
);
