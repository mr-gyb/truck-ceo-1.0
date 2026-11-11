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
  type DriverMembership,
  type DriverScore,
  type EodReport,
  type InviteCode,
  type Route,
  type RouteGuideData,
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
      const route = toRoute({ id: snap.id, ...(snap.data() as object) } as Parameters<typeof toRoute>[0]);
      route.businessId = businessId;
      routes.push(route);
    }
  }
  return routes;
}

/**
 * Fetch every route a driver holds a membership in (Chris's directive,
 * 2026-11-10: a driver toggles between ALL routes they were invited to).
 * Memberships are the many-to-many source of truth; each route is read
 * from its OWN business, because memberships can span businesses.
 * Falls back to (businessId, routeIds) for profiles written before
 * memberships existed.
 */
export async function getMembershipRoutes(profile: {
  businessId: string;
  routeIds: string[];
  driverMemberships?: DriverMembership[];
}): Promise<Route[]> {
  if (!db) return [];
  const pairs: Array<{ businessId: string; routeId: string }> = [];
  const seen = new Set<string>();
  const add = (businessId: string, routeId: string) => {
    const key = `${businessId}/${routeId}`;
    if (businessId && routeId && !seen.has(key)) {
      seen.add(key);
      pairs.push({ businessId, routeId });
    }
  };
  for (const m of profile.driverMemberships ?? []) add(m.businessId, m.routeId);
  for (const rid of profile.routeIds ?? []) add(profile.businessId, rid);
  const routes: Route[] = [];
  for (const p of pairs) {
    const snap = await getDoc(doc(db, 'businesses', p.businessId, 'routes', p.routeId));
    if (snap.exists()) {
      const route = toRoute({ id: snap.id, ...(snap.data() as object) } as Parameters<typeof toRoute>[0]);
      route.businessId = p.businessId;
      routes.push(route);
    }
  }
  return routes;
}

/**
 * Latest generated guide book + route card for a route (written by the
 * backend on settlement ingest). Null until a settlement has been
 * ingested for the route — an honest "no guide yet", never a mock.
 */
export async function getLatestRouteGuide(
  businessId: string,
  routeId: string,
): Promise<RouteGuideData | null> {
  if (!db) return null;
  try {
    const snap = await getDocs(
      collection(db, 'businesses', businessId, 'routes', routeId, 'guides'),
    );
    if (snap.empty) return null;
    const docs = snap.docs
      .map((d) => d.data() as RouteGuideData)
      .sort((a, b) => b.weekEnding.localeCompare(a.weekEnding));
    return docs[0] ?? null;
  } catch (err) {
    console.warn('Route guide read failed; showing empty state.', err);
    return null;
  }
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
