// Driver app types. These mirror the TruckCEO owner app's data model
// (types.ts in truck-ceo-1.0: Store, RouteTerritory, InviteCode, DriverEod,
// RoutePhoto) so both apps read the same Firestore documents. Fields the
// owner app does not have yet are optional/nullable ON PURPOSE: per-store
// delivery days and target times are UNCONFIRMED in our records, and nothing
// here may be populated with invented values.

export interface Store {
  id: string;
  name: string;
  address: string;
  /** Supplier store/customer number — settlements join on this. */
  storeNumber?: string;
  /**
   * Whether this stop requires a planogram photo. DEFAULT OFF: the
   * planogram prompt renders only when this is explicitly true on the
   * store record (set per store once confirmed). Delivery and stales
   * photos are prompted at every stop regardless.
   */
  planogramPhotoRequired?: boolean;
}

/** A store as a stop on today's run. */
export interface Stop extends Store {
  /** Run order within the route. Null until a route's sequence is confirmed. */
  sequence: number | null;
  /**
   * Target arrival time, "HH:mm" 24h. Null = not set. There is NO confirmed
   * source for per-store target times yet — the UI must render the null case
   * as "Target time not set yet", never a guessed time.
   */
  targetArrivalTime: string | null;
  /**
   * Days this stop is served, e.g. ['Mon','Wed','Fri']. Null = unconfirmed.
   */
  deliveryDays: string[] | null;
}

export interface Route {
  id: string;
  name: string;
  /** Bakery route number, e.g. "7823". */
  routeNumber?: string;
  supplier?: 'flowers' | 'bimbo';
  settlementAccount?: string;
  vendorId?: string;
  assignedDriverId?: string | null;
  assignedTruckId?: string | null;
  stops: Stop[];
}

/** Map a stored RouteTerritory-shaped doc into the driver app's Route. */
export function toRoute(doc: {
  id: string;
  name: string;
  routeNumber?: string;
  supplier?: 'flowers' | 'bimbo';
  settlementAccount?: string;
  vendorId?: string;
  assignedDriverId?: string | null;
  assignedTruckId?: string | null;
  stores?: Array<
    Store & {
      sequence?: number | null;
      targetArrivalTime?: string | null;
      deliveryDays?: string[] | null;
    }
  >;
}): Route {
  const stops = [...(doc.stores ?? [])].map((s) => ({
    ...s,
    sequence: s.sequence ?? null,
    targetArrivalTime: s.targetArrivalTime ?? null,
    deliveryDays: s.deliveryDays ?? null,
  }));
  // Confirmed sequences first, in order; unsequenced stops keep stored order.
  stops.sort((a, b) => {
    if (a.sequence == null && b.sequence == null) return 0;
    if (a.sequence == null) return 1;
    if (b.sequence == null) return -1;
    return a.sequence - b.sequence;
  });
  return { ...doc, stops };
}

export type StopStatus = 'pending' | 'arrived' | 'done';

export type PhotoKind = 'delivery' | 'planogram' | 'stales';

/** One driver's visit to one stop on one day. v0 keeps this in session
 *  state; the collection shape is what v1 writes to Firestore. */
export interface StopVisit {
  id: string; // `${date}:${stopId}`
  routeId: string;
  stopId: string;
  date: string; // yyyy-mm-dd
  status: StopStatus;
  arrivedAt: string | null; // ISO timestamp
  completedAt: string | null;
  /** Local object URLs in v0; Firebase Storage paths in v1 (RoutePhoto). */
  photos: Partial<Record<PhotoKind, string>>;
  notes: string;
}

/**
 * End-of-day report — the exact 5 required fields of the owner app's
 * DriverEod (businesses/{bid}/routes/{rid}/eod/{yyyy-mm-dd}), so a submit
 * from this app shows up in TruckCEO unchanged.
 */
export interface EodReport {
  date: string; // yyyy-mm-dd
  piecesLeft: number;
  stalesPulled: number;
  stopsCompleted: string;
  endLocation: string;
  outlook: string;
  submittedAt?: unknown; // Firestore serverTimestamp when written
  submittedBy?: string;
  driverName?: string;
}

/** Mirrors the owner app's InviteCode. */
export interface InviteCode {
  code: string;
  businessId: string;
  routeId: string;
  routeName: string;
  usedCount: number;
  role?: string; // 'team_member' = driver view
}

/**
 * Driver Score (standing design, 0–100): Sales 30 / Stale 25 / Planogram 15 /
 * Fuel 15 / Data discipline 15. Null until the weekly computation exists —
 * the Score screen renders an honest empty state for null.
 */
export interface DriverScore {
  weekOf: string; // yyyy-mm-dd (Monday)
  total: number;
  sales: number; // /30
  stale: number; // /25
  planogram: number; // /15
  fuel: number; // /15
  dataDiscipline: number; // /15
}

export const SCORE_WEIGHTS = {
  sales: 30,
  stale: 25,
  planogram: 15,
  fuel: 15,
  dataDiscipline: 15,
} as const;

/**
 * A driver binding on a users doc whose primary role may be something else
 * (business_owner / business_manager). Mirrors the owner app's
 * DriverMembership: redeeming an invite never overwrites an owner profile;
 * the binding lands here and this app resolves its driver profile from it.
 */
export interface DriverMembership {
  businessId: string;
  routeId: string;
  routeName?: string;
  employeeId?: string;
  joinedAt?: unknown;
}

export interface DriverProfile {
  email: string;
  displayName: string;
  role: 'team_member';
  businessId: string;
  routeIds: string[];
  driverMemberships?: DriverMembership[];
}
