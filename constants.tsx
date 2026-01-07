
import { Product, Employee, Truck, SaleAlert, RouteTerritory } from './types';

export const BUSINESS_NAME = "Mateos in Motion";

export const ROUTES: RouteTerritory[] = [
  {
    id: 'ny-1',
    name: 'NY: Yonkers - Bimbo',
    stores: [
      { id: 'ny-s1', name: 'Stop & Shop Yonkers', address: '111 Vredenburgh Ave' },
      { id: 'ny-s2', name: 'ShopRite of Greenway Plaza', address: '25-43 Prospect St' }
    ]
  },
  {
    id: 'ny-2',
    name: 'NY: Ossining - Bimbo',
    stores: [
      { id: 'ny-s3', name: 'ACME Markets Ossining', address: '202 S Highland Ave' }
    ]
  },
  {
    id: 'ct-1',
    name: 'CT: Milford - Flowers',
    stores: [
      { id: 'ct-s1', name: 'Costco Milford', address: '1718 Boston Post Rd' },
      { id: 'ct-s2', name: 'Walmart Milford', address: '900 Boston Post Rd' }
    ]
  },
  {
    id: 'ct-2',
    name: 'CT: Stratford - Flowers',
    stores: [
      { id: 'ct-s3', name: 'ShopRite Stratford', address: '250 Barnum Avenue' }
    ]
  },
  {
    id: 'ct-3',
    name: 'CT: Ridgefield - Bimbo',
    stores: [
      { id: 'ct-s4', name: 'Stop & Shop Ridgefield', address: '125 Danbury Rd' }
    ]
  },
  {
    id: 'ct-4',
    name: 'CT: Norwalk - Bimbo',
    stores: [
      { id: 'ct-s5', name: 'Stew Leonard\'s Norwalk', address: '100 Westport Ave' },
      { id: 'ct-s6', name: 'Whole Foods Norwalk', address: '350 Connecticut Ave' }
    ]
  }
];

export const INITIAL_PRODUCTS: Product[] = [
  { id: '1', name: 'Classic Hamburger Buns (8pk)', category: 'buns', currentInventory: 45, lastOrderQuantity: 120 },
  { id: '2', name: 'Premium Hot Dog Buns (8pk)', category: 'buns', currentInventory: 32, lastOrderQuantity: 100 },
  { id: '3', name: 'Whole Wheat Sliced Bread', category: 'bread', currentInventory: 88, lastOrderQuantity: 80 },
  { id: '4', name: 'Tastykake Butterscotch Krimpets', category: 'snacks', currentInventory: 12, lastOrderQuantity: 40 },
  { id: '5', name: 'Tastykake Chocolate Cupcakes', category: 'snacks', currentInventory: 15, lastOrderQuantity: 40 },
];

const mockSalesHistory = [
  { month: 'Jan', amount: 12400 },
  { month: 'Feb', amount: 13500 },
  { month: 'Mar', amount: 15200 },
];

const mockAttendance = [
  { date: '2024-06-10', lateStart: false, lateFinish: false, type: 'work' },
  { date: '2024-06-11', lateStart: true, lateFinish: false, type: 'work' },
  { date: '2024-06-12', lateStart: false, lateFinish: true, type: 'work' },
] as const;

export const INITIAL_EMPLOYEES: Employee[] = [
  { 
    id: 'exec-1', name: 'Chris Mateo', role: 'executive', hoursThisWeek: 45, engagementScore: 100, status: 'active',
    salesHistory: mockSalesHistory, attendance: Array.from(mockAttendance), vacationDaysUsed: 12, sickDaysUsed: 2 
  },
  { 
    id: 'exec-2', name: 'Virgil Mateo', role: 'executive', hoursThisWeek: 42, engagementScore: 98, status: 'active',
    salesHistory: mockSalesHistory, attendance: Array.from(mockAttendance), vacationDaysUsed: 5, sickDaysUsed: 1 
  },
  { 
    id: 'exec-3', name: 'Charlotte Mateo', role: 'executive', hoursThisWeek: 40, engagementScore: 99, status: 'active',
    salesHistory: mockSalesHistory, attendance: Array.from(mockAttendance), vacationDaysUsed: 8, sickDaysUsed: 0 
  },
  { 
    id: 'driver-1', name: 'Andres', role: 'driver', hoursThisWeek: 38.5, engagementScore: 85, status: 'active',
    salesHistory: mockSalesHistory, attendance: Array.from(mockAttendance), vacationDaysUsed: 2, sickDaysUsed: 4 
  },
  { 
    id: 'driver-2', name: 'Adrian', role: 'driver', hoursThisWeek: 40.0, engagementScore: 82, status: 'active',
    salesHistory: mockSalesHistory, attendance: Array.from(mockAttendance), vacationDaysUsed: 4, sickDaysUsed: 2 
  },
  { 
    id: 'driver-3', name: 'Ronaldo', role: 'driver', hoursThisWeek: 34.0, engagementScore: 75, status: 'off',
    salesHistory: mockSalesHistory, attendance: Array.from(mockAttendance), vacationDaysUsed: 10, sickDaysUsed: 5 
  },
  { 
    id: 'driver-4', name: 'Alex', role: 'driver', hoursThisWeek: 39.5, engagementScore: 88, status: 'active',
    salesHistory: mockSalesHistory, attendance: Array.from(mockAttendance), vacationDaysUsed: 3, sickDaysUsed: 1 
  },
];

const mockMaintenance = [
  { date: '2024-03-15', service: 'Oil Change & Filter', cost: 120, provider: 'Main St Auto' },
  { date: '2023-11-20', service: 'New Tires (Front)', cost: 450, provider: 'Tire Discounters' },
];

export const INITIAL_FLEET: Truck[] = [
  { 
    id: 't1', plate: 'GMC-06-01', type: '2006 GMC 16ft Box', mileage: 142000, lastService: '2024-03-15', healthStatus: 'good', issues: [],
    maintenanceHistory: mockMaintenance, registrationExpiry: '2024-12-31', insuranceExpiry: '2024-09-15',
    dimensions: { height: 11.5, length: 24, weight: 14500 },
    upkeep: { tires: 85, oil: 90, brakes: 75 }
  },
  { 
    id: 't2', plate: 'GMC-06-02', type: '2006 GMC 16ft Box', mileage: 156000, lastService: '2024-02-10', healthStatus: 'good', issues: [],
    maintenanceHistory: mockMaintenance, registrationExpiry: '2024-11-20', insuranceExpiry: '2024-10-01',
    dimensions: { height: 11.5, length: 24, weight: 14500 },
    upkeep: { tires: 70, oil: 60, brakes: 80 }
  },
  { 
    id: 't3', plate: 'GMC-06-03', type: '2006 GMC 16ft Box', mileage: 188000, lastService: '2024-01-20', healthStatus: 'warning', issues: ['Brake pads thin'],
    maintenanceHistory: mockMaintenance, registrationExpiry: '2024-08-15', insuranceExpiry: '2024-07-22',
    dimensions: { height: 12.0, length: 24, weight: 15000 },
    upkeep: { tires: 45, oil: 30, brakes: 20 }
  },
  { 
    id: 't4', plate: 'GMC-06-04', type: '2006 GMC 16ft Box', mileage: 125000, lastService: '2024-05-01', healthStatus: 'good', issues: [],
    maintenanceHistory: mockMaintenance, registrationExpiry: '2025-01-10', insuranceExpiry: '2024-11-05',
    dimensions: { height: 11.5, length: 24, weight: 14500 },
    upkeep: { tires: 95, oil: 95, brakes: 90 }
  },
  { 
    id: 't5', plate: 'GMC-06-05', type: '2006 GMC 16ft Box', mileage: 195000, lastService: '2023-11-15', healthStatus: 'critical', issues: ['Transmission slip'],
    maintenanceHistory: mockMaintenance, registrationExpiry: '2024-06-25', insuranceExpiry: '2024-06-30',
    dimensions: { height: 11.5, length: 24, weight: 14500 },
    upkeep: { tires: 30, oil: 10, brakes: 15 }
  },
  { 
    id: 't6', plate: 'ISUZU-14', type: '2014 Isuzu 20ft Box', mileage: 85000, lastService: '2024-04-05', healthStatus: 'good', issues: [],
    maintenanceHistory: mockMaintenance, registrationExpiry: '2025-04-15', insuranceExpiry: '2024-08-30',
    dimensions: { height: 13.2, length: 28, weight: 19500 },
    upkeep: { tires: 90, oil: 85, brakes: 95 }
  },
];

export const SALE_ALERTS: SaleAlert[] = [
  { id: 's1', storeName: 'Walmart Milford', promoType: 'BOGO Hamburger Buns', date: 'July 1st', contactName: 'Steve' },
  { id: 's2', storeName: 'Stew Leonard\'s Norwalk', promoType: '20% Off Organic Sliced', date: 'June 28th', contactName: 'Brenda' },
  { id: 's3', storeName: 'Stop & Shop Yonkers', promoType: 'End Cap Snack Special', date: 'July 10th', contactName: 'Marcus' },
];
