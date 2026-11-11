
export interface Product {
  id: string;
  name: string;
  category: 'buns' | 'bread' | 'snacks';
  currentInventory: number;
  lastOrderQuantity: number;
}

export interface SmartSuggestion {
  productId: string;
  recommendedQty: number;
  reason: string;
  impactLevel: 'low' | 'medium' | 'high';
}

export interface AttendanceRecord {
  date: string;
  lateStart: boolean;
  lateFinish: boolean;
  type: 'work' | 'vacation' | 'sick';
}

export interface SalesHistory {
  month: string;
  amount: number;
}

export interface Employee {
  id: string;
  name: string;
  role: 'executive' | 'driver';
  phone?: string | null;
  hoursThisWeek: number;
  engagementScore: number; // 0-100
  status: 'active' | 'break' | 'off';
  salesHistory: SalesHistory[];
  attendance: AttendanceRecord[];
  vacationDaysUsed: number;
  sickDaysUsed: number;
}

export interface MaintenanceRecord {
  date: string;
  service: string;
  cost: number;
  provider: string;
}

export interface Truck {
  id: string;
  plate: string;
  type: string;
  mileage: number;
  lastService: string;
  healthStatus: 'good' | 'warning' | 'critical';
  issues: string[];
  maintenanceHistory: MaintenanceRecord[];
  registrationExpiry: string;
  insuranceExpiry: string;
  dimensions: {
    height: number; // in feet
    length: number; // in feet
    weight: number; // in lbs
  };
  upkeep: {
    tires: number; // 0-100%
    oil: number; // 0-100%
    brakes: number; // 0-100%
  };
}

export interface SaleAlert {
  id: string;
  storeName: string;
  promoType: string;
  date: string;
  contactName: string;
}

// Operational alerts (truck issues, store problems, staffing gaps) — the
// canonical store written by the assistant backend at
// businesses/{bid}/alerts. Distinct from SaleAlert (promo requests).
export interface OperationalAlert {
  id: string;
  title: string;
  detail: string;
  severity: 'info' | 'warning' | 'urgent';
  routeId?: string | null;
  routeNumber?: string | null;
  status: 'open' | 'acknowledged' | 'resolved';
  createdBy?: string;
  createdByName?: string;
  createdAt?: any;
  via?: string;
}

export interface Store {
  id: string;
  name: string;
  address: string;
  // Supplier store/customer number (e.g. Flowers sold-to "40408551", Bimbo
  // store number). Settlement/shrink/margin rows join to stores by this —
  // see functions/src/settlements. Set in Routes management.
  storeNumber?: string;
}

/**
 * Business entity that operates a route (Chris's structure): Mateo's in
 * Motion runs the Flowers routes, CNR Distributors the CT Bimbo routes,
 * LMB the NY Bimbo routes. Routes carry this explicitly so the business
 * can be loaded with numbered, grouped routes instead of city-name
 * shells; when unset, services/routeOrdering.ts derives it from the
 * route number (the standing display groups ARE the entity map).
 */
export type BusinessEntity = 'mateos-in-motion' | 'cnr' | 'lmb';

export interface RouteTerritory {
  id: string;
  name: string;
  stores: Store[];
  assignedDriverId?: string | null;
  assignedTruckId?: string | null;
  businessEntity?: BusinessEntity | null;
  // Optional bakery route number (e.g. "2080"). The assistant matches routes
  // by this first, then by name. Set at creation; editable in Routes management.
  routeNumber?: string;
  // Data-intake mapping (2026-11-06): which supplier this route settles
  // with, the settlement account id with that supplier (Bimbo SA
  // 5045/6442/6418/5713; Flowers distributor number 20040812/20040846/
  // 20042103), and the umbrella vendor id where one exists (Bimbo 116300).
  // These fields are what keep a settlement file from ever being filed
  // under the wrong route.
  supplier?: 'flowers' | 'bimbo';
  settlementAccount?: string;
  vendorId?: string;
}

export type View = 'dashboard' | 'ordering' | 'team' | 'fleet' | 'fleet_assign' | 'promos' | 'data_hub' | 'weather' | 'navigation' | 'settings' | 'routes_management' | 'driver_invites';

// ===== Driver app (role-based) =====

/** One recorded redemption of an invite code (written on join). */
export interface InviteRedemption {
  uid: string;
  email: string | null;
  displayName?: string;
  routeId?: string;
  joinedAt: any;
}

export interface InviteCode {
  code: string;
  businessId: string;
  routeId: string;
  routeName: string;
  createdBy: string;
  createdAt: any;
  usedCount: number;
  kind?: string; // 'link' for business-level invite links vs per-route codes
  role?: string; // 'team_member' (driver view) | 'business_manager' (business view)
  redemptions?: InviteRedemption[];
}

/**
 * A driver binding held by an account whose primary role is something else
 * (business_owner / business_manager). Redeeming a driver invite must never
 * overwrite an owner profile — the binding lands here instead, and the app
 * offers a Driver view switch for accounts that hold one.
 */
export interface DriverMembership {
  businessId: string;
  routeId: string;
  routeName?: string;
  employeeId?: string;
  joinedAt?: any;
}

export interface DriverEod {
  id?: string;
  date: string; // yyyy-mm-dd
  piecesLeft: number;
  stalesPulled: number;
  stopsCompleted: string;
  endLocation: string;
  outlook: string;
  submittedAt: any;
  submittedBy: string;
  driverName: string;
  // Notes appended by the assistant (log_eod_note) — additive only, the
  // driver's own submit must never wipe these (DriverHome uses merge:true).
  assistantNotes?: EodAssistantNote[];
}

export interface EodAssistantNote {
  text: string;
  by: string;
  byName: string;
  at: string;
  via: string;
  threadId?: string;
}

export type PhotoMoment = 'start' | 'work' | 'end';

export interface RoutePhoto {
  id?: string;
  storagePath: string;
  downloadUrl: string;
  moment: PhotoMoment;
  storeId?: string | null;
  storeName?: string | null;
  aiStatus: 'pending' | 'sorted';
  category?: string | null;
  compliance?: 'match' | 'flag' | null;
  uploadedAt: any;
  uploadedBy: string;
  driverName: string;
}

export interface RouteUpdate {
  id?: string;
  text: string;
  createdAt: any;
  authorName: string;
  authorId: string;
}

/* ------------------------------------------------------------------ *
 * Capture-first intake (Chris's spec, 2026-11-10) — mirrors the driver
 * app's types. One doc per capture at
 *   businesses/{bid}/routes/{rid}/captures/{captureId}
 * The source photo/audio in Storage is the provenance for every
 * extracted value; status 'needs_attention' means unreadable — the
 * driver retakes it or reports by voice, never a silent guess.
 * ------------------------------------------------------------------ */

export type CaptureType =
  | 'depot' | 'stales' | 'shelf' | 'receipt' | 'inventory' | 'transfer' | 'voice' | 'other';

export type CaptureStatus = 'pending' | 'extracted' | 'confirmed' | 'needs_attention';

export interface CaptureExtracted {
  storeId?: string | null;
  storeName?: string | null;
  pieces?: number | null;
  stalesPulled?: number | null;
  transferPieces?: number | null;
  transferDirection?: 'in' | 'out' | null;
  receiptPieces?: number | null;
  transcript?: string | null;
}

export interface DriverCapture {
  id?: string;
  type: CaptureType;
  date: string; // yyyy-mm-dd
  storagePath: string;
  downloadUrl?: string | null;
  storeId?: string | null;
  storeName?: string | null;
  status: CaptureStatus;
  extracted?: CaptureExtracted | null;
  attentionNote?: string | null;
  driverId: string;
  driverName: string;
  createdAt?: any;
}

/* ------------------------------------------------------------------ *
 * Generated driver guide book + route card (backend-written on
 * settlement ingest; see functions/src/settlements/guide.ts). Stored
 * at businesses/{bid}/routes/{rid}/guides/{weekEnding}. Built only
 * from the settlement's store rows + the route's store registry.
 * ------------------------------------------------------------------ */

export interface GuideStoreRow {
  storeNumber: string;
  storeName: string;
  address?: string | null;
  sequence?: number | null;
  pieces?: number | null;
  sales?: number | null;
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
