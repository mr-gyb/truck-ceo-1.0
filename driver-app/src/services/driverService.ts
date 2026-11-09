import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from './firebaseConfig';
import {
  toRoute,
  type DriverScore,
  type EodReport,
  type InviteCode,
  type Route,
} from '../types';

// Reads/writes against the SAME Firestore project and collections the
// TruckCEO owner app uses (businesses/{bid}/routes/{rid}/...). Nothing here
// fabricates data: missing documents come back as null / empty arrays and
// the screens render honest empty states.

/** Fetch the routes a driver is assigned to (profile.routeIds). */
export async function getAssignedRoutes(
  businessId: string,
  routeIds: string[],
): Promise<Route[]> {
  if (!db || !businessId || routeIds.length === 0) return [];
  const routes: Route[] = [];
  for (const rid of routeIds) {
    const snap = await getDoc(doc(db, 'businesses', businessId, 'routes', rid));
    if (snap.exists()) {
      routes.push(toRoute({ id: snap.id, ...(snap.data() as object) } as Parameters<typeof toRoute>[0]));
    }
  }
  return routes;
}

/** Look up an invite code (owner app stores them at inviteCodes/{CODE}). */
export async function lookupInviteCode(code: string): Promise<InviteCode | null> {
  if (!db) return null;
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;
  const snap = await getDoc(doc(db, 'inviteCodes', normalized));
  if (!snap.exists()) return null;
  return { code: normalized, ...(snap.data() as Omit<InviteCode, 'code'>) };
}

/** Today's EOD doc id is the date itself in the owner app. */
export async function getEodReport(
  businessId: string,
  routeId: string,
  date: string,
): Promise<EodReport | null> {
  if (!db) return null;
  const snap = await getDoc(doc(db, 'businesses', businessId, 'routes', routeId, 'eod', date));
  if (!snap.exists()) return null;
  return snap.data() as EodReport;
}

/** Submit the EOD report in the owner app's exact shape. */
export async function submitEodReport(
  businessId: string,
  routeId: string,
  report: EodReport,
  submittedBy: string,
  driverName: string,
): Promise<void> {
  if (!db) throw new Error('App is not connected to Firebase yet.');
  await setDoc(doc(db, 'businesses', businessId, 'routes', routeId, 'eod', report.date), {
    ...report,
    submittedAt: serverTimestamp(),
    submittedBy,
    driverName,
  });
}

/**
 * Latest weekly Driver Score. The weekly computation does not exist yet, so
 * this returns null in practice and the Score screen shows its empty state.
 *
 * NEVER throws (2026-11-08 fix): the driverScores subcollection had no
 * Firestore rules match, so this read is permission-denied — and the old
 * version let the rejection escape, leaving the Score tab on its loading
 * skeleton forever. Any failure reads as "no score yet".
 */
export async function getLatestDriverScore(
  businessId: string,
  routeId: string,
): Promise<DriverScore | null> {
  if (!db) return null;
  try {
    const snap = await getDocs(
      collection(db, 'businesses', businessId, 'routes', routeId, 'driverScores'),
    );
    if (snap.empty) return null;
    const docs = snap.docs
      .map((d) => d.data() as DriverScore)
      .sort((a, b) => b.weekOf.localeCompare(a.weekOf));
    return docs[0] ?? null;
  } catch (err) {
    console.warn('Driver score read failed; showing empty state.', err);
    return null;
  }
}
