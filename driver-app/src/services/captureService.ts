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
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { db, functions, storage } from './firebaseConfig';
import type { CaptureType, DriverCapture } from '../types';

// Capture-first intake (spec, 2026-11-10): a capture is a photo (or a
// voice note) the driver shoots with one tap. The FILE lands in Storage
// under the existing driver-photos prefix (the path the bucket rules
// already allow members to write); the capture DOC lands at
// businesses/{bid}/routes/{rid}/captures/{captureId} with status
// 'pending'. The backend reader fills `extracted` + status later — the
// client NEVER invents extracted values, and the EOD derivation only
// trusts 'extracted'/'confirmed' reads.

const capturesCol = (businessId: string, routeId: string) =>
  collection(db!, 'businesses', businessId, 'routes', routeId, 'captures');

/**
 * Upload one capture and create its doc. Returns the created capture
 * (status 'pending' — being read). Throws on failure so the UI can show
 * an honest retry state instead of pretending the capture landed.
 */
export async function createCapture(input: {
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
}): Promise<DriverCapture> {
  if (!db || !storage) throw new Error('App is not connected to Firebase yet.');
  const captureRef = doc(capturesCol(input.businessId, input.routeId));
  const ext = input.type === 'voice' ? 'audio' : 'jpg';
  const storagePath = `driver-photos/${input.businessId}/${input.routeId}/${input.date}/${captureRef.id}_${input.type}.${ext}`;
  const fileRef = ref(storage, storagePath);
  await uploadBytes(fileRef, input.file, { contentType: input.contentType });
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
