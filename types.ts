
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
}

export interface RouteTerritory {
  id: string;
  name: string;
  stores: Store[];
  assignedDriverId?: string | null;
  assignedTruckId?: string | null;
  // Optional bakery route number (e.g. "2080"). The assistant matches routes
  // by this first, then by name. Set at creation; editable in Routes management.
  routeNumber?: string;
}

export type View = 'dashboard' | 'ordering' | 'team' | 'fleet' | 'fleet_assign' | 'promos' | 'data_hub' | 'weather' | 'navigation' | 'settings' | 'routes_management';

// ===== Driver app (role-based) =====

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
