import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { FirestoreService } from '../services/firestoreService';
import { Product, Employee, Truck, SaleAlert, RouteTerritory } from '../types';

interface DataContextType {
  products: Product[];
  employees: Employee[];
  trucks: Truck[];
  saleAlerts: SaleAlert[];
  routes: RouteTerritory[];
  loading: boolean;
  firestoreService: FirestoreService | null;
  refetchAll: () => Promise<void>;

  // Products
  addProduct: (data: Omit<Product, 'id'>) => Promise<string>;
  updateProduct: (productId: string, data: Partial<Product>) => Promise<void>;
  deleteProduct: (productId: string) => Promise<void>;

  // Employees
  addEmployee: (data: Omit<Employee, 'id'>) => Promise<string>;
  updateEmployee: (employeeId: string, data: Partial<Employee>) => Promise<void>;
  deleteEmployee: (employeeId: string) => Promise<void>;

  // Trucks
  addTruck: (data: Omit<Truck, 'id'>) => Promise<string>;
  updateTruck: (truckId: string, data: Partial<Truck>) => Promise<void>;
  deleteTruck: (truckId: string) => Promise<void>;

  // Routes
  addRoute: (data: Omit<RouteTerritory, 'id'>) => Promise<string>;
  updateRoute: (routeId: string, data: Partial<RouteTerritory>) => Promise<void>;
  deleteRoute: (routeId: string) => Promise<void>;

  // Sale Alerts
  addSaleAlert: (data: Omit<SaleAlert, 'id'>) => Promise<string>;
  updateSaleAlert: (alertId: string, data: Partial<SaleAlert>) => Promise<void>;
  deleteSaleAlert: (alertId: string) => Promise<void>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const useData = () => {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error('useData must be used within DataProvider');
  }
  return context;
};

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { userProfile } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [saleAlerts, setSaleAlerts] = useState<SaleAlert[]>([]);
  const [routes, setRoutes] = useState<RouteTerritory[]>([]);
  const [loading, setLoading] = useState(true);
  const [firestoreService, setFirestoreService] = useState<FirestoreService | null>(null);

  const fetchData = async (service: FirestoreService) => {
    setLoading(true);
    try {
      if (userProfile?.role === 'business_owner') {
        // Business owners see everything
        console.log('Fetching all data for business owner...');
        const [p, e, t, s, r] = await Promise.all([
          service.getProducts(),
          service.getEmployees(),
          service.getTrucks(),
          service.getSaleAlerts(),
          service.getRoutes()
        ]);
        setProducts(p);
        setEmployees(e);
        setTrucks(t);
        setSaleAlerts(s);
        setRoutes(r);
        console.log('Loaded:', { products: p.length, employees: e.length, trucks: t.length, routes: r.length });
      } else if (userProfile?.role === 'team_member' && userProfile.employeeId) {
        // Team members see only their assigned routes and related data
        console.log('Fetching data for team member...');
        const employee = await service.getEmployee(userProfile.employeeId);

        if (employee) {
          const assignedRoutes = (employee as any).assignedRoutes || [];
          console.log('Team member assigned routes:', assignedRoutes);

          const [p, r] = await Promise.all([
            service.getProducts(),
            service.getRoutesForTeamMember(assignedRoutes)
          ]);

          setProducts(p);
          setRoutes(r);
          setEmployees([employee]); // Only their own profile
          setTrucks([]); // Team members don't see fleet
          setSaleAlerts([]); // Team members don't see sale alerts
          console.log('Loaded:', { products: p.length, routes: r.length });
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (userProfile?.businessId) {
      const service = new FirestoreService(userProfile.businessId);
      setFirestoreService(service);
      fetchData(service);
    } else {
      setLoading(false);
    }
  }, [userProfile]);

  const refetchAll = async () => {
    if (firestoreService) {
      await fetchData(firestoreService);
    }
  };

  // Products
  const addProduct = async (data: Omit<Product, 'id'>) => {
    if (!firestoreService) throw new Error('Service not initialized');
    const id = await firestoreService.addProduct(data);
    await refetchAll();
    return id;
  };

  const updateProduct = async (productId: string, data: Partial<Product>) => {
    if (!firestoreService) throw new Error('Service not initialized');
    await firestoreService.updateProduct(productId, data);
    await refetchAll();
  };

  const deleteProduct = async (productId: string) => {
    if (!firestoreService) throw new Error('Service not initialized');
    await firestoreService.deleteProduct(productId);
    await refetchAll();
  };

  // Employees
  const addEmployee = async (data: Omit<Employee, 'id'>) => {
    if (!firestoreService) throw new Error('Service not initialized');
    const id = await firestoreService.addEmployee(data);
    await refetchAll();
    return id;
  };

  const updateEmployee = async (employeeId: string, data: Partial<Employee>) => {
    if (!firestoreService) throw new Error('Service not initialized');
    await firestoreService.updateEmployee(employeeId, data);
    await refetchAll();
  };

  const deleteEmployee = async (employeeId: string) => {
    if (!firestoreService) throw new Error('Service not initialized');
    await firestoreService.deleteEmployee(employeeId);
    await refetchAll();
  };

  // Trucks
  const addTruck = async (data: Omit<Truck, 'id'>) => {
    if (!firestoreService) throw new Error('Service not initialized');
    const id = await firestoreService.addTruck(data);
    await refetchAll();
    return id;
  };

  const updateTruck = async (truckId: string, data: Partial<Truck>) => {
    if (!firestoreService) throw new Error('Service not initialized');
    await firestoreService.updateTruck(truckId, data);
    await refetchAll();
  };

  const deleteTruck = async (truckId: string) => {
    if (!firestoreService) throw new Error('Service not initialized');
    await firestoreService.deleteTruck(truckId);
    await refetchAll();
  };

  // Routes
  const addRoute = async (data: Omit<RouteTerritory, 'id'>) => {
    if (!firestoreService) throw new Error('Service not initialized');
    const id = await firestoreService.addRoute(data);
    await refetchAll();
    return id;
  };

  const updateRoute = async (routeId: string, data: Partial<RouteTerritory>) => {
    if (!firestoreService) throw new Error('Service not initialized');
    await firestoreService.updateRoute(routeId, data);
    await refetchAll();
  };

  const deleteRoute = async (routeId: string) => {
    if (!firestoreService) throw new Error('Service not initialized');
    await firestoreService.deleteRoute(routeId);
    await refetchAll();
  };

  // Sale Alerts
  const addSaleAlert = async (data: Omit<SaleAlert, 'id'>) => {
    if (!firestoreService) throw new Error('Service not initialized');
    const id = await firestoreService.addSaleAlert(data);
    await refetchAll();
    return id;
  };

  const updateSaleAlert = async (alertId: string, data: Partial<SaleAlert>) => {
    if (!firestoreService) throw new Error('Service not initialized');
    await firestoreService.updateSaleAlert(alertId, data);
    await refetchAll();
  };

  const deleteSaleAlert = async (alertId: string) => {
    if (!firestoreService) throw new Error('Service not initialized');
    await firestoreService.deleteSaleAlert(alertId);
    await refetchAll();
  };

  const value = {
    products,
    employees,
    trucks,
    saleAlerts,
    routes,
    loading,
    firestoreService,
    refetchAll,
    addProduct,
    updateProduct,
    deleteProduct,
    addEmployee,
    updateEmployee,
    deleteEmployee,
    addTruck,
    updateTruck,
    deleteTruck,
    addRoute,
    updateRoute,
    deleteRoute,
    addSaleAlert,
    updateSaleAlert,
    deleteSaleAlert
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};
