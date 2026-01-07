
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

export interface Store {
  id: string;
  name: string;
  address: string;
}

export interface RouteTerritory {
  id: string;
  name: string;
  stores: Store[];
}

export type View = 'dashboard' | 'ordering' | 'team' | 'fleet' | 'promos' | 'data_hub' | 'weather' | 'navigation' | 'settings' | 'routes_management';
