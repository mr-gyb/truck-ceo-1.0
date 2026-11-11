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

/** Business entity operating a route — mirrors the owner app's type. */
export type BusinessEntity = 'mateos-in-motion' | 'cnr' | 'lmb';

export interface Route {
  id: string;
  name: string;
  /** Bakery route number, e.g. "7823". */
  routeNumber?: string;
  supplier?: 'flowers' | 'bimbo';
  settlementAccount?: string;
  vendorId?: string;
  businessEntity?: BusinessEntity | null;
  /**
   * The business this route doc was fetched from. NOT a stored field —
   * attached at fetch time (driverService) because a driver's memberships
   * can span businesses, and every route-scoped read/write (EOD, captures,
   * scores) must target the route's own business.
   */
  businessId?: string;
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
  businessEntity?: BusinessEntity | null;
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
  /**
   * Capture-first provenance (2026-11-10): the ids of the captures the
   * five values were derived from, so every number on the report can be
   * traced back to its source photo/voice note. Optional — EODs written
   * before capture-first have none.
   */
  provenance?: { captureIds: string[]; derivedAt: string };
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

/* ------------------------------------------------------------------ *
 * Capture-first intake (Chris's spec, 2026-11-10): drivers never type.
 * Every input is a photo the backend reads, or a voice note it
 * transcribes. One DriverCapture doc lives at
 *   businesses/{bid}/routes/{rid}/captures/{captureId}
 * with the day on the doc (`date`), so a route-day is one query.
 * The source photo/audio in Storage is the provenance for every
 * extracted value — an extracted number never exists without it.
 * ------------------------------------------------------------------ */

/**
 * Capture kinds. The guided Today flow asks for: 'depot' (load/truck
 * photos that open the day), then per stop a 'stales' ticket photo, the
 * 'shelf' pics, and a 'receipt' (the sales ticket). 'inventory' is the
 * end-of-day truck count; 'transfer' a load transfer; 'voice' a spoken
 * report (e.g. tomorrow's outlook); 'other' anything else.
 */
export type CaptureType =
  | 'depot'
  | 'stales'
  | 'shelf'
  | 'receipt'
  | 'inventory'
  | 'transfer'
  | 'voice'
  | 'other';

/**
 * Extraction lifecycle. 'pending' = uploaded, not yet read.
 * 'needs_attention' = the reader could not read it — the driver must
 * retake the photo or report by voice; NO value is ever guessed into
 * this state. 'extracted' = values are on `extracted` awaiting the
 * driver's tap-confirm; 'confirmed' = the driver confirmed them.
 */
export type CaptureStatus = 'pending' | 'extracted' | 'confirmed' | 'needs_attention';

/** Structured values read out of a capture by the backend reader.
 *  Every field optional: a field is present only when it was actually
 *  read from the source — never estimated. */
export interface CaptureExtracted {
  storeId?: string | null;
  storeName?: string | null;
  /** Pieces counted in an inventory / end-of-day truck photo. */
  pieces?: number | null;
  /** Stale pieces/units counted in a stales photo. */
  stalesPulled?: number | null;
  /** Transfer pieces (transfer captures). */
  transferPieces?: number | null;
  transferDirection?: 'in' | 'out' | null;
  /** Receipt total pieces (receipt captures). */
  receiptPieces?: number | null;
  /** Voice captures: the transcript, once transcribed. */
  transcript?: string | null;
}

export interface DriverCapture {
  id?: string;
  type: CaptureType;
  /** yyyy-mm-dd the capture belongs to (the driver's work day). */
  date: string;
  /** Firebase Storage path of the source photo/audio — the provenance. */
  storagePath: string;
  downloadUrl?: string | null;
  storeId?: string | null;
  storeName?: string | null;
  status: CaptureStatus;
  extracted?: CaptureExtracted | null;
  /** Set when status='needs_attention': what the driver should do. */
  attentionNote?: string | null;
  driverId: string;
  driverName: string;
  createdAt?: unknown; // Firestore serverTimestamp when written
}

/* ------------------------------------------------------------------ *
 * Generated driver guide book + route card. Written by the backend
 * when a settlement is ingested for a route (see
 * functions/src/settlements/guide.ts in truck-ceo-1.0), stored at
 *   businesses/{bid}/routes/{rid}/guides/{weekEnding}
 * Built ONLY from the settlement's store rows + the route's store
 * registry — no invented figures.
 * ------------------------------------------------------------------ */

export interface GuideStoreRow {
  storeNumber: string;
  storeName: string;
  address?: string | null;
  /** Run order from the registry when confirmed; null otherwise. */
  sequence?: number | null;
  pieces?: number | null; // settlement week quantity for this store
  sales?: number | null; // settlement week dollars for this store
}

export interface RouteGuideData {
  weekEnding: string;
  week: number;
  routeNumber: string;
  generatedAt: string;
  sourceSettlementPath: string;
  guideBook: {
    routeLabel: string;
    weekPieces: number | null;
    weekSales: number | null;
    stalesPct: number | null;
    stalesAmount: number | null;
    stores: GuideStoreRow[];
  };
  routeCard: {
    routeLabel: string;
    stops: GuideStoreRow[];
  };
}
