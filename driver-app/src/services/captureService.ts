import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { db, functions, storage } from './firebaseConfig';
import type { CaptureType, DriverCapture } from '../types';
import {
  enqueueCapture,
  listQueuedCaptures,
  removeQueuedCapture,
  sweepStaleQueuedCaptures,
  type QueuedCapture,
} from './mediaQueue';

// Capture-first intake (spec, 2026-11-10): a capture is a photo (or a
// voice note) the driver shoots with one tap. The FILE lands in Storage
// under the existing driver-photos prefix (the path the bucket rules
// already allow members to write); the capture DOC lands at
// businesses/{bid}/routes/{rid}/captures/{captureId} with status
// 'pending'. The backend reader fills `extracted` + status later — the
// client NEVER invents extracted values, and the EOD derivation only
// trusts 'extracted'/'confirmed' reads.
//
// Upload + local-copy rules (2026-11-10, Chris): uploads are RESUMABLE
// with progress (a weak depot signal pauses instead of restarting);
// media lives ONLY in memory while uploading — nothing is written to
// the device on the happy path; if the upload or the doc write fails,
// the blob is staged in the IndexedDB outbox (mediaQueue) for retry
// and DELETED from the device the moment a retry confirms, and any
// staged copy older than 24h is swept on app start. The camera flow
// never routes through the device gallery (capture="environment"
// file input hands the app the photo directly).

const capturesCol = (businessId: string, routeId: string) =>
  collection(db!, 'businesses', businessId, 'routes', routeId, 'captures');

export interface CaptureUploadInput {
  businessId: string;
  routeId: string;
  date: string;
  type: CaptureType;
  file: Blob;
  contentType: string;
  storeId?: string | null;
  storeName?: string | null;
  driverId: string;
  driverName: string;
  /** 0..1 upload progress, for the capture button's staged label. */
  onProgress?: (fraction: number) => void;
}

/**
 * Upload one capture (resumable) and create its doc. Returns the
 * created capture (status 'pending' — being read). Throws on failure;
 * the caller stages the blob in the retry outbox (submitCapture does
 * this for the UI — see below).
 */
export async function createCapture(input: CaptureUploadInput, existingId?: string): Promise<DriverCapture> {
  if (!db || !storage) throw new Error('App is not connected to Firebase yet.');
  const captureRef = existingId
    ? doc(capturesCol(input.businessId, input.routeId), existingId)
    : doc(capturesCol(input.businessId, input.routeId));
  const ext = input.type === 'voice' ? 'audio' : 'jpg';
  const storagePath = `driver-photos/${input.businessId}/${input.routeId}/${input.date}/${captureRef.id}_${input.type}.${ext}`;
  const fileRef = ref(storage, storagePath);
  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(fileRef, input.file, { contentType: input.contentType });
    task.on(
      'state_changed',
      (snap) => {
        if (snap.totalBytes > 0) input.onProgress?.(snap.bytesTransferred / snap.totalBytes);
      },
      reject,
      () => resolve(),
    );
  });
  const downloadUrl = await getDownloadURL(fileRef).catch(() => null);
  const capture: DriverCapture = {
    id: captureRef.id,
    type: input.type,
    date: input.date,
    storagePath,
    downloadUrl,
    storeId: input.storeId ?? null,
    storeName: input.storeName ?? null,
    status: 'pending',
    extracted: null,
    attentionNote: null,
    driverId: input.driverId,
    driverName: input.driverName,
  };
  const { id: _id, ...docData } = capture;
  await setDoc(captureRef, { ...docData, createdAt: serverTimestamp() });
  // Ask the backend reader to read this capture now (fire-and-forget):
  // the callable fills `extracted` + status on the doc, and the day
  // views re-read captures on refresh. If the call fails for any
  // reason, the capture simply stays 'pending' ("Being read…") — the
  // upload itself already succeeded, and no value is ever invented
  // client-side to cover a failed read.
  if (functions) {
    void httpsCallable(
      functions,
      'processCapture',
    )({ businessId: input.businessId, routeId: input.routeId, captureId: captureRef.id }).catch(
      () => {},
    );
  }
  return capture;
}

/**
 * The UI's entry point: upload now; on ANY failure, stage the blob in
 * the on-device outbox for automatic retry so the photo is never lost
 * to a dead signal — and rethrow so the button shows the honest state
 * ("Saved on this phone — will send when signal returns"). The local
 * copy is deleted by retryPendingCaptures() the moment a retry lands,
 * or by the 24h on-start sweep.
 */
export async function submitCapture(input: CaptureUploadInput): Promise<DriverCapture> {
  // Mint the capture id up front so the first attempt and every retry
  // write the same Storage path and the same doc — never a duplicate.
  const captureId = doc(capturesCol(input.businessId, input.routeId)).id;
  try {
    return await createCapture(input, captureId);
  } catch (err) {
    await enqueueCapture({
      captureId,
      createdAtMs: Date.now(),
      blob: input.file,
      contentType: input.contentType,
      businessId: input.businessId,
      routeId: input.routeId,
      date: input.date,
      type: input.type,
      storeId: input.storeId ?? null,
      storeName: input.storeName ?? null,
      driverId: input.driverId,
      driverName: input.driverName,
    });
    throw err;
  }
}

let housekeepingStarted = false;

/**
 * On-start media housekeeping (called once from the day provider):
 * sweep staged copies older than 24h, then retry whatever is left.
 * Also re-runs on the browser's 'online' event. Returns how many
 * queued captures were sent.
 */
export async function retryPendingCaptures(): Promise<number> {
  await sweepStaleQueuedCaptures().catch(() => 0);
  const queued: QueuedCapture[] = await listQueuedCaptures();
  let sent = 0;
  for (const item of queued) {
    try {
      await createCapture(
        {
          businessId: item.businessId,
          routeId: item.routeId,
          date: item.date,
          type: item.type,
          file: item.blob,
          contentType: item.contentType,
          storeId: item.storeId,
          storeName: item.storeName,
          driverId: item.driverId,
          driverName: item.driverName,
        },
        item.captureId,
      );
      // Confirmed uploaded + doc written: AUTO-DELETE the local copy.
      await removeQueuedCapture(item.captureId);
      sent += 1;
    } catch {
      /* still no signal — the copy stays queued for the next attempt */
    }
  }
  return sent;
}

export function startMediaHousekeeping(onSent?: () => void): void {
  if (housekeepingStarted) return;
  housekeepingStarted = true;
  const run = () => {
    void retryPendingCaptures().then((sent) => {
      if (sent > 0) onSent?.();
    });
  };
  run();
  window.addEventListener('online', run);
}

/** All captures for one route-day, oldest first (the day's timeline). */
export async function listCapturesForDay(
  businessId: string,
  routeId: string,
  date: string,
): Promise<DriverCapture[]> {
  if (!db) return [];
  const snap = await getDocs(
    query(capturesCol(businessId, routeId), where('date', '==', date)),
  );
  const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DriverCapture, 'id'>) }));
  const ts = (c: DriverCapture) => {
    const t = c.createdAt as { seconds?: number } | undefined;
    return t?.seconds ?? 0;
  };
  return list.sort((a, b) => ts(a) - ts(b));
}

/** Driver tap-confirm: an extracted read becomes 'confirmed'. */
export async function confirmCapture(
  businessId: string,
  routeId: string,
  captureId: string,
): Promise<void> {
  if (!db) throw new Error('App is not connected to Firebase yet.');
  await updateDoc(doc(capturesCol(businessId, routeId), captureId), { status: 'confirmed' });
}
