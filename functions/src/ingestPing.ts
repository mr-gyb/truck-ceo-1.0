/**
 * ingestPing — temporary diagnostic callable (added 2026-11-07).
 *
 * Exists to bisect the deployed ingestSettlementPdf's bare
 * functions/internal failure: this module imports ONLY
 * firebase-functions + firebase-admin (both proven live by the other
 * functions) and the settlements owner-check pattern — NO settlements
 * imports, no pdfjs, no parser stack. If ingestPing answers in the
 * app (see the "Connection test" button in
 * components/SettlementUploader.tsx) while ingestSettlementPdf still
 * returns a bare internal, the fault is inside the settlements
 * module's load or execution, not in callable plumbing, auth, or the
 * client. If ingestPing ALSO fails bare, the fault is platform-level
 * (instance startup / deployment), not ingest code.
 *
 * Owner-only, mirroring the settlements callables: the caller's
 * users/{uid} doc must carry role 'business_owner' and a businessId.
 * Returns { ok: true, ts } and nothing else. Remove once the ingest
 * pipeline is verified live.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';

const db = () => admin.firestore();

export const ingestPing = onCall(
  // Same resource block as the ingest callables (bisect build).
  { memory: '2GiB', timeoutSeconds: 300 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign-in required.');
    // Owner check isolated exactly like the settlements callables: a
    // failed users-doc read becomes a clean, stage-named HttpsError.
    let u: { role?: string; businessId?: string } | null = null;
    try {
      const userSnap = await db().collection('users').doc(request.auth.uid).get();
      u = userSnap.exists ? (userSnap.data() as { role?: string; businessId?: string }) : null;
    } catch (e) {
      throw new HttpsError(
        'internal',
        `ingestPing stage owner-check: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!u || u.role !== 'business_owner' || !u.businessId) {
      throw new HttpsError('permission-denied', 'Only the business owner can run the connection test.');
    }
    logger.info('ingestPing: ok', { uid: request.auth.uid });
    return { ok: true, ts: new Date().toISOString() };
  },
);
