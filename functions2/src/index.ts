/**
 * diagPing — isolated diagnostics callable (added 2026-11-07).
 *
 * This codebase (functions2/, codebase "diag") is DELIBERATELY isolated
 * from the main functions codebase: it imports ONLY firebase-functions
 * and firebase-admin, constructs nothing at module scope beyond a
 * guarded initializeApp(), and reads no process.env while loading.
 *
 * Why: every callable in the main codebase — including the
 * featherweight ingestPing, which imports no settlements code — returns
 * a bare functions/internal in production, yet all of them share
 * functions/src/index.ts as their entry point, and that module's scope
 * runs admin.initializeApp(), env-derived config, a module-scope
 * `new SecretManagerServiceClient()`, and the whole provider graph
 * (@google/genai, openai, secret-manager). If diagPing answers from
 * this clean graph while the main codebase's callables still fail
 * bare, the fault is proven to live in that shared module scope, not
 * in callable plumbing, auth, Firestore, or the platform.
 *
 * Owner-only, mirroring ingestPing / the settlements callables: the
 * caller's users/{uid} doc must carry role 'business_owner' and a
 * businessId; failures surface as stage-named HttpsErrors, never a
 * bare internal from this code. Returns { ok: true, ts, codebase }.
 * Remove once the main codebase is repaired and verified live.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Guarded init — unlike the main codebase's bare top-level
// admin.initializeApp(), this can never throw a duplicate-app error
// at module scope, and nothing else is constructed while loading.
if (!getApps().length) initializeApp();

const db = () => getFirestore();

export const diagPing = onCall(
  { memory: "512MiB", timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign-in required.");
    // Owner check isolated exactly like the settlements callables: a
    // failed users-doc read becomes a clean, stage-named HttpsError.
    let u: { role?: string; businessId?: string } | null = null;
    try {
      const userSnap = await db().collection("users").doc(request.auth.uid).get();
      u = userSnap.exists ? (userSnap.data() as { role?: string; businessId?: string }) : null;
    } catch (e) {
      throw new HttpsError(
        "internal",
        `diagPing stage owner-check: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!u || u.role !== "business_owner" || !u.businessId) {
      throw new HttpsError("permission-denied", "Only the business owner can run the connection test.");
    }
    logger.info("diagPing: ok", { uid: request.auth.uid });
    return { ok: true, ts: new Date().toISOString(), codebase: "diag" };
  },
);
