// The ONLY place capture media is ever persisted on the device: an
// IndexedDB outbox for uploads that FAILED (weak depot signal). It
// exists so a failed upload is not lost — and it is aggressively
// cleaned:
//   - a record is DELETED the moment its upload + capture-doc write
//     succeed (the normal path stages nothing here at all: the record
//     is written only on failure);
//   - on app start, records older than 24h are swept (deleted unread);
//   - successful captures are never written here, and no other part of
//     the app stores media in IndexedDB or web storage.
// The capture id is minted when the record is created and reused on
// retry, so a retry overwrites the same Storage path and the same
// capture doc — never a duplicate.

import type { CaptureType } from '../types';
import { isStaleLocalMedia } from './mediaPipeline';

export interface QueuedCapture {
  captureId: string;
  createdAtMs: number;
  blob: Blob;
  contentType: string;
  businessId: string;
  routeId: string;
  date: string;
  type: CaptureType;
  storeId: string | null;
  storeName: string | null;
  driverId: string;
  driverName: string;
}

const DB_NAME = 'route-runner-media';
const STORE = 'pending-uploads';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'captureId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => {
          db.close();
          resolve(req.result);
        };
        req.onerror = () => {
          db.close();
          reject(req.error);
        };
      }),
  );
}

/** Stage a failed upload for retry. Best-effort: if IndexedDB itself is
 * unavailable the caller still shows the retry state; nothing throws. */
export async function enqueueCapture(record: QueuedCapture): Promise<void> {
  try {
    await tx('readwrite', (s) => s.put(record));
  } catch {
    /* storage unavailable (private mode etc.) — the in-UI retry remains */
  }
}

export async function listQueuedCaptures(): Promise<QueuedCapture[]> {
  try {
    return (await tx<QueuedCapture[]>('readonly', (s) => s.getAll())) ?? [];
  } catch {
    return [];
  }
}

/** AUTO-DELETE: remove a local copy (after confirmed upload, or sweep). */
export async function removeQueuedCapture(captureId: string): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(captureId));
  } catch {
    /* already gone */
  }
}

/** On-start sweep: delete queued copies older than the 24h TTL.
 * Returns how many were swept. */
export async function sweepStaleQueuedCaptures(nowMs: number = Date.now()): Promise<number> {
  const all = await listQueuedCaptures();
  const stale = all.filter((r) => isStaleLocalMedia(r.createdAtMs, nowMs));
  await Promise.all(stale.map((r) => removeQueuedCapture(r.captureId)));
  return stale.length;
}
